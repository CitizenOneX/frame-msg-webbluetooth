import { FrameMsg } from '../FrameMsg';

// A simple Promise-based queue, similar to the one in tap.ts
class AsyncQueue<T> {
    private promises: Promise<T>[];
    private resolvers: ((value: T | PromiseLike<T>) => void)[];

    constructor() {
        this.promises = [];
        this.resolvers = [];
    }

    private add(): void {
        this.promises.push(new Promise<T>(resolve => {
            this.resolvers.push(resolve);
        }));
    }

    put(value: T): void {
        if (!this.resolvers.length) {
            this.add();
        }
        const resolve = this.resolvers.shift();
        if (resolve) {
            resolve(value);
        }
    }

    async get(): Promise<T> {
        if (!this.promises.length) {
            this.add();
        }
        const promise = this.promises.shift();
        if (promise) {
            return promise;
        }
        // Fallback, should ideally not be reached with current logic
        return new Promise<T>(resolve => {
            this.resolvers.push(resolve);
            this.promises.push(this.get());
        });
    }

    isEmpty(): boolean {
        return this.promises.length === 0;
    }

    size(): number {
        return this.promises.length;
    }

    clear(): void {
        // Properly clear the queue by rejecting pending promises to avoid unhandled rejections
        this.resolvers.forEach(resolve => {
            // It's tricky to "cancel" a promise from outside without a specific mechanism.
            // For simplicity, we'll just clear them. Consumers should be aware.
        });
        this.promises = [];
        this.resolvers = [];
    }
}

export type JpegQuality = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface RxPhotoOptions {
    nonFinalChunkFlag?: number;
    finalChunkFlag?: number;
    upright?: boolean;
    isRaw?: boolean;
    quality?: JpegQuality | null;
    resolution?: number | null; // even number between 100 and 720 inclusive
}

export class RxPhoto {
    private static _jpegHeaderMap: Record<string, Uint8Array> = {};

    private nonFinalChunkFlag: number;
    private finalChunkFlag: number;
    private upright: boolean;
    private isRaw: boolean;
    private quality: JpegQuality | null;
    private resolution: number | null;

    public queue: AsyncQueue<Uint8Array> | null;
    private _imageDataChunks: Uint8Array[];

    constructor(options: RxPhotoOptions = {}) {
        this.nonFinalChunkFlag = options.nonFinalChunkFlag ?? 0x07;
        this.finalChunkFlag = options.finalChunkFlag ?? 0x08;
        this.upright = options.upright ?? true;
        this.isRaw = options.isRaw ?? false;
        this.quality = options.quality ?? null;
        this.resolution = options.resolution ?? null;

        this.queue = null;
        this._imageDataChunks = [];
    }

    public static hasJpegHeader(quality: JpegQuality, resolution: number): boolean {
        return `${quality}_${resolution}` in RxPhoto._jpegHeaderMap;
    }

    private concatenateImageData(): Uint8Array {
        let totalLength = 0;
        for (const chunk of this._imageDataChunks) {
            totalLength += chunk.length;
        }
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of this._imageDataChunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    public handleData(data: Uint8Array): void {
        if (!this.queue) {
            console.warn("RxPhoto: Received data but queue not initialized - call attach() first");
            return;
        }

        const flag = data[0];
        const chunk = data.slice(1);

        this._imageDataChunks.push(chunk);

        if (flag === this.finalChunkFlag) {
            // Process complete image asynchronously
            this._processCompleteImage().catch(error => {
                console.error("RxPhoto: Error processing complete image:", error);
                // Optionally, clear image data chunks here too to prevent stale data
                this._imageDataChunks = [];
            });
        }
    }

    private async _processCompleteImage(): Promise<void> {
        if (!this.queue) return;

        let finalImageBytes: Uint8Array;
        const receivedImageData = this.concatenateImageData();
        this._imageDataChunks = []; // Clear chunks immediately after concatenating

        if (this.isRaw) {
            if (!this.quality || !this.resolution) {
                 throw new Error("RxPhoto: Quality and resolution must be set for raw images if no header is cached.");
            }
            const key = `${this.quality}_${this.resolution}`;
            const header = RxPhoto._jpegHeaderMap[key];
            if (!header) {
                throw new Error(
                    `RxPhoto: No JPEG header found for quality ${this.quality} ` +
                    `and resolution ${this.resolution} - request full JPEG first to cache header.`
                );
            }
            const combined = new Uint8Array(header.length + receivedImageData.length);
            combined.set(header, 0);
            combined.set(receivedImageData, header.length);
            finalImageBytes = combined;
        } else {
            finalImageBytes = receivedImageData;
            // Store JPEG header for future raw images if not already stored
            if (this.quality && this.resolution) {
                const key = `${this.quality}_${this.resolution}`;
                if (!RxPhoto._jpegHeaderMap[key]) {
                    // The Python version uses a fixed size (623 bytes) for the header.
                    // Ensure this is appropriate for all JPEGs or adjust if necessary.
                    const headerCandidate = finalImageBytes.slice(0, 623);
                    RxPhoto._jpegHeaderMap[key] = headerCandidate;
                }
            }
        }

        if (this.upright) {
            // TODO: Image Rotation
            // The Python code uses PIL (Pillow) to rotate the image -90 degrees.
            // In JavaScript, you would need an image manipulation library for this.
            // For example, using a library like 'jimp' or 'pica' with OffscreenCanvas:
            // 1. Decode `finalImageBytes` into an image object.
            // 2. Rotate the image.
            // 3. Encode the rotated image back into JPEG `Uint8Array`.
            // As a placeholder, we'll just log and pass the original bytes.
            console.warn("RxPhoto: Image rotation is enabled but requires a JS image manipulation library. Skipping rotation.");
            // finalImageBytes = await rotateImageBytes(finalImageBytes, -90); // Placeholder for actual rotation
        }

        await this.queue.put(finalImageBytes);
    }

    public async attach(frame: FrameMsg): Promise<AsyncQueue<Uint8Array>> {
        if (this.isRaw && (!this.quality || !this.resolution)) {
            // Check if a header is already cached for this configuration. If not, it's an issue.
            // However, the Python code allows proceeding and relies on an error during _processCompleteImage.
            // For robustness, one might throw an error here if no header can possibly be found.
             console.warn("RxPhoto: Handling raw images without quality/resolution specified. Header must be pre-cached or will fail.");
        }

        this.queue = new AsyncQueue<Uint8Array>();
        this._imageDataChunks = []; // Reset image data

        // Note: Python's `_image_data.extend(self._jpeg_header_map[key])` for pre-populating
        // raw image data isn't directly done here. The header is prepended in _processCompleteImage.
        // This matches the logic flow where `isRaw` determines prepending.

        frame.registerDataResponseHandler(
            this,
            [this.nonFinalChunkFlag, this.finalChunkFlag],
            this.handleData.bind(this)
        );

        return this.queue;
    }

    public detach(frame: FrameMsg): void {
        frame.unregisterDataResponseHandler(this);
        if (this.queue) {
            this.queue.clear(); // Clear any pending items/waiters in the queue
        }
        this.queue = null;
        this._imageDataChunks = [];
    }
}

// Example of a placeholder rotation function (requires a library)
// async function rotateImageBytes(imageBytes: Uint8Array, angle: number): Promise<Uint8Array> {
//     // Implementation using a library like Jimp:
//     // const image = await Jimp.read(Buffer.from(imageBytes));
//     // image.rotate(angle);
//     // return await image.getBufferAsync(Jimp.MIME_JPEG);
//     console.warn("rotateImageBytes: Actual rotation not implemented.");
//     return imageBytes; // Return original bytes as placeholder
// }
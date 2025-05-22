import { FrameMsg } from '../frame-msg';
import { AsyncQueue } from '../async-queue';

import jpeg from 'jpeg-js';

export type JpegQuality = 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH';

export interface RxPhotoOptions {
    nonFinalChunkFlag?: number;
    finalChunkFlag?: number;
    upright?: boolean;
    isRaw?: boolean;
    quality?: JpegQuality | null;
    resolution?: number | null; // even number between 100 and 720 inclusive
}

/**
 * RxPhoto class handles JPEG image data streaming and processing.
 * It can process JPEG images with or without a header ("raw" mode), although at least one
 * compatible JPEG header must be cached before using raw mode.
 * It can also rotate images 90 degrees counter-clockwise to upright (default behavior).
 * Different JPEG qualities and resolutions can be specified.
 */
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
            console.log("Rotating image 90 degrees counter-clockwise");
            this.queue.put(await this.rotateJpeg90CounterClockwise(finalImageBytes));
        } else {
            this.queue.put(finalImageBytes);
        }
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

    /**
     * Rotates a JPEG image 90 degrees counter-clockwise using an offscreen canvas.
     * @param inputBytes The input JPEG image as a Uint8Array.
     * @returns the rotated JPEG image as a Uint8Array.
     */
    async rotateJpeg90CounterClockwise(inputBytes: Uint8Array): Promise<Uint8Array> {
        // Decode JPEG into raw RGBA pixel data
        const rawImageData = jpeg.decode(inputBytes, { useTArray: true });

        if (!rawImageData || !rawImageData.data || !rawImageData.width || !rawImageData.height) {
            throw new Error('Failed to decode JPEG image.');
        }

        // Set up canvas with rotated dimensions
        const canvas = document.createElement('canvas');
        canvas.width = rawImageData.height;  // Swapped dimensions
        canvas.height = rawImageData.width;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
            throw new Error('Failed to get canvas 2D context.');
        }

        // Create a temporary canvas to hold the original image
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = rawImageData.width;
        tempCanvas.height = rawImageData.height;
        const tempCtx = tempCanvas.getContext('2d');

        if (!tempCtx) {
            throw new Error('Failed to get temporary canvas 2D context.');
        }

        // Put the original image data into the temporary canvas
        tempCtx.putImageData(new ImageData(
            new Uint8ClampedArray(rawImageData.data.buffer),
            rawImageData.width,
            rawImageData.height
        ), 0, 0);

        // Clear the destination canvas and apply rotation
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.translate(0, canvas.height);  // Change translation point
        ctx.rotate(-90 * Math.PI / 180);  // Keep -90 for counter-clockwise

        // Draw the temporary canvas onto the rotated context
        ctx.drawImage(tempCanvas, 0, 0);

        // Convert canvas content back to JPEG blob
        const blob: Blob = await new Promise((resolve, reject) => {
            canvas.toBlob((b) => {
                if (b) resolve(b);
                else reject(new Error('Failed to convert canvas to JPEG blob.'));
            }, 'image/jpeg');
        });

        const arrayBuffer = await blob.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }
}
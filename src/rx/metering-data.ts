import { FrameMsg } from '../frame-msg';
import { AsyncQueue } from '../async-queue';

/**
 * Interface for the structured metering data.
 */
export interface MeteringData {
    spot_r: number;
    spot_g: number;
    spot_b: number;
    matrix_r: number;
    matrix_g: number;
    matrix_b: number;
}

/**
 * Options for RxMeteringData constructor.
 */
export interface RxMeteringDataOptions {
    msgCode?: number;
}

/**
 * RxMeteringData class handles processing of metering data packets.
 */
export class RxMeteringData {
    private msgCode: number;
    public queue: AsyncQueue<MeteringData | null> | null;

    constructor(options: RxMeteringDataOptions = {}) {
        this.msgCode = options.msgCode ?? 0x12; // Default msg_code from Python
        this.queue = null;
    }

    /**
     * Process incoming metering data packets.
     * @param data Uint8Array containing metering data with a flag byte prefix,
     * followed by 6 unsigned bytes (spot r,g,b, matrix r,g,b).
     */
    public handleData(data: Uint8Array): void {
        if (!this.queue) {
            console.warn("RxMeteringData: Received data but queue not initialized - call attach() first"); //
            return;
        }

        // Python: struct.unpack("<BBBBBB", data[1:7])
        // This means 6 unsigned bytes starting from index 1 of the data array.
        // data[0] is the flag/msg_code, data[1] through data[6] are the values.
        if (data.length < 7) { // Needs 1 byte for flag + 6 bytes for data
            console.warn("RxMeteringData: Data packet too short for metering data.");
            return;
        }

        const result: MeteringData = {
            spot_r: data[1],    // unpacked[0]
            spot_g: data[2],    // unpacked[1]
            spot_b: data[3],    // unpacked[2]
            matrix_r: data[4],  // unpacked[3]
            matrix_g: data[5],  // unpacked[4]
            matrix_b: data[6],  // unpacked[5]
        };

        this.queue.put(result);
    }

    /**
     * Attach the receive handler to the Frame data response.
     * @param frame The FrameMsg instance.
     * @returns A promise that resolves to an AsyncQueue that will receive MeteringData objects.
     */
    public async attach(frame: FrameMsg): Promise<AsyncQueue<MeteringData | null>> {
        this.queue = new AsyncQueue<MeteringData | null>();

        // Subscribe for notifications
        frame.registerDataResponseHandler(
            this,
            [this.msgCode],
            this.handleData.bind(this)
        );

        return this.queue;
    }

    /**
     * Detach the receive handler from the Frame data response and clean up resources.
     * @param frame The FrameMsg instance.
     */
    public detach(frame: FrameMsg): void {
        frame.unregisterDataResponseHandler(this);
        if (this.queue) {
            this.queue.clear(); // Clear any pending items
        }
        this.queue = null;
    }
}
import { FrameMsg } from '../frame-msg';
import { AsyncQueue } from '../async-queue';

/**
 * RxTap class handles tap events from the device.
 * It counts the number of taps within a specified threshold time.
 * It uses a queue to manage tap events and provides methods to attach and detach from a FrameMsg instance.
 * It also debounces taps that occur too close together (40ms).
 * The tap count is reset if no taps are detected within the threshold time.
 */
export class RxTap {
    private tapFlag: number;
    private threshold: number; // in milliseconds
    public queue: AsyncQueue<number> | null;
    private lastTapTime: number;
    private tapCount: number;
    private thresholdTimeoutId: NodeJS.Timeout | null;

    constructor(tapFlag: number = 0x09, threshold: number = 0.3) {
        this.tapFlag = tapFlag;
        this.threshold = threshold * 1000; // Convert seconds to milliseconds
        this.queue = null;
        this.lastTapTime = 0;
        this.tapCount = 0;
        this.thresholdTimeoutId = null;
    }

    private async resetThresholdTimer(): Promise<void> {
        if (this.thresholdTimeoutId) {
            clearTimeout(this.thresholdTimeoutId);
            this.thresholdTimeoutId = null;
        }

        this.thresholdTimeoutId = setTimeout(() => {
            this.thresholdTimeout();
        }, this.threshold);
    }

    private thresholdTimeout(): void {
        if (this.queue && this.tapCount > 0) {
            this.queue.put(this.tapCount);
            this.tapCount = 0;
        }
        this.thresholdTimeoutId = null; // Clear the timeout ID after execution
    }

    // The data handler now expects a Uint8Array as per FrameMsg.ts
    public handleData(data: Uint8Array): void {
        if (!this.queue) {
            console.warn("RxTap: Received data but queue not initialized - call attach() first");
            return;
        }

        const currentTime = Date.now(); // Use milliseconds for timing

        // Debounce taps that occur too close together (40ms)
        if (currentTime - this.lastTapTime < 40) { // 40ms
            this.lastTapTime = currentTime;
            return;
        }

        this.lastTapTime = currentTime;
        this.tapCount += 1;

        // Reset the threshold timer
        this.resetThresholdTimer();
    }

    public async attach(frame: FrameMsg): Promise<AsyncQueue<number>> {
        this.queue = new AsyncQueue<number>();
        this.lastTapTime = 0;
        this.tapCount = 0;

        // Ensure the handler is bound to `this` context of the RxTap instance
        frame.registerDataResponseHandler(this, [this.tapFlag], this.handleData.bind(this));

        return this.queue;
    }

    public detach(frame: FrameMsg): void {
        frame.unregisterDataResponseHandler(this);
        if (this.thresholdTimeoutId) {
            clearTimeout(this.thresholdTimeoutId);
            this.thresholdTimeoutId = null;
        }
        if (this.queue) {
            this.queue.clear(); // Clear any pending items in the queue
        }
        this.queue = null;
        this.tapCount = 0;
    }
}
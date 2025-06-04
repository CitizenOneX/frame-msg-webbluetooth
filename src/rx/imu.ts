import { FrameMsg } from '../frame-msg';
import { AsyncQueue } from '../async-queue';

/**
 * Buffer class to provide smoothed moving average of samples.
 */
class SensorBuffer {
    private maxSize: number;
    private _buffer: Array<[number, number, number]>;

    constructor(maxSize: number) {
        this.maxSize = maxSize;
        this._buffer = [];
    }

    public add(value: [number, number, number]): void {
        this._buffer.push(value);
        if (this._buffer.length > this.maxSize) {
            this._buffer.shift(); // equivalent to pop(0)
        }
    }

    public get average(): [number, number, number] {
        if (!this._buffer.length) {
            return [0, 0, 0];
        }

        let sumX = 0;
        let sumY = 0;
        let sumZ = 0;

        for (const [x, y, z] of this._buffer) {
            sumX += x;
            sumY += y;
            sumZ += z;
        }

        const length = this._buffer.length;

        return [
            Math.trunc(sumX / length),
            Math.trunc(sumY / length),
            Math.trunc(sumZ / length)
        ];
    }
}

/**
 * Interface for raw IMU data.
 */
export interface IMURawData {
    /** Raw compass data as a tuple: `[x, y, z]`. */
    compass: [number, number, number];
    /** Raw accelerometer data as a tuple: `[x, y, z]`. */
    accel: [number, number, number];
}

/**
 * Class for processed IMU data.
 * Contains smoothed compass and accelerometer data, and optionally the raw data.
 * Also provides calculated pitch and roll values.
 */
export class IMUData {
    /** Smoothed compass data as a tuple: `[x, y, z]`. */
    public compass: [number, number, number];
    /** Smoothed accelerometer data as a tuple: `[x, y, z]`. */
    public accel: [number, number, number];
    /** Optional raw IMU data. */
    public raw?: IMURawData;

    /**
     * Constructs an instance of IMUData.
     * @param compass Smoothed compass data `[x, y, z]`.
     * @param accel Smoothed accelerometer data `[x, y, z]`.
     * @param raw Optional raw IMU data.
     */
    constructor(compass: [number, number, number], accel: [number, number, number], raw?: IMURawData) {
        this.compass = compass;
        this.accel = accel;
        this.raw = raw;
    }

    /** Calculated pitch in degrees. */
    public get pitch(): number {
        return Math.atan2(this.accel[1], this.accel[2]) * 180.0 / Math.PI;
    }

    /** Calculated roll in degrees. */
    public get roll(): number {
        return Math.atan2(this.accel[0], this.accel[2]) * 180.0 / Math.PI;
    }
}

/**
 * Options for RxIMU constructor.
 */
export interface RxIMUOptions {
    /** Optional msgCode to identify IMU data packets. Defaults to 0x0A. */
    msgCode?: number;
    /** Optional number of samples to average for smoothing. Defaults to 1 (no smoothing). */
    smoothingSamples?: number;
}

/**
 * RxIMU class handles IMU data processing.
 * It processes magnetometer and accelerometer data, providing smoothed values.
 */
export class RxIMU {
    private msgCode: number;
    private smoothingSamples: number;

    /** Asynchronous queue for received IMUData objects. Null if not attached. */
    public queue: AsyncQueue<IMUData | null> | null;
    private compassBuffer: SensorBuffer;
    private accelBuffer: SensorBuffer;

    /**
     * Constructs an instance of the RxIMU class.
     * @param options Configuration options for the IMU handler.
     */
    constructor(options: RxIMUOptions = {}) {
        this.msgCode = options.msgCode ?? 0x0A; //
        this.smoothingSamples = options.smoothingSamples ?? 1; //

        this.queue = null;
        this.compassBuffer = new SensorBuffer(this.smoothingSamples); //
        this.accelBuffer = new SensorBuffer(this.smoothingSamples); //
    }

    /**
     * Process incoming IMU data packets.
     * @param data Uint8Array containing IMU data with msgCode byte prefix.
     */
    public handleData(data: Uint8Array): void { //
        if (!this.queue) {
            console.warn("RxIMU: Received data but queue not initialized - call attach() first"); //
            return;
        }

        // Data is expected to be: [msgCode, ?, val1_L, val1_H, val2_L, val2_H, ...]
        // Python: struct.unpack('<6h', data[2:14])
        // '<' is little-endian, 'h' is a 2-byte signed short. 6 shorts = 12 bytes.
        // data[2:14] means starting from index 2, up to (but not including) index 14.
        if (data.length < 14) {
            console.warn("RxIMU: Data packet too short for IMU data.");
            return;
        }

        const view = new DataView(data.buffer, data.byteOffset);
        const values: number[] = [];
        for (let i = 0; i < 6; i++) {
            values.push(view.getInt16(2 + i * 2, true)); // true for little-endian
        }

        const rawCompass: [number, number, number] = [values[0], values[1], values[2]]; //
        const rawAccel: [number, number, number] = [values[3], values[4], values[5]]; //

        this.compassBuffer.add(rawCompass); //
        this.accelBuffer.add(rawAccel); //

        const imuData = new IMUData(
            this.compassBuffer.average, //
            this.accelBuffer.average, //
            {
                compass: rawCompass,
                accel: rawAccel
            }
        );

        this.queue.put(imuData); //
    }

    /**
     * Attach the IMU handler to the Frame data response.
     * @param frame The FrameMsg instance.
     * @returns A promise that resolves to an AsyncQueue that will receive IMUData objects.
     */
    public async attach(frame: FrameMsg): Promise<AsyncQueue<IMUData | null>> {
        this.queue = new AsyncQueue<IMUData | null>(); //

        // Subscribe for notifications
        frame.registerDataResponseHandler(
            this,
            [this.msgCode],
            this.handleData.bind(this)
        );

        return this.queue;
    }

    /**
     * Detach the IMU handler from the Frame data response and clean up resources.
     * @param frame The FrameMsg instance.
     */
    public detach(frame: FrameMsg): void {
        frame.unregisterDataResponseHandler(this);
        if (this.queue) {
            this.queue.clear();
        }
        this.queue = null;
    }
}
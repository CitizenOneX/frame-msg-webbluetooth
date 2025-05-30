import { FrameMsg } from '../frame-msg';
import { AsyncQueue } from '../async-queue';

// enums for sample rate (8000 and 16000 only)
export enum RxAudioSampleRate {
    SAMPLE_RATE_8KHZ = 8000,
    SAMPLE_RATE_16KHZ = 16000,
}

// enums for bit depth (8 and 16 only)
export enum RxAudioBitDepth {
    BIT_DEPTH_8 = 8,
    BIT_DEPTH_16 = 16,
}

// constructor options
// now includes sample rate and bit depth
export interface RxAudioOptions {
    nonFinalChunkFlag?: number;
    finalChunkFlag?: number;
    streaming?: boolean;
    sampleRate?: RxAudioSampleRate;
    bitDepth?: RxAudioBitDepth;
}

/**
 * RxAudio class handles audio data streaming and processing.
 * It can operate in two modes: streaming and single-clip mode.
 * In streaming mode, it processes audio data in real-time.
 * In single-clip mode, it accumulates audio data until a final chunk is received.
 * The class provides methods to attach and detach from a FrameMsg instance,
 * and to convert PCM data to WAV format.
 * Depending on how it is constructed, it will return samples as either
 * signed 8 or signed 16 bit integers, and the source bit depth in Lua should match.
 */
export class RxAudio {
    private nonFinalChunkFlag: number;
    private finalChunkFlag: number;
    private streaming: boolean;
    private bitDepth: number; // 8 or 16
    private sampleRate: RxAudioSampleRate; // 8000 or 16000

    public queue: AsyncQueue<Int8Array | Int16Array | null> | null;
    private _audioBuffer: Uint8Array[]; // Used to accumulate chunks in non-streaming mode

    constructor(options: RxAudioOptions = {}) {
        this.nonFinalChunkFlag = options.nonFinalChunkFlag ?? 0x05;
        this.finalChunkFlag = options.finalChunkFlag ?? 0x06;
        this.streaming = options.streaming ?? false; // Default to clip mode
        this.sampleRate = options.sampleRate ?? RxAudioSampleRate.SAMPLE_RATE_8KHZ; // Default to 8000 Hz
        this.bitDepth = options.bitDepth ?? RxAudioBitDepth.BIT_DEPTH_8; // Default to 8 bits

        this.queue = null;
        this._audioBuffer = [];
    }

    private concatenateAudioData(): Uint8Array {
        let totalLength = 0;
        for (const chunk of this._audioBuffer) {
            totalLength += chunk.length;
        }
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of this._audioBuffer) {
            result.set(chunk, offset);
            offset += chunk.length;
        }
        return result;
    }

    public handleData(data: Uint8Array): void { //
        if (!this.queue) {
            console.warn("RxAudio: Received data but queue not initialized - call attach() first"); //
            return;
        }

        const flag = data[0]; //
        const chunk = data.slice(1); //

        if (this.streaming) { //
            if (chunk.length > 0) {
                this.queue.put(this.bitDepth === RxAudioBitDepth.BIT_DEPTH_8 ? Int8Array.from(chunk) : new Int16Array(chunk.buffer));
            }
            if (flag === this.finalChunkFlag) {
                this.queue.put(null); // Signal end of stream
            }
        } else {
            // In single-clip mode, accumulate chunks
            this._audioBuffer.push(chunk); //

            if (flag === this.finalChunkFlag) { //
                const completeAudio = this.concatenateAudioData();
                this._audioBuffer = []; // Reset buffer

                this.queue.put(this.bitDepth === RxAudioBitDepth.BIT_DEPTH_8 ? Int8Array.from(completeAudio): new Int16Array(completeAudio.buffer)); //
                this.queue.put(null); // Signal end of clip
            }
        }
    }

    public async attach(frame: FrameMsg): Promise<AsyncQueue<Int8Array | Int16Array | null>> {
        this.queue = new AsyncQueue<Int8Array | Int16Array | null>();
        this._audioBuffer = []; // Reset audio buffer

        // Subscribe to the data response feed
        frame.registerDataResponseHandler(
            this,
            [this.nonFinalChunkFlag, this.finalChunkFlag],
            this.handleData.bind(this) //
        );

        return this.queue;
    }

    public detach(frame: FrameMsg): void { //
        // Unsubscribe from the data response feed
        frame.unregisterDataResponseHandler(this); //
        if (this.queue) {
            this.queue.clear();
        }
        this.queue = null; //
        this._audioBuffer = []; // Reset audio buffer
    }

    private static writeString(view: DataView, offset: number, str: string): void {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    public static toWavBytes(
        pcmData: Uint8Array,
        sampleRate: number = 8000,
        bitsPerSample: number = 8,
        channels: number = 1
    ): Uint8Array { //
        const byteRate = sampleRate * channels * (bitsPerSample / 8); //
        const dataSize = pcmData.length; //
        const fileSizeField = 36 + dataSize; // This is the RIFF chunk size field (ChunkSize in WAV spec)

        const headerLength = 44;
        const wavBuffer = new ArrayBuffer(headerLength + dataSize);
        const view = new DataView(wavBuffer);

        let offset = 0;

        // RIFF chunk descriptor
        RxAudio.writeString(view, offset, 'RIFF'); offset += 4; //
        view.setUint32(offset, fileSizeField, true); offset += 4; // true for little-endian
        RxAudio.writeString(view, offset, 'WAVE'); offset += 4; //

        // fmt sub-chunk
        RxAudio.writeString(view, offset, 'fmt '); offset += 4; //
        view.setUint32(offset, 16, true); offset += 4;  // Subchunk1Size (16 for PCM)
        view.setUint16(offset, 1, true); offset += 2;   // AudioFormat (1 for PCM)
        view.setUint16(offset, channels, true); offset += 2; //
        view.setUint32(offset, sampleRate, true); offset += 4; //
        view.setUint32(offset, byteRate, true); offset += 4; //
        view.setUint16(offset, channels * (bitsPerSample / 8), true); offset += 2; // BlockAlign
        view.setUint16(offset, bitsPerSample, true); offset += 2; //

        // data sub-chunk
        RxAudio.writeString(view, offset, 'data'); offset += 4; //
        view.setUint32(offset, dataSize, true); offset += 4; //

        // Write PCM data.
        // For 8-bit WAV, data is unsigned (0-255, 128 is silence).
        // If input pcmData (for bitsPerSample=8) represents signed 8-bit samples (-128 to 127),
        // it needs to be converted to unsigned by adding 128.
        if (bitsPerSample === 8) {
            const targetDataView = new Uint8Array(wavBuffer, offset, dataSize);
            for (let i = 0; i < dataSize; i++) {
                // Assuming pcmData[i] is a byte representing a signed 8-bit sample.
                // Convert to signed value, then shift to unsigned range for WAV.
                const signedSample = pcmData[i] < 128 ? pcmData[i] : pcmData[i] - 256;
                targetDataView[i] = signedSample + 128;
            }
        } else {
            // For 16-bit (and others), assume pcmData is already in the correct byte format
            // (e.g., signed little-endian for 16-bit PCM).
            new Uint8Array(wavBuffer, offset).set(pcmData);
        }

        return new Uint8Array(wavBuffer);
    }

    // --- Helper function to convert signed 8-bit PCM (provided as a raw uint8 array) to Float32Array scaled to [-1.0, 1.0] ---
    public static pcm8BitToFloat32(pcmData: Uint8Array) {
        const numSamples = pcmData.length;
        const float32Array = new Float32Array(numSamples);

        // reinterpret the raw Uint8Array as a signed byte array
        const int8Array = new Int8Array(pcmData.buffer, pcmData.byteOffset, numSamples);

        // Convert each sample to a float in the range [-1.0, 1.0]
        for (let i = 0; i < numSamples; i++) {
            // in normal usage, the mic only uses about half of the dynamic range
            // so to scale the 8-bit signed value to a float in the range [-1.0, 1.0]
            // we divide by 64 instead of 128, then clamp to [-1.0, 1.0]
            float32Array[i] = int8Array[i] / 64.0;
            if (float32Array[i] < -1.0) {
                float32Array[i] = -1.0;
            } else if (float32Array[i] > 1.0) {
                float32Array[i] = 1.0;
            }
        }
        return float32Array;
    }

    // --- Helper function to convert signed 16-bit PCM (provided as a raw uint8 array) to Float32Array scaled to [-1.0, 1.0] ---
    public static pcm16BitToFloat32(pcmData: Uint8Array) {
        const numSamples = pcmData.length / 2;
        const float32Array = new Float32Array(numSamples);
        const dataView = new DataView(pcmData.buffer, pcmData.byteOffset, pcmData.byteLength);

        for (let i = 0; i < numSamples; i++) {
            const int16Value = dataView.getInt16(i * 2);
            // in normal usage, the mic only uses about half of the dynamic range
            // so to scale the 16-bit signed value to a float in the range [-1.0, 1.0]
            // we divide by 16384 instead of 32768, then clamp to [-1.0, 1.0]
            let floatValue = int16Value / 16384.0; // Scale to [-1.0, 1.0]
            if (floatValue < -1.0) {
                floatValue = -1.0;
            } else if (floatValue > 1.0) {
                floatValue = 1.0;
            }
            float32Array[i] = floatValue;
        }
        return float32Array;
    }
}
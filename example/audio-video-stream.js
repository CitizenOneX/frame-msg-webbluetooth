// External imports - these modules need to be available (e.g., via npm install)
import { FrameMsg, StdLua, TxCode, TxCaptureSettings } from 'frame-msg';
import jpeg from 'jpeg-js'; // Used by RxPhoto

// Assuming audio_video_frame_app.lua is in a 'lua' subdirectory
// and your build setup handles '?raw' imports (e.g., Vite, Webpack)
import frameApp from './lua/audio_video_frame_app.lua?raw';


// --- AsyncQueue Class (from audio.ts / photo.ts) ---
class AsyncQueue {
    constructor() {
        this.promises = [];
        this.resolvers = [];
    }

    add() {
        this.promises.push(new Promise(resolve => {
            this.resolvers.push(resolve);
        }));
    }

    put(value) { //
        if (!this.resolvers.length) {
            this.add();
        }
        const resolve = this.resolvers.shift();
        if (resolve) {
            resolve(value);
        }
    }

    async get() { //
        if (!this.promises.length) {
            this.add();
        }
        const promise = this.promises.shift();
        if (promise) {
            return promise;
        }
        // Fallback from provided AsyncQueue
        return new Promise(resolve => {
            this.resolvers.push(resolve);
            this.promises.push(this.get());
        });
    }

    isEmpty() { //
        return this.promises.length === 0;
    }

    size() { //
        return this.promises.length;
    }

    clear() { //
        this.promises = [];
        this.resolvers = [];
    }
}

// --- RxAudio Class (adapted from audio.ts) ---
class RxAudio {
    constructor(options = {}) {
        this.nonFinalChunkFlag = options.nonFinalChunkFlag ?? 0x05; //
        this.finalChunkFlag = options.finalChunkFlag ?? 0x06; //
        this.streaming = options.streaming ?? false; //
        this.queue = null;
        this._audioBuffer = []; //
    }

    concatenateAudioData() {
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

    handleData(data) { //
        if (!this.queue) {
            console.warn("RxAudio: Received data but queue not initialized - call attach() first"); //
            return;
        }

        const flag = data[0]; //
        const chunk = data.slice(1); //

        if (this.streaming) { //
            if (chunk.length > 0) {
                this.queue.put(chunk); //
            }
            if (flag === this.finalChunkFlag) {
                this.queue.put(null); // Signal end of stream
            }
        } else {
            this._audioBuffer.push(chunk); //
            if (flag === this.finalChunkFlag) { //
                const completeAudio = this.concatenateAudioData();
                this._audioBuffer = []; // Reset buffer
                this.queue.put(completeAudio); //
                this.queue.put(null); // Signal end of clip
            }
        }
    }

    async attach(frame) { //
        this.queue = new AsyncQueue(); //
        this._audioBuffer = []; // Reset audio buffer
        frame.registerDataResponseHandler(
            this,
            [this.nonFinalChunkFlag, this.finalChunkFlag],
            this.handleData.bind(this) //
        );
        return this.queue;
    }

    detach(frame) { //
        frame.unregisterDataResponseHandler(this); //
        if (this.queue) {
            this.queue.clear();
        }
        this.queue = null; //
        this._audioBuffer = []; // Reset audio buffer
    }

    static writeString(view, offset, str) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    static toWavBytes(pcmData, sampleRate = 8000, bitsPerSample = 16, channels = 1) { //
        const byteRate = sampleRate * channels * (bitsPerSample / 8); //
        const dataSize = pcmData.length; //
        const fileSizeField = 36 + dataSize; //
        const headerLength = 44;
        const wavBuffer = new ArrayBuffer(headerLength + dataSize);
        const view = new DataView(wavBuffer);
        let offset = 0;

        RxAudio.writeString(view, offset, 'RIFF'); offset += 4; //
        view.setUint32(offset, fileSizeField, true); offset += 4; //
        RxAudio.writeString(view, offset, 'WAVE'); offset += 4; //
        RxAudio.writeString(view, offset, 'fmt '); offset += 4; //
        view.setUint32(offset, 16, true); offset += 4;
        view.setUint16(offset, 1, true); offset += 2;
        view.setUint16(offset, channels, true); offset += 2; //
        view.setUint32(offset, sampleRate, true); offset += 4; //
        view.setUint32(offset, byteRate, true); offset += 4; //
        view.setUint16(offset, channels * (bitsPerSample / 8), true); offset += 2;
        view.setUint16(offset, bitsPerSample, true); offset += 2; //
        RxAudio.writeString(view, offset, 'data'); offset += 4; //
        view.setUint32(offset, dataSize, true); offset += 4; //
        new Uint8Array(wavBuffer, offset).set(pcmData);
        return new Uint8Array(wavBuffer);
    }

    isDetached() { // Added helper, assuming null queue means detached
        return this.queue === null;
    }
}

// --- RxPhoto Class (adapted from photo.ts) ---
class RxPhoto {
    static _jpegHeaderMap = {}; //

    constructor(options = {}) {
        this.nonFinalChunkFlag = options.nonFinalChunkFlag ?? 0x07; //
        this.finalChunkFlag = options.finalChunkFlag ?? 0x08; //
        this.upright = options.upright ?? true; //
        this.isRaw = options.isRaw ?? false; //
        this.quality = options.quality ?? null; //
        this.resolution = options.resolution ?? null; //
        this.queue = null;
        this._imageDataChunks = []; //
    }

    static hasJpegHeader(quality, resolution) { //
        return `${quality}_${resolution}` in RxPhoto._jpegHeaderMap;
    }

    concatenateImageData() {
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

    handleData(data) { //
        if (!this.queue) {
            console.warn("RxPhoto: Received data but queue not initialized - call attach() first"); //
            return;
        }
        const flag = data[0]; //
        const chunk = data.slice(1); //
        this._imageDataChunks.push(chunk); //

        if (flag === this.finalChunkFlag) { //
            this._processCompleteImage().catch(error => {
                console.error("RxPhoto: Error processing complete image:", error);
                this._imageDataChunks = [];
            });
        }
    }

    async _processCompleteImage() { //
        if (!this.queue) return;

        let finalImageBytes;
        const receivedImageData = this.concatenateImageData();
        this._imageDataChunks = []; // Clear chunks immediately

        if (this.isRaw) { //
            if (!this.quality || !this.resolution) { //
                 throw new Error("RxPhoto: Quality and resolution must be set for raw images if no header is cached."); //
            }
            const key = `${this.quality}_${this.resolution}`; //
            const header = RxPhoto._jpegHeaderMap[key]; //
            if (!header) { //
                throw new Error(
                    `RxPhoto: No JPEG header found for quality ${this.quality} ` + //
                    `and resolution ${this.resolution} - request full JPEG first to cache header.` //
                );
            }
            const combined = new Uint8Array(header.length + receivedImageData.length); //
            combined.set(header, 0); //
            combined.set(receivedImageData, header.length); //
            finalImageBytes = combined;
        } else {
            finalImageBytes = receivedImageData;
            if (this.quality && this.resolution) { //
                const key = `${this.quality}_${this.resolution}`; //
                if (!RxPhoto._jpegHeaderMap[key]) { //
                    const headerCandidate = finalImageBytes.slice(0, 623); //
                    RxPhoto._jpegHeaderMap[key] = headerCandidate; //
                }
            }
        }

        if (this.upright) { //
            console.log("Rotating image 90 degrees counter-clockwise"); //
            this.queue.put(await this.rotateJpeg90CounterClockwise(finalImageBytes)); //
        } else {
            this.queue.put(finalImageBytes);
        }
    }

    async attach(frame) { //
        if (this.isRaw && (!this.quality || !this.resolution)) { //
             console.warn("RxPhoto: Handling raw images without quality/resolution specified. Header must be pre-cached or will fail."); //
        }
        this.queue = new AsyncQueue(); //
        this._imageDataChunks = []; //
        frame.registerDataResponseHandler(
            this,
            [this.nonFinalChunkFlag, this.finalChunkFlag],
            this.handleData.bind(this) //
        );
        return this.queue;
    }

    detach(frame) { //
        frame.unregisterDataResponseHandler(this); //
        if (this.queue) {
            this.queue.clear(); //
        }
        this.queue = null; //
        this._imageDataChunks = []; //
    }

    async rotateJpeg90CounterClockwise(inputBytes) { //
        const rawImageData = jpeg.decode(inputBytes, { useTArray: true }); //
        if (!rawImageData || !rawImageData.data || !rawImageData.width || !rawImageData.height) { //
            throw new Error('Failed to decode JPEG image.'); //
        }
        const canvas = document.createElement('canvas'); //
        canvas.width = rawImageData.height; //
        canvas.height = rawImageData.width; //
        const ctx = canvas.getContext('2d'); //
        if (!ctx) { //
            throw new Error('Failed to get canvas 2D context.'); //
        }
        const tempCanvas = document.createElement('canvas'); //
        tempCanvas.width = rawImageData.width; //
        tempCanvas.height = rawImageData.height; //
        const tempCtx = tempCanvas.getContext('2d'); //
        if (!tempCtx) { //
            throw new Error('Failed to get temporary canvas 2D context.'); //
        }
        tempCtx.putImageData(new ImageData( //
            new Uint8ClampedArray(rawImageData.data.buffer), //
            rawImageData.width, //
            rawImageData.height //
        ), 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height); //
        ctx.translate(0, canvas.height); //
        ctx.rotate(-90 * Math.PI / 180); //
        ctx.drawImage(tempCanvas, 0, 0); //
        const blob = await new Promise((resolve, reject) => { //
            canvas.toBlob((b) => { //
                if (b) resolve(b); //
                else reject(new Error('Failed to convert canvas to JPEG blob.')); //
            }, 'image/jpeg'); //
        });
        const arrayBuffer = await blob.arrayBuffer(); //
        return new Uint8Array(arrayBuffer); //
    }
}


// --- Helper function to convert 16-bit PCM to Float32Array ---
function pcm16BitToFloat32(uint8Array) {
    const numSamples = uint8Array.length / 2;
    const int16Array = new Int16Array(numSamples);
    const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
    for (let i = 0; i < numSamples; i++) {
        int16Array[i] = dataView.getInt16(i * 2, true); // true for little-endian
    }
    const float32Array = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        float32Array[i] = int16Array[i] / 32768.0; // Scale to [-1.0, 1.0]
    }
    return float32Array;
}

// --- AudioWorkletProcessor code as a string ---
const pcmPlayerProcessorCode = `
class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        this._buffer = [];
        this._totalSamplesQueued = 0;
        this._maxBufferedSamples = (options.processorOptions.sampleRate || sampleRate || 8000) * 5;

        this.port.onmessage = (event) => {
            if (event.data === null) {
                return;
            }
            if (this._totalSamplesQueued + event.data.length <= this._maxBufferedSamples) {
                this._buffer.push(event.data);
                this._totalSamplesQueued += event.data.length;
            } else {
                console.warn('PCMPlayerProcessor: Buffer full, dropping audio data.');
            }
        };
    }

    process(inputs, outputs, parameters) {
        const outputChannel = outputs[0][0];
        for (let i = 0; i < outputChannel.length; i++) {
            if (this._buffer.length > 0 && this._buffer[0].length > 0) {
                outputChannel[i] = this._buffer[0][0];
                this._buffer[0] = this._buffer[0].subarray(1);
                if (this._buffer[0].length === 0) {
                    this._buffer.shift();
                }
                this._totalSamplesQueued--;
            } else {
                outputChannel[i] = 0;
            }
        }
        return true;
    }
}
registerProcessor('pcm-player-processor', PCMPlayerProcessor);
`;

// --- Main application ---
let imageDisplayElement = null; // Single image element for display

export async function run() {
    const frame = new FrameMsg();
    let audioContext;
    let pcmPlayerNode;
    let audioQueue;
    let photoQueue;
    let rxAudioInstance; // Renamed to avoid conflict with class name
    let rxPhotoInstance; // Renamed to avoid conflict with class name
    let keepRunning = true;
    let lastPhotoTimeMs = 0;
    const photoIntervalMs = 5000; // 5 seconds

    const SAMPLE_RATE = 8000;

    try {
        console.log("Connecting to Frame...");
        await frame.connect();
        console.log('Connected to Frame.');
        await frame.sendBreakSignal();

        const battMem = await frame.sendLua('print(frame.battery_level() .. " / " .. collectgarbage("count"))', { awaitPrint: true });
        console.log(`Battery Level/Memory used: ${battMem}`);

        await frame.printShortText('Loading A/V...');
        await frame.uploadStdLuaLibs([StdLua.DataMin, StdLua.CodeMin, StdLua.AudioMin, StdLua.CameraMin]);
        await frame.uploadFrameApp(frameApp);
        frame.attachPrintResponseHandler(console.log);
        await frame.startFrameApp();
        console.log("Frame app (audio_video_frame_app.lua) started.");

        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        const blob = new Blob([pcmPlayerProcessorCode], { type: 'application/javascript' });
        const processorUrl = URL.createObjectURL(blob);
        await audioContext.audioWorklet.addModule(processorUrl);
        URL.revokeObjectURL(processorUrl);

        pcmPlayerNode = new AudioWorkletNode(audioContext, 'pcm-player-processor', {
            processorOptions: { sampleRate: SAMPLE_RATE }
        });
        pcmPlayerNode.connect(audioContext.destination);

        rxAudioInstance = new RxAudio({ streaming: true });
        audioQueue = await rxAudioInstance.attach(frame);

        rxPhotoInstance = new RxPhoto({ upright: true }); // Assuming upright: true is desired
        photoQueue = await rxPhotoInstance.attach(frame);

        console.log("Requesting Frame to start audio stream...");
        await frame.sendMessage(0x30, new TxCode(1).pack());

        console.log('Starting audio/video streaming loop...');
        lastPhotoTimeMs = Date.now();

        while (keepRunning) {
            let audioSamples = null;
            try {
                const audioPromise = audioQueue.get();
                const audioTimeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 10000));
                const result = await Promise.race([audioPromise, audioTimeoutPromise]);

                if (result === 'timeout') {
                    // audio get timed out
                } else {
                    audioSamples = result;
                }
            } catch (audioError) {
                console.error("Error getting audio from queue:", audioError);
            }

            if (audioSamples === null) {
                if (rxAudioInstance?.isDetached() || (audioSamples === null && !frame.isConnected())) {
                     console.log("Audio stream appears to have ended.");
                     keepRunning = false;
                     if (pcmPlayerNode) pcmPlayerNode.port.postMessage(null);
                }
            } else if (audioSamples.length > 0 && pcmPlayerNode) {
                const float32Chunk = pcm16BitToFloat32(audioSamples);
                pcmPlayerNode.port.postMessage(float32Chunk);
            }

            if (!keepRunning) break;

            const currentTimeMs = Date.now();
            if (currentTimeMs - lastPhotoTimeMs >= photoIntervalMs) {
                console.log("Requesting photo...");
                const captureSettings = new TxCaptureSettings();
                await frame.sendMessage(0x0d, captureSettings.pack());
                lastPhotoTimeMs = currentTimeMs;

                try {
                    console.log("Waiting for photo data...");
                    const jpegBytesPromise = photoQueue.get();
                    const photoTimeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), 10000));
                    const photoResult = await Promise.race([jpegBytesPromise, photoTimeoutPromise]);

                    if (photoResult === 'timeout') {
                        console.warn("Photo receive timed out.");
                    } else {
                        const jpegBytes = photoResult;
                        if (jpegBytes && jpegBytes.length > 0) {
                            console.log("Photo received, length:", jpegBytes.length);
                            if (!imageDisplayElement) {
                                imageDisplayElement = document.createElement('img');
                                imageDisplayElement.style.maxWidth = "100%";
                                imageDisplayElement.style.paddingTop = "5px";
                                imageDisplayElement.alt = "Live photo from Frame";
                                document.body.appendChild(imageDisplayElement);
                            }
                            const oldUrl = imageDisplayElement.src;
                            if (oldUrl && oldUrl.startsWith('blob:')) {
                                URL.revokeObjectURL(oldUrl);
                            }
                            imageDisplayElement.src = URL.createObjectURL(new Blob([jpegBytes], { type: 'image/jpeg' }));
                        } else {
                            console.warn("No photo data received or photo was empty.");
                        }
                    }
                } catch (photoError) {
                    console.error("Error during photo capture/retrieval:", photoError);
                }
            }
            if (!audioSamples && keepRunning) {
                 await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    } catch (error) {
        console.error("An error occurred in the main application flow:", error);
        keepRunning = false;
    } finally {
        console.log("Cleaning up resources...");
        if (frame.isConnected()) {
            try {
                console.log("Requesting Frame to stop audio stream...");
                await frame.sendMessage(0x30, new TxCode(0).pack());
            } catch (e) {
                console.error("Error sending stop audio command to Frame:", e);
            }
        }
        if (rxAudioInstance && frame.isConnected()) {
            try {
                await rxAudioInstance.detach(frame);
                console.log("RxAudio detached.");
            } catch (e) {
                console.error("Error detaching RxAudio:", e);
            }
        }
        if (rxPhotoInstance && frame.isConnected()) {
            try {
                await rxPhotoInstance.detach(frame);
                console.log("RxPhoto detached.");
            } catch (e) {
                console.error("Error detaching RxPhoto:", e);
            }
        }
        if (pcmPlayerNode) {
            try {
                pcmPlayerNode.disconnect();
                console.log("AudioWorkletNode disconnected.");
            } catch (e) { /* Ignore */ }
        }
        if (audioContext && audioContext.state !== 'closed') {
            try {
                await audioContext.close();
                console.log("AudioContext closed.");
            } catch (e) { /* Ignore */ }
        }
        if (frame.isConnected()) {
            try {
                frame.detachPrintResponseHandler();
                await frame.stopFrameApp();
                console.log("Frame app stopped.");
            } catch (e) {
                console.error("Error stopping Frame app:", e);
            }
            try {
                await frame.disconnect();
                console.log("Disconnected from Frame.");
            } catch (e) {
                console.error("Error disconnecting from Frame:", e);
            }
        }
        if (imageDisplayElement && imageDisplayElement.src.startsWith('blob:')) {
             URL.revokeObjectURL(imageDisplayElement.src); // Clean up last blob URL
        }
        console.log("Cleanup complete.");
    }
}

// To run this, you might have a button in your HTML:
// <button id="startStreamButton">Start Audio/Video Stream</button>
// And then in a <script type="module"> tag:
// import { run } from './audio_video_stream.js'; // Adjust path as needed
// document.getElementById('startStreamButton')?.addEventListener('click', () => {
//   run().catch(console.error);
// });
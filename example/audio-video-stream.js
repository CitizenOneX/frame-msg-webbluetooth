import { FrameMsg, StdLua, TxCode, TxCaptureSettings, RxAudio, RxPhoto } from 'frame-msg';
import frameApp from './lua/audio_video_frame_app.lua?raw';


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
    let rxAudio;
    let rxPhoto;
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

        await frame.printShortText('Loading...');
        await frame.uploadStdLuaLibs([StdLua.DataMin, StdLua.CodeMin, StdLua.AudioMin, StdLua.CameraMin]);
        await frame.uploadFrameApp(frameApp);
        frame.attachPrintResponseHandler(console.log);
        await frame.startFrameApp();
        console.log("Frame app started.");

        audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        const blob = new Blob([pcmPlayerProcessorCode], { type: 'application/javascript' });
        const processorUrl = URL.createObjectURL(blob);
        await audioContext.audioWorklet.addModule(processorUrl);
        URL.revokeObjectURL(processorUrl);

        pcmPlayerNode = new AudioWorkletNode(audioContext, 'pcm-player-processor', {
            processorOptions: { sampleRate: SAMPLE_RATE }
        });
        pcmPlayerNode.connect(audioContext.destination);

        rxAudio = new RxAudio({ streaming: true });
        audioQueue = await rxAudio.attach(frame);

        rxPhoto = new RxPhoto({ upright: true }); // Assuming upright: true is desired
        photoQueue = await rxPhoto.attach(frame);

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
                if (rxAudio?.isDetached() || (audioSamples === null && !frame.isConnected())) {
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
        if (rxAudio && frame.isConnected()) {
            try {
                await rxAudio.detach(frame);
                console.log("RxAudio detached.");
            } catch (e) {
                console.error("Error detaching RxAudio:", e);
            }
        }
        if (rxPhoto && frame.isConnected()) {
            try {
                await rxPhoto.detach(frame);
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

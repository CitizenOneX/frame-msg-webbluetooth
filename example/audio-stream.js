import { FrameMsg, StdLua, RxAudio, TxCode } from 'frame-msg';
import frameApp from './lua/audio_frame_app.lua?raw';

// Helper function to convert 16-bit PCM (as Uint8Array) to Float32Array
// Assumes little-endian 16-bit signed integers.
function pcm16BitToFloat32(uint8Array) {
    // Ensure the Uint8Array's buffer is correctly aligned and sized for Int16Array view
    const numSamples = uint8Array.length / 2;
    const int16Array = new Int16Array(numSamples);
    const dataView = new DataView(uint8Array.buffer, uint8Array.byteOffset);

    for (let i = 0; i < numSamples; i++) {
        int16Array[i] = dataView.getInt16(i * 2, true); // true for little-endian
    }

    const float32Array = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        float32Array[i] = int16Array[i] / 32768.0; // Scale to [-1.0, 1.0]
    }
    return float32Array;
}

// Define the AudioWorkletProcessor code as a string
const pcmPlayerProcessorCode = `
class PCMPlayerProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super(options);
        // A simple FIFO queue for audio chunks (Float32Array)
        this._buffer = [];
        this._totalSamplesQueued = 0;
        // Buffer up to a few seconds of audio to handle network jitter, etc.
        // 8000Hz * 1 channel * 5 seconds = 40000 samples
        this._maxBufferedSamples = (options.processorOptions.sampleRate || sampleRate || 8000) * 5;


        this.port.onmessage = (event) => {
            if (event.data === null) { // Null can be a signal to prepare for shutdown
                // For this example, we'll just let any buffered audio play out.
                // A more sophisticated processor could handle this to stop sooner.
                return;
            }
            if (this._totalSamplesQueued + event.data.length <= this._maxBufferedSamples) {
                this._buffer.push(event.data); // event.data is a Float32Array chunk
                this._totalSamplesQueued += event.data.length;
            } else {
                console.warn('PCMPlayerProcessor: Buffer full, dropping audio data.');
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];
        const outputChannel = output[0]; // Assuming mono output

        let samplesWrittenThisBlock = 0;

        for (let i = 0; i < outputChannel.length; i++) {
            if (this._buffer.length > 0 && this._buffer[0].length > 0) {
                outputChannel[i] = this._buffer[0][0]; // Get sample
                this._buffer[0] = this._buffer[0].subarray(1); // "Consume" sample (inefficient for large arrays, but simple for demo)

                if (this._buffer[0].length === 0) {
                    this._buffer.shift(); // Remove empty chunk from queue
                }
                this._totalSamplesQueued--;
                samplesWrittenThisBlock++;
            } else {
                outputChannel[i] = 0; // Output silence if no data available
            }
        }
        // Return true to keep the processor alive.
        // Return false to allow it to be garbage-collected if it's silent and no more data is expected.
        return true;
    }
}
registerProcessor('pcm-player-processor', PCMPlayerProcessor);
`;

export async function run() {
    const frame = new FrameMsg();
    let audioContext;
    let pcmPlayerNode;
    let audioQueue; // To store the RxAudio queue
    let rxAudio; // To store the RxAudio instance
    let keepStreaming = true; // Flag to control the streaming loop

    // --- IMPORTANT AUDIO PARAMETERS ---
    // These should match the audio source from your Frame device
    const SAMPLE_RATE = 8000; // e.g., 8000 Hz, 16000 Hz, etc.
    // const CHANNELS = 1; // Assuming mono

    try {
        console.log("Connecting to Frame...");
        const deviceId = await frame.connect();
        console.log('Connected to:', deviceId);

        await frame.sendBreakSignal();

        const battMem = await frame.sendLua('print(frame.battery_level() .. " / " .. collectgarbage("count"))', { awaitPrint: true });
        console.log(`Battery Level/Memory used: ${battMem}`);

        await frame.printShortText('Loading...');
        await frame.uploadStdLuaLibs([StdLua.DataMin, StdLua.AudioMin, StdLua.CodeMin]);
        await frame.uploadFrameApp(frameApp);
        frame.attachPrintResponseHandler(console.log);
        await frame.startFrameApp();

        // 1. Setup Web Audio API
        audioContext = new (window.AudioContext || window.webkitAudioContext)({
            sampleRate: SAMPLE_RATE // Set the sample rate for the AudioContext
        });

        // Create a Blob URL for the AudioWorklet processor
        const blob = new Blob([pcmPlayerProcessorCode], { type: 'application/javascript' });
        const processorUrl = URL.createObjectURL(blob);

        await audioContext.audioWorklet.addModule(processorUrl);
        URL.revokeObjectURL(processorUrl); // Clean up Blob URL once module is loaded

        pcmPlayerNode = new AudioWorkletNode(audioContext, 'pcm-player-processor', {
            processorOptions: { sampleRate: SAMPLE_RATE }
        });
        pcmPlayerNode.connect(audioContext.destination);

        // 2. Setup RxAudio for streaming
        rxAudio = new RxAudio({ streaming: true }); // Initialize in streaming mode
        audioQueue = await rxAudio.attach(frame); //

        // 3. Tell Frame to start sending audio data
        console.log("Requesting Frame to start audio stream...");
        await frame.sendMessage(0x30, new TxCode(1).pack()); // Start audio command

        console.log("Audio streaming started. Listening for data...");

        // 4. Asynchronous loop to get audio data and send it to the player
        const processAudioChunks = async () => {
            while (keepStreaming) {
                const chunk = await audioQueue.get(); // Get Uint8Array chunk or null

                if (chunk === null) {
                    console.log("End of audio stream signal (null chunk) received from RxAudio.");
                    keepStreaming = false; // Stop the loop
                    if (pcmPlayerNode) {
                         pcmPlayerNode.port.postMessage(null); // Optionally signal processor
                    }
                    break;
                }

                if (chunk.length > 0 && pcmPlayerNode && keepStreaming) {
                    const float32Chunk = pcm16BitToFloat32(chunk);
                    pcmPlayerNode.port.postMessage(float32Chunk);
                }
            }
            console.log("Audio processing loop finished.");
        };

        const audioProcessingPromise = processAudioChunks();

        // 5. Stream for a certain duration (e.g., 10 seconds for this example)
        console.log("Streaming audio to speakers for 10 seconds...");
        await new Promise(resolve => setTimeout(resolve, 10000));

        console.log("10 seconds elapsed. Stopping audio stream...");

    } catch (error) {
        console.error("Error during audio streaming:", error);
    } finally {
        keepStreaming = false; // Ensure the loop stops in case of error or normal completion

        console.log("Cleaning up resources...");

        // 6. Tell Frame to stop sending audio data
        if (frame.isConnected()) {
            try {
                console.log("Requesting Frame to stop audio stream...");
                await frame.sendMessage(0x30, new TxCode(0).pack()); // Stop audio command
            } catch (e) {
                console.error("Error sending stop stream command to Frame:", e);
            }
        }

        // Detach RxAudio. This should be done before closing the audio context or node.
        if (rxAudio && frame) {
            try {
                rxAudio.detach(frame); //
                console.log("RxAudio detached.");
            } catch (e) {
                console.error("Error detaching RxAudio:", e);
            }
        }

        // Disconnect and close Web Audio API resources
        if (pcmPlayerNode) {
            try {
                pcmPlayerNode.disconnect();
                console.log("AudioWorkletNode disconnected.");
            } catch (e) {
                console.error("Error disconnecting AudioWorkletNode:", e);
            }
        }
        if (audioContext && audioContext.state !== 'closed') {
            try {
                await audioContext.close();
                console.log("AudioContext closed.");
            } catch (e) {
                console.error("Error closing AudioContext:", e);
            }
        }

        // Stop the Lua app and disconnect from Frame
        if (frame.isConnected()) {
            try {
                await frame.stopFrameApp();
                await frame.disconnect();
                console.log("Disconnected from Frame.");
            } catch (e) {
                console.error("Error during final Frame cleanup:", e);
            }
        }
        console.log("Cleanup complete.");
    }
}

import { FrameMsg, StdLua, RxAudio, TxCode } from 'frame-msg';
import frameApp from './lua/audio_frame_app.lua?raw';

// Record an audio clip using Frame's microphone and play it back
// This example uses the RxAudio class to receive audio data from Frame
export async function run() {
  const frame = new FrameMsg();

  try {
    // Web Bluetooth API requires a user gesture to initiate the connection
    // This is usually a button click or similar event
    console.log("Connecting to Frame...");
    const deviceId = await frame.connect();
    console.log('Connected to:', deviceId);

    // Send a break signal to the Frame in case it is in a loop
    await frame.sendBreakSignal();

    // debug only: check our current battery level and memory usage
    const battMem = await frame.sendLua('print(frame.battery_level() .. " / " .. collectgarbage("count"))', {awaitPrint: true});
    console.log(`Battery Level/Memory used: ${battMem}`);

    // Let the user know we're starting
    await frame.printShortText('Loading...');

    // send the std lua files to Frame
    await frame.uploadStdLuaLibs([StdLua.DataMin, StdLua.AudioMin, StdLua.CodeMin]);

    // Send the main lua application from this project to Frame that will run the app
    await frame.uploadFrameApp(frameApp);

    // attach the print response handler
    frame.attachPrintResponseHandler(console.log);

    // "require" the main frame_app lua file to run it
    await frame.startFrameApp();

    // hook up the RxAudio receiver
    const rxAudio = new RxAudio({ streaming: false }); // Explicitly non-streaming
    const audioQueue = await rxAudio.attach(frame);

    // Tell Frame to start streaming audio
    // Assuming 0x30 is the correct message ID and new TxCode(1).pack() is the start command
    await frame.sendMessage(0x30, new TxCode(1).pack());

    console.log("Recording audio for 5 seconds...");
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Stop the audio stream
    console.log("Stopping audio...");
    // Assuming new TxCode(0).pack() is the stop command
    await frame.sendMessage(0x30, new TxCode(0).pack());

    // Get the raw PCM audio data from RxAudio
    // RxAudio (non-streaming) puts the complete audio data first, then null
    const pcmData = await audioQueue.get();

    if (pcmData && pcmData.length > 0) {
      console.log("Raw PCM audio data received, length:", pcmData.length);

      // Convert the raw PCM data to WAV format
      // Assuming default audio parameters (8000 Hz, 16-bit, 1 channel)
      // If your Frame device uses different parameters, specify them here.
      // e.g., RxAudio.toWavBytes(pcmData, 16000, 16, 1) for 16kHz sample rate.
      const wavBytes = RxAudio.toWavBytes(pcmData);
      console.log("WAV data created, length:", wavBytes.length);

      // Play the audio clip using the Web Audio API
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      // decodeAudioData expects an ArrayBuffer
      const audioBuffer = await audioContext.decodeAudioData(wavBytes.buffer);
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContext.destination);
      source.start(0);
      console.log("Playing audio clip...");

      // Wait for the audio to finish playing before detaching or disconnecting
      // You might need a more robust way to determine when playback finishes
      await new Promise(resolve => source.onended = resolve);
      console.log("Audio playback finished.");

    } else {
      console.error("No audio data received or data is empty.");
    }

    // Consume the null terminator from the queue
    const endSignal = await audioQueue.get();
    if (endSignal !== null) {
        console.warn("Expected null terminator from audio queue after data, but received:", endSignal);
    }

    // stop the audio listener and clean up its resources
    rxAudio.detach(frame);

    // unhook the print handler
    frame.detachPrintResponseHandler();

    // break out of the frame app loop and reboot Frame
    await frame.stopFrameApp();

  } catch (error) {
    console.error("Error in run function:", error);
  } finally {
    // Ensure the Frame is disconnected in case of an error
    try {
      if (frame.isConnected()) {
        await frame.disconnect();
        console.log("Disconnected from Frame.");
      }
    } catch (disconnectError) {
      console.error("Error during disconnection:", disconnectError);
    }
  }
}
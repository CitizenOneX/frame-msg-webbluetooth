import { FrameMsg, StdLua, TxSprite, TxImageSpriteBlock } from 'frame-msg';
import frameApp from './lua/prog_sprite_jpg_frame_app.lua?raw';

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

    // debug only: check our current battery level and memory usage (which varies between 16kb and 31kb or so even after the VM init)
    const battMem = await frame.sendLua('print(frame.battery_level() .. " / " .. collectgarbage("count"))', {awaitPrint: true});
    console.log(`Battery Level/Memory used: ${battMem}`);

    // Let the user know we're starting
    await frame.printShortText('Loading...');

    // send the std lua files to Frame that handle data accumulation and text display
    await frame.uploadStdLuaLibs([StdLua.DataMin, StdLua.SpriteMin, StdLua.ImageSpriteBlockMin]);

    // Send the main lua application from this project to Frame that will run the app
    await frame.uploadFrameApp(frameApp);

    // attach the print response handler so we can see stdout from Frame Lua print() statements
    // If we assigned this handler before the frameside app was running,
    // any await_print=True commands will echo the acknowledgement byte (e.g. "1"), but if we assign
    // the handler now we'll see any lua exceptions (or stdout print statements)
    frame.attachPrintResponseHandler(console.log);

    // "require" the main frame_app lua file to run it, and block until it has started.
    // It signals that it is ready by sending something on the string response channel.
    await frame.startFrameApp();

    // Quantize the image and send the image to Frame in chunks
    // read in the image bytes from "images/koala.jpg" and send it to the Frame
    const response = await fetch(new URL('./images/koala.jpg', import.meta.url));
    const imageBytes = new Uint8Array(await response.arrayBuffer());
    const sprite = await TxSprite.fromImageBytes(imageBytes);
    const isb = new TxImageSpriteBlock(sprite, 20);
    // send the Image Sprite Block header
    await frame.sendMessage(0x20, isb.pack());

    // then send all the slices
    for (const spr of isb.spriteLines) {
      await frame.sendMessage(0x20, spr.pack());
    }

    // sleep for 5 seconds to allow the user to see the image
    await new Promise(resolve => setTimeout(resolve, 5000));

    // unhook the print handler
    frame.detachPrintResponseHandler()

    // break out of the frame app loop and reboot Frame
    await frame.stopFrameApp()
  }
  catch (error) {
    console.error("Error:", error);
  }
  finally {
    // Ensure the Frame is disconnected in case of an error
    try {
      await frame.disconnect();
      console.log("Disconnected from Frame.");
    } catch (disconnectError) {
      console.error("Error during disconnection:", disconnectError);
    }
  }
};

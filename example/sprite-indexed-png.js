import { FrameMsg, StdLua, TxSprite } from 'frame-msg';
import frameApp from './lua/sprite_indexed_png_frame_app.lua?raw';

export async function run() {
  const frame = new FrameMsg();

  try {
    // Web Bluetooth API requires a user gesture to initiate the connection
    // This is usually a button click or similar event
    console.log("Connecting to Frame...");
    const deviceId = await frame.connect();
    console.log('Connected to:', deviceId);

    // debug only: check our current battery level and memory usage (which varies between 16kb and 31kb or so even after the VM init)
    const battMem = await frame.sendLua('print(frame.battery_level() .. " / " .. collectgarbage("count"))', {awaitPrint: true});
    console.log(`Battery Level/Memory used: ${battMem}`);

    // Let the user know we're starting
    await frame.printShortText('Loading...');

    // send the std lua files to Frame that handle data accumulation and text display
    await frame.uploadStdLuaLibs([StdLua.DataMin, StdLua.SpriteMin]);

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

    // send the 1-bit image to Frame
    // Note that the frameside app is expecting a message of type TxSprite on msgCode 0x20
    let response = await fetch(new URL('./images/logo_1bit.png', import.meta.url));
    let imageBytes = new Uint8Array(await response.arrayBuffer());
    let sprite = await TxSprite.fromIndexedPngBytes(imageBytes);
    await frame.sendMessage(0x20, sprite.pack());

    // sleep for 20 seconds to allow the user to see the image
    await new Promise(resolve => setTimeout(resolve, 20000));

    // send the 2-bit image to Frame
    response = await fetch(new URL('./images/street_2bit.png', import.meta.url));
    imageBytes = new Uint8Array(await response.arrayBuffer());
    sprite = await TxSprite.fromIndexedPngBytes(imageBytes);
    await frame.sendMessage(0x20, sprite.pack());

    // sleep for 20 more seconds to allow the user to see the image
    await new Promise(resolve => setTimeout(resolve, 20000));

    // send the 4-bit image to Frame
    response = await fetch(new URL('./images/hotdog_4bit.png', import.meta.url));
    imageBytes = new Uint8Array(await response.arrayBuffer());
    sprite = await TxSprite.fromIndexedPngBytes(imageBytes);
    await frame.sendMessage(0x20, sprite.pack());

    // sleep for 20 seconds to allow the user to see the image
    await new Promise(resolve => setTimeout(resolve, 20000));

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

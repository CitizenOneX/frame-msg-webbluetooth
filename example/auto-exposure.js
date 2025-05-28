import { FrameMsg, StdLua, TxCaptureSettings, TxAutoExpSettings, RxPhoto, RxAutoExpResult, TxCode } from 'frame-msg';
import frameApp from './lua/auto_exposure_frame_app.lua?raw';

// Take a sequence of photos using the Frame camera with custom auto exposure settings and display it
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

    // send the std lua files to Frame
    await frame.uploadStdLuaLibs([StdLua.DataMin, StdLua.CameraMin, StdLua.CodeMin]);

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

    // hook up the RxPhoto receiver
    const rxPhoto = new RxPhoto();
    const photoQueue = await rxPhoto.attach(frame);

    // hook up the RxAutoExpResult receiver
    const rxAutoExpResult = new RxAutoExpResult();
    const autoExpQueue = await rxAutoExpResult.attach(frame);

    // take the default auto exposure settings
    // and send them to Frame before iterating over the auto exposure steps
    await frame.sendMessage(0x0e, new TxAutoExpSettings().pack());

    // create the element at the end of the body to display the photo
    const img = document.createElement('img');
    document.body.appendChild(img);

    // Iterate 5 times
    for (let i = 0; i < 5; i++) {
      // send the code to trigger the single step of the auto exposure algorithm
      await frame.sendMessage(0x0f, new TxCode().pack());

      // receive the auto exposure output from Frame
      const autoExpResult = await autoExpQueue.get();
      console.log("Auto exposure result received:", autoExpResult);

      // NOTE: it takes up to 200ms for exposure settings to take effect
      await new Promise(resolve => setTimeout(resolve, 200));

      // Request the photo by sending a TxCaptureSettings message
      // TODO should I use the {options} style for constructor parameters?
      await frame.sendMessage(0x0d, new TxCaptureSettings().pack());

      // get the jpeg bytes as soon as they're ready
      const jpegBytes = await photoQueue.get();
      console.log("Photo received, length:", jpegBytes.length);

      // display the image on the web page
      img.src = URL.createObjectURL(new Blob([jpegBytes], { type: 'image/jpeg' }));
    }

    // remove the image element from the document
    document.body.removeChild(img);

    // stop the photo listener and clean up its resources
    rxPhoto.detach(frame);

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

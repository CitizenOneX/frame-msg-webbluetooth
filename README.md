# frame-msg

A TypeScript package for handling rich application-level messages for the [Brilliant Labs Frame](https://brilliant.xyz/), including sprites, text, audio, IMU data, and photos.

[Frame SDK documentation](https://docs.brilliant.xyz/frame/frame-sdk/).

[GitHub](https://github.com/CitizenOneX/frame-msg-webbluetooth).

[Live Examples](https://citizenonex.github.io/frame-msg-webbluetooth/).

## Installation

```bash
npm install frame-msg
```

## Usage

```typescript
import { FrameMsg, StdLua, TxCaptureSettings, RxPhoto } from 'frame-msg';
import frameApp from './lua/camera_frame_app.lua?raw';

// Take a photo using the Frame camera and display it
export async function run() {
  const frame = new FrameMsg();

  try {
    const deviceId = await frame.connect();

    // Send a break signal to the Frame in case it is in a loop
    await frame.sendBreakSignal();

    // send the std lua files to Frame
    await frame.uploadStdLuaLibs([StdLua.DataMin, StdLua.CameraMin]);

    // Send the main lua application from this project to Frame that will run the app
    await frame.uploadFrameApp(frameApp);

    frame.attachPrintResponseHandler(console.log);

    // "require" the main frame_app lua file to run it, and block until it has started.
    // It signals that it is ready by sending something on the string response channel.
    await frame.startFrameApp();

    // hook up the RxPhoto receiver
    const rxPhoto = new RxPhoto();
    const photoQueue = await rxPhoto.attach(frame);

    // give Frame some time for the autoexposure to settle
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Request the photo by sending a TxCaptureSettings message
    await frame.sendMessage(0x0d, new TxCaptureSettings().pack());

    const jpegBytes = await photoQueue.get();

    // display the image on the web page
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([jpegBytes], { type: 'image/jpeg' }));
    document.body.appendChild(img);

    // stop the photo listener and clean up its resources
    rxPhoto.detach(frame);

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
```

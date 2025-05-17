import { FrameMsg } from 'frame-msg';

export async function run() {
  const frame = new FrameMsg();

  // Web Bluetooth API requires a user gesture to initiate the connection
  // This is usually a button click or similar event
  console.log("Connecting to Frame...");
  const deviceId = await frame.connect();
  console.log('Connected to:', deviceId);

  // Configure print response handler to show Frame output
  const printHandler = (data) => {
    console.log("Frame response:", data);
  };
  frame.attachPrintResponseHandler(printHandler);

  // Send a break signal to the Frame in case it is in a loop
  console.log("Sending break signal to Frame...");
  await frame.sendBreakSignal({showMe: true});
  console.log("Break signal sent.");

  // Send Lua command to Frame
  console.log("Sending Lua command to Frame...");
  var luaCommand = "frame.display.text('Hello, Frame!', 1, 1)frame.display.show()print('Response from Frame!')";
  await frame.sendLua(luaCommand, {showMe: true, awaitPrint: true});
  console.log("Lua command sent.");

  // Wait for a couple of seconds to allow the command to execute and text to be displayed
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Send Lua command to Frame
  console.log("Sending Lua command to Frame...");
  luaCommand = "frame.display.text('Goodbye, Frame!', 1, 1)frame.display.show()print('Response from Frame!')";
  await frame.sendLua(luaCommand, {showMe: true, awaitPrint: true});
  console.log("Lua command sent.");

  // Wait for a couple of seconds to allow the command to execute and text to be displayed
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log("Disconnecting from Frame...");
  await frame.disconnect();
  console.log("Disconnected from Frame.");
};

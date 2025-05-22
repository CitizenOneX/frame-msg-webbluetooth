import { FrameBle } from 'frame-ble';

// --- Standard Lua Library Imports ---
import stdDataMinLua from './lua/data.min.lua?raw';
import stdAudioMinLua from './lua/audio.min.lua?raw';
import stdCameraMinLua from './lua/camera.min.lua?raw';
import stdCodeMinLua from './lua/code.min.lua?raw';
import stdIMUMinLua from './lua/imu.min.lua?raw';
import stdImageSpriteBlockMinLua from './lua/image_sprite_block.min.lua?raw';
import stdPlainTextMinLua from './lua/plain_text.min.lua?raw';
import stdSpriteMinLua from './lua/sprite.min.lua?raw';
import stdSpriteCoordsMinLua from './lua/sprite_coords.min.lua?raw';
import stdTapMinLua from './lua/tap.min.lua?raw';

/**
 * Enum representing the available standard Lua libraries that can be uploaded.
 */
export enum StdLua {
    DataMin = "stdDataMin",
    AudioMin = "stdAudioMin",
    CameraMin = "stdCameraMin",
    CodeMin = "stdCodeMin",
    IMUMin = "stdIMUMin",
    ImageSpriteBlockMin = "stdImageSpriteBlockMin",
    PlainTextMin = "stdPlainTextMin",
    SpriteMin = "stdSpriteMin",
    SpriteCoordsMin = "stdSpriteCoordsMin",
    TapMin = "stdTapMin",
}

// Internal mapping from the enum to the actual Lua content and target filename
interface StdLibDetails {
    content: string;
    targetFileName: string;
}

const standardLuaLibrarySources: Record<StdLua, StdLibDetails> = {
    [StdLua.DataMin]: { content: stdDataMinLua, targetFileName: 'data.min.lua' },
    [StdLua.AudioMin]: { content: stdAudioMinLua, targetFileName: 'audio.min.lua' },
    [StdLua.CameraMin]: { content: stdCameraMinLua, targetFileName: 'camera.min.lua' },
    [StdLua.CodeMin]: { content: stdCodeMinLua, targetFileName: 'code.min.lua' },
    [StdLua.IMUMin]: { content: stdIMUMinLua, targetFileName: 'imu.min.lua' },
    [StdLua.ImageSpriteBlockMin]: { content: stdImageSpriteBlockMinLua, targetFileName: 'image_sprite_block.min.lua' },
    [StdLua.PlainTextMin]: { content: stdPlainTextMinLua, targetFileName: 'plain_text.min.lua' },
    [StdLua.SpriteMin]: { content: stdSpriteMinLua, targetFileName: 'sprite.min.lua' },
    [StdLua.SpriteCoordsMin]: { content: stdSpriteCoordsMinLua, targetFileName: 'sprite_coords.min.lua' },
    [StdLua.TapMin]: { content: stdTapMinLua, targetFileName: 'tap.min.lua' },
};


// Define a type for the data response handler function FrameMsg's subscribers will use
// Now expects Uint8Array
type FrameMsgDataHandler = (data: Uint8Array) => void;

// Define a type for subscribers to data responses within FrameMsg
interface DataResponseSubscriber {
    subscriber: any;
    handler: FrameMsgDataHandler;
}

/**
 * FrameMsg class handles communication with the Frame device.
 * It wraps the FrameBle class and provides higher-level methods for uploading standard Lua libraries
 * and Frame applications.
 * It also manages the registration and unregistration of data response handlers for different Rx message types.
 * Subscribers can register their own handlers for specific message codes.
 */
export class FrameMsg {
    public ble: FrameBle;
    private dataResponseHandlers: Map<number, Array<DataResponseSubscriber>>;

    constructor() {
        this.ble = new FrameBle();
        this.dataResponseHandlers = new Map<number, Array<DataResponseSubscriber>>();

        // Set FrameBle's data response handler to FrameMsg's internal multiplexer.
        // This now expects a Uint8Array from FrameBle.
        this.ble.setDataResponseHandler(this._handleDataResponse.bind(this));
    }

    /**
     * Connects to the Frame device and optionally runs the initialization sequence.
     * Note: Print and Disconnect handlers should be set directly on the FrameBle instance
     * (e.g., `frameMsg.ble.setPrintResponseHandler(...)`, `frameMsg.ble.setDisconnectHandler(...)`)
     * or via `frameMsg.attachPrintResponseHandler(...)` before or after calling connect.
     * @param initialize If true, runs the break/reset/break sequence after connecting. Defaults to true.
     * @param connectOptions Options including name and namePrefix for device filtering.
     * @returns The device ID or name if connection was successful.
     * @throws Any exceptions from the underlying FrameBle connection or initialization.
     */
    public async connect(
        initialize: boolean = true,
        connectOptions: {
            name?: string;
            namePrefix?: string;
        } = {}
    ): Promise<string | undefined> {
        try {
            const bleConnectOptions = {
                name: connectOptions.name,
                namePrefix: connectOptions.namePrefix,
            };

            const connectionResult = await this.ble.connect(bleConnectOptions);

            if (initialize) {
                await this.ble.sendBreakSignal();
                await this.ble.sendResetSignal();
                await this.ble.sendBreakSignal();
            }
            return connectionResult;
        } catch (e) {
            if (this.ble.isConnected()) {
                await this.ble.disconnect();
            }
            throw e;
        }
    }

    public async disconnect(): Promise<void> {
        if (this.ble.isConnected()) {
            await this.ble.disconnect();
        }
    }

    public isConnected(): boolean {
        return this.ble.isConnected();
    }

    public async printShortText(text: string = ''): Promise<string | void> {
        const sanitizedText = text.replace(/'/g, "\\'").replace(/\n/g, "");
        return this.ble.sendLua(`frame.display.text('${sanitizedText}',1,1);frame.display.show();print(0)`, { awaitPrint: true });
    }

    public async uploadStdLuaLibs(libs: StdLua[]): Promise<void> {
        for (const libKey of libs) {
            const libDetails = standardLuaLibrarySources[libKey];
            if (libDetails) {
                await this.ble.uploadFileFromString(libDetails.content, libDetails.targetFileName);
            } else {
                console.warn(`Standard Lua library key "${libKey}" not found. Skipping.`);
            }
        }
    }

    public async uploadFrameApp(fileContent: string, frameFileName: string = 'frame_app.lua'): Promise<void> {
        await this.ble.uploadFile(fileContent, frameFileName);
    }

    public async startFrameApp(frameAppName: string = 'frame_app', awaitPrint: boolean = true): Promise<string | void> {
        return this.ble.sendLua(`require('${frameAppName}')`, { awaitPrint: awaitPrint });
    }

    public async stopFrameApp(reset: boolean = true): Promise<void> {
        await this.ble.sendBreakSignal();
        if (reset) {
            await this.ble.sendResetSignal();
        }
    }

    public attachPrintResponseHandler(handler: (data: string) => void | Promise<void> = console.log): void {
        this.ble.setPrintResponseHandler(handler);
    }

    public detachPrintResponseHandler(): void {
        this.ble.setPrintResponseHandler(undefined);
    }

    public async sendMessage(msgCode: number, payload: Uint8Array, showMe: boolean = false): Promise<void> {
        await this.ble.sendMessage(msgCode, payload, showMe);
    }

    /**
     * Registers a handler for a subscriber interested in specific message codes from Frame.
     * @param subscriber The subscriber object/identifier.
     * @param msgCodes Array of message codes the subscriber is interested in.
     * @param handler The function to call with the incoming data (Uint8Array).
     */
    public registerDataResponseHandler(subscriber: any, msgCodes: number[], handler: FrameMsgDataHandler): void {
        for (const code of msgCodes) {
            if (!this.dataResponseHandlers.has(code)) {
                this.dataResponseHandlers.set(code, []);
            }
            const handlersForCode = this.dataResponseHandlers.get(code)!;
            const existing = handlersForCode.find(
                s => s.subscriber === subscriber && s.handler === handler
            );
            if (!existing) {
                handlersForCode.push({ subscriber, handler });
            }
        }
    }

    public unregisterDataResponseHandler(subscriber: any): void {
        this.dataResponseHandlers.forEach((handlers, code) => {
            const filteredHandlers = handlers.filter(subHandler => subHandler.subscriber !== subscriber);
            if (filteredHandlers.length === 0) {
                this.dataResponseHandlers.delete(code);
            } else {
                this.dataResponseHandlers.set(code, filteredHandlers);
            }
        });
    }

    /**
     * Internal method to handle incoming data responses from FrameBle (as Uint8Array)
     * and dispatch to appropriate FrameMsg subscribers.
     * @param data The incoming data response as a Uint8Array.
     */
    private _handleDataResponse(data: Uint8Array): void { // Changed DataView to Uint8Array
        if (data && data.byteLength > 0) {
            const msgCode = data[0]; // Accessing first byte of Uint8Array
            if (this.dataResponseHandlers.has(msgCode)) {
                this.dataResponseHandlers.get(msgCode)!.forEach(subHandler => {
                    try {
                        // Pass the Uint8Array directly. If the handler needs a specific view
                        // (e.g. for multi-byte numbers), it can create it.
                        subHandler.handler(data);
                    } catch (error) {
                        console.error("Error in FrameMsg data response handler for msgCode", msgCode, ":", error);
                    }
                });
            }
        }
    }

    // --- Direct proxy methods to FrameBle for convenience ---

    public async sendLua(
        str: string,
        options: {
            showMe?: boolean;
            awaitPrint?: boolean;
            timeout?: number;
        } = {}
    ): Promise<string | void> {
        return this.ble.sendLua(str, options);
    }

    /**
     * Sends raw data to the device.
     * @param data The Uint8Array payload to send.
     * @param options Configuration options.
     * @returns A Promise that resolves with the Uint8Array data response if awaitData is true, or void.
     */
     public async sendData(
        data: Uint8Array,
        options: {
            showMe?: boolean;
            awaitData?: boolean;
            timeout?: number;
        } = {}
    ): Promise<Uint8Array | void> { // Updated return type
        return this.ble.sendData(data, options);
    }

    public async sendResetSignal(showMe: boolean = false): Promise<void> {
        return this.ble.sendResetSignal(showMe);
    }

    public async sendBreakSignal(showMe: boolean = false): Promise<void> {
        return this.ble.sendBreakSignal(showMe);
    }

    public getMaxPayload(isLua: boolean): number {
        if (!this.ble) {
            console.warn("FrameBle instance not initialized or not connected for getMaxPayload.");
            return 60; // Default fallback
        }
        return this.ble.getMaxPayload(isLua);
    }
}

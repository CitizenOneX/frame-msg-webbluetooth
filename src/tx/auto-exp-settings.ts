/**
 * Options for configuring auto exposure and gain settings.
 */
export interface TxAutoExpSettingsOptions {
    /** Optional zero-based index into metering modes ['SPOT', 'CENTER_WEIGHTED', 'AVERAGE'] (0, 1, or 2). Defaults to 1 (CENTER_WEIGHTED). */
    meteringIndex?: number;
    /** Optional target exposure value (0.0-1.0). Defaults to 0.1. */
    exposure?: number;
    /** Optional speed of exposure adjustments (0.0-1.0). Defaults to 0.45. */
    exposureSpeed?: number;
    /** Optional maximum shutter value (4-16383). Defaults to 16383. */
    shutterLimit?: number;
    /** Optional maximum analog gain value (1-248). Defaults to 16. */
    analogGainLimit?: number;
    /** Optional speed of white balance adjustments (0.0-1.0). Defaults to 0.5. */
    whiteBalanceSpeed?: number;
    /** Optional maximum gain value for red, green, blue channels (0-1023). Defaults to 287. */
    rgbGainLimit?: number;
}

/**
 * Message for auto exposure and gain settings.
 */
export class TxAutoExpSettings {
    /**
     * Zero-based index into ['SPOT', 'CENTER_WEIGHTED', 'AVERAGE'] i.e. 0, 1 or 2.
     */
    public meteringIndex: number;
    /**
     * Target exposure value (0.0-1.0)
     */
    public exposure: number;
    /**
     * Speed of exposure adjustments (0.0-1.0)
     */
    public exposureSpeed: number;
    /**
     * Maximum shutter value (4-16383)
     */
    public shutterLimit: number;
    /**
     * Maximum analog gain value (1-248)
     */
    public analogGainLimit: number;
    /**
     * Speed of white balance adjustments (0.0-1.0)
     */
    public whiteBalanceSpeed: number;
    /**
     * Maximum gain value for red, green, blue channels (0-1023)
     */
    public rgbGainLimit: number;

    /**
     * Constructs an instance of TxAutoExpSettings.
     * @param options Configuration options for auto exposure and gain settings.
     */
    constructor(options: TxAutoExpSettingsOptions = {}) {
        this.meteringIndex = options.meteringIndex ?? 1;
        this.exposure = options.exposure ?? 0.1;
        this.exposureSpeed = options.exposureSpeed ?? 0.45;
        this.shutterLimit = options.shutterLimit ?? 16383;
        this.analogGainLimit = options.analogGainLimit ?? 16;
        this.whiteBalanceSpeed = options.whiteBalanceSpeed ?? 0.5;
        this.rgbGainLimit = options.rgbGainLimit ?? 287;
    }

    /**
     * Packs the settings into 9 bytes.
     * @returns Uint8Array Binary representation of the message (9 bytes)
     */
    pack(): Uint8Array {
        const buffer = new ArrayBuffer(9);
        const dataView = new DataView(buffer);

        // Python struct.pack('>BBBHBBH', ...)
        // >: big-endian
        // B: unsigned char (1 byte)
        // B: unsigned char (1 byte)
        // B: unsigned char (1 byte)
        // H: unsigned short (2 bytes)
        // B: unsigned char (1 byte)
        // B: unsigned char (1 byte)
        // H: unsigned short (2 bytes)

        dataView.setUint8(0, this.meteringIndex & 0xFF);
        dataView.setUint8(1, Math.trunc(this.exposure * 255) & 0xFF);
        dataView.setUint8(2, Math.trunc(this.exposureSpeed * 255) & 0xFF);
        dataView.setUint16(3, this.shutterLimit & 0x3FFF, false); // false for big-endian
        dataView.setUint8(5, this.analogGainLimit & 0xFF);
        dataView.setUint8(6, Math.trunc(this.whiteBalanceSpeed * 255) & 0xFF);
        dataView.setUint16(7, this.rgbGainLimit & 0x3FF, false); // false for big-endian

        return new Uint8Array(buffer);
    }
}
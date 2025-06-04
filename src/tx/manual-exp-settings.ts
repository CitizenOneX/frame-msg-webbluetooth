/**
 * Options for configuring manual exposure and gain settings.
 */
export interface TxManualExpSettingsOptions {
    /** Optional shutter value (4-16383). Defaults to 3072. */
    manualShutter?: number;
    /** Optional analog gain value (1-248). Defaults to 16. */
    manualAnalogGain?: number;
    /** Optional red gain value (0-1023). Defaults to 121. */
    manualRedGain?: number;
    /** Optional green gain value (0-1023). Defaults to 64. */
    manualGreenGain?: number;
    /** Optional blue gain value (0-1023). Defaults to 140. */
    manualBlueGain?: number;
}

/**
 * Message for manual exposure and gain settings.
 */
export class TxManualExpSettings {
    /**
     * Shutter value (4-16383)
     */
    public manualShutter: number;
    /**
     * Analog gain value (1-248)
     */
    public manualAnalogGain: number;
    /**
     * Red gain value (0-1023)
     */
    public manualRedGain: number;
    /**
     * Green gain value (0-1023)
     */
    public manualGreenGain: number;
    /**
     * Blue gain value (0-1023)
     */
    public manualBlueGain: number;

    /**
     * Constructs an instance of TxManualExpSettings.
     * @param options Configuration options for manual exposure and gain settings.
     */
    constructor(options: TxManualExpSettingsOptions = {}) {
        this.manualShutter = options.manualShutter ?? 3072;
        this.manualAnalogGain = options.manualAnalogGain ?? 16;
        this.manualRedGain = options.manualRedGain ?? 121;
        this.manualGreenGain = options.manualGreenGain ?? 64;
        this.manualBlueGain = options.manualBlueGain ?? 140;
    }

    /**
     * Packs the settings into 9 bytes.
     * @returns Uint8Array Binary representation of the message (9 bytes)
     */
    pack(): Uint8Array {
        const buffer = new ArrayBuffer(9);
        const dataView = new DataView(buffer);

        // Python struct.pack('>HBHHH', ...)
        // >: big-endian
        // H: unsigned short (2 bytes)
        // B: unsigned char (1 byte)
        // H: unsigned short (2 bytes)
        // H: unsigned short (2 bytes)
        // H: unsigned short (2 bytes)

        dataView.setUint16(0, this.manualShutter & 0x3FFF, false);       // 2 bytes, big-endian
        dataView.setUint8(2, this.manualAnalogGain & 0xFF);             // 1 byte
        dataView.setUint16(3, this.manualRedGain & 0x3FF, false);       // 2 bytes, big-endian
        dataView.setUint16(5, this.manualGreenGain & 0x3FF, false);     // 2 bytes, big-endian
        dataView.setUint16(7, this.manualBlueGain & 0x3FF, false);      // 2 bytes, big-endian

        return new Uint8Array(buffer);
    }
}
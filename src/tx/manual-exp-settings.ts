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
     * @param manualShutter Shutter value (4-16383). Defaults to 3072.
     * @param manualAnalogGain Analog gain value (1-248). Defaults to 16.
     * @param manualRedGain Red gain value (0-1023). Defaults to 121.
     * @param manualGreenGain Green gain value (0-1023). Defaults to 64.
     * @param manualBlueGain Blue gain value (0-1023). Defaults to 140.
     */
    constructor(
        manualShutter: number = 3072,
        manualAnalogGain: number = 16,
        manualRedGain: number = 121,
        manualGreenGain: number = 64,
        manualBlueGain: number = 140
    ) {
        this.manualShutter = manualShutter;
        this.manualAnalogGain = manualAnalogGain;
        this.manualRedGain = manualRedGain;
        this.manualGreenGain = manualGreenGain;
        this.manualBlueGain = manualBlueGain;
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
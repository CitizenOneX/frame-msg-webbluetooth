/**
 * Message for camera capture settings.
 */
export class TxCaptureSettings {
    /**
     * Image resolution (256-720, must be even)
     */
    public resolution: number;
    /**
     * Index into [VERY_LOW, LOW, MEDIUM, HIGH, VERY_HIGH]
     */
    public qualityIndex: number;
    /**
     * Image pan value (-140 to 140)
     */
    public pan: number;
    /**
     * Whether to capture in RAW format
     */
    public raw: boolean;

    /**
     * @param resolution Image resolution (256-720, must be even). Defaults to 512.
     * @param qualityIndex Index into [VERY_LOW, LOW, MEDIUM, HIGH, VERY_HIGH]. Defaults to 4.
     * @param pan Image pan value (-140 to 140). Defaults to 0.
     * @param raw Whether to capture in RAW format. Defaults to false.
     */
    constructor(
        resolution: number = 512,
        qualityIndex: number = 4,
        pan: number = 0,
        raw: boolean = false
    ) {
        this.resolution = resolution;
        this.qualityIndex = qualityIndex;
        this.pan = pan;
        this.raw = raw;
    }

    /**
     * Packs the settings into 6 bytes.
     * @returns Uint8Array Binary representation of the message (6 bytes)
     */
    pack(): Uint8Array {
        const buffer = new ArrayBuffer(6);
        const dataView = new DataView(buffer);

        const halfRes = this.resolution / 2;
        const panShifted = this.pan + 140;

        // struct.pack('>BHHB') translates to:
        // B: 1-byte unsigned char for quality_index
        // H: 2-byte unsigned short for half_res (big-endian)
        // H: 2-byte unsigned short for pan_shifted (big-endian)
        // B: 1-byte unsigned char for raw

        dataView.setUint8(0, this.qualityIndex & 0xFF);
        dataView.setUint16(1, halfRes & 0xFFFF, false); // false for big-endian
        dataView.setUint16(3, panShifted & 0xFFFF, false); // false for big-endian
        dataView.setUint8(5, this.raw ? 0x01 : 0x00);

        return new Uint8Array(buffer);
    }
}

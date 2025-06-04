/**
 * Options for configuring camera capture settings.
 */
export interface TxCaptureSettingsOptions {
    /** Optional image resolution (256-720, must be even). Defaults to 512. */
    resolution?: number;
    /** Optional index into JPEG quality array [VERY_LOW, LOW, MEDIUM, HIGH, VERY_HIGH] (0-4). Defaults to 4 (VERY_HIGH). */
    qualityIndex?: number;
    /** Optional image pan value (-140 to 140). Defaults to 0. */
    pan?: number;
    /** Optional flag whether to capture in RAW (headerless JPEG) format. Defaults to false. */
    raw?: boolean;
}

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
     * Constructs an instance of TxCaptureSettings.
     * @param options Configuration options for the capture settings.
     */
    constructor(options: TxCaptureSettingsOptions = {}) {
        this.resolution = options.resolution ?? 512;
        this.qualityIndex = options.qualityIndex ?? 4;
        this.pan = options.pan ?? 0;
        this.raw = options.raw ?? false;
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

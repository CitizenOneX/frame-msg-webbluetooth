/**
 * Options for configuring sprite coordinates.
 */
export interface TxSpriteCoordsOptions {
    /** Unsigned byte identifying the sprite code. */
    code: number;
    /** X-coordinate for sprite position (1-640). */
    x: number;
    /** Y-coordinate for sprite position (1-400). */
    y: number;
    /** Optional palette offset value for the sprite (0-15). Defaults to 0. */
    offset?: number;
}

/**
 * A message containing sprite coordinates information for display.
 */
export class TxSpriteCoords {
    /**
     * Unsigned byte identifying the sprite code
     */
    public code: number;
    /**
     * X-coordinate for sprite position (1..640)
     */
    public x: number;
    /**
     * Y-coordinate for sprite position (1..400)
     */
    public y: number;
    /**
     * Palette offset value for the sprite (0..15)
     */
    public offset: number;

    /**
     * Constructs an instance of TxSpriteCoords.
     * @param options Configuration options for the sprite coordinates.
     */
    constructor(options: TxSpriteCoordsOptions) {
        this.code = options.code;
        this.x = options.x;
        this.y = options.y;
        this.offset = options.offset ?? 0;
    }

    /**
     * Packs the message into a binary format.
     * @returns Uint8Array Binary representation of the message in the format:
     * [code, x_msb, x_lsb, y_msb, y_lsb, offset]
     * (6 bytes)
     */
    pack(): Uint8Array {
        const buffer = new ArrayBuffer(6); // code (1) + x (2) + y (2) + offset (1) = 6 bytes
        const dataView = new DataView(buffer);

        // Python's struct.pack('>BHHB') translates to:
        // B: 1-byte unsigned char for code
        // H: 2-byte unsigned short for x (big-endian)
        // H: 2-byte unsigned short for y (big-endian)
        // B: 1-byte unsigned char for offset

        dataView.setUint8(0, this.code & 0xFF);
        dataView.setUint16(1, this.x & 0xFFFF, false); // false for big-endian
        dataView.setUint16(3, this.y & 0xFFFF, false); // false for big-endian
        dataView.setUint8(5, this.offset & 0xFF);

        return new Uint8Array(buffer);
    }
}
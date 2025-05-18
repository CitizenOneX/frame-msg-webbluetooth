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
     * @param code Unsigned byte identifying the sprite code.
     * @param x X-coordinate for sprite position (1..640).
     * @param y Y-coordinate for sprite position (1..400).
     * @param offset Palette offset value for the sprite (0..15). Defaults to 0.
     */
    constructor(
        code: number,
        x: number,
        y: number,
        offset: number = 0
    ) {
        this.code = code;
        this.x = x;
        this.y = y;
        this.offset = offset;
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
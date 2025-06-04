/**
 * Options for configuring a plain text message.
 */
export interface TxPlainTextOptions {
    /** The plain text content to be transmitted. */
    text: string;
    /** Optional X-coordinate for text position (1-640, Lua/1-based indexing). Defaults to 1. */
    x?: number;
    /** Optional Y-coordinate for text position (1-400, Lua/1-based indexing). Defaults to 1. */
    y?: number;
    /** Optional color palette offset (1-15, 0/'VOID' is invalid). Defaults to 1. */
    paletteOffset?: number;
    /** Optional character spacing value. Defaults to 4. */
    spacing?: number;
}

/**
 * A message containing plain text with positioning and formatting information.
 */
export class TxPlainText {
    public text: string;
    public x: number;
    public y: number;
    public paletteOffset: number;
    public spacing: number;

    /**
     * Constructs an instance of TxPlainText.
     * @param options Configuration options for the plain text message.
     */
    constructor(options: TxPlainTextOptions) {
        this.text = options.text;
        this.x = options.x ?? 1;
        this.y = options.y ?? 1;
        this.paletteOffset = options.paletteOffset ?? 1;
        this.spacing = options.spacing ?? 4;
    }

    /**
     * Packs the message into a binary format.
     * @returns Uint8Array Binary representation of the message
     */
    pack(): Uint8Array {
        // Convert text to UTF-8 bytes
        const textEncoder = new TextEncoder();
        const textBytes = textEncoder.encode(this.text);

        // Create header buffer (6 bytes total)
        const header = new Uint8Array(6);
        const headerView = new DataView(header.buffer);

        // Pack the header using DataView for big-endian values
        headerView.setUint16(0, this.x, false);          // x (2 bytes)
        headerView.setUint16(2, this.y, false);          // y (2 bytes)
        headerView.setUint8(4, this.paletteOffset & 0x0F); // palette (1 byte)
        headerView.setUint8(5, this.spacing & 0xFF);       // spacing (1 byte)

        // Combine header and text bytes
        const result = new Uint8Array(header.length + textBytes.length);
        result.set(header);
        result.set(textBytes, header.length);

        return result;
    }
}
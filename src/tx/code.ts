/**
 * Options for configuring a TxCode message.
 */
export interface TxCodeOptions {
    /** Optional byte value to be transmitted (0-255). Defaults to 0. */
    value?: number;
}

/**
 * A simple message containing only an optional byte value.
 * Used for signaling the frameside app to take some action.
 */
export class TxCode {
    public value: number;

    /**
     * Constructs an instance of TxCode.
     * @param options Configuration options for the code message.
     */
    constructor(options: TxCodeOptions = {}) {
        this.value = options.value ?? 0;
    }

    /**
     * Packs the message into a single byte.
     * @returns Uint8Array Binary representation of the message (a single byte)
     */
    pack(): Uint8Array {
        // Ensure the value is within the valid byte range (0-255)
        const byteValue = this.value & 0xFF;
        return new Uint8Array([byteValue]);
    }
}
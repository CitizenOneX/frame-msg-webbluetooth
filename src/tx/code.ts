/**
 * A simple message containing only a message code and an optional byte value.
 * Used for signaling the frameside app to take some action.
 */
export class TxCode {
    /**
     * @param value The byte value to be transmitted (0-255)
     */
    constructor(
        public value: number = 0
    ) {}

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
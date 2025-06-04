import { TxSprite } from './sprite';

/**
 * Interface for TxTextSpriteBlock constructor options.
 */
export interface TxTextSpriteBlockOptions {
    /** Width constraint for text layout */
    width: number;
    /** Font size in pixels */
    fontSize: number;
    /** Maximum number of rows to display */
    maxDisplayRows: number;
    /** The text to render */
    text: string;
    /** Optional font family name. Defaults to 'sans-serif'. */
    fontFamily?: string;
}

/**
 * A block of text rendered as sprites, for use in a browser environment.
 */
export class TxTextSpriteBlock {
    /** The width constraint for the text layout, in pixels. */
    public width: number;
    /** The font size used for rendering the text, in pixels. */
    public fontSize: number;
    /** The maximum number of rows of text to be displayed. */
    public maxDisplayRows: number;
    /** The raw text content to be rendered. */
    public text: string;
    /** The font family used for rendering the text. */
    public fontFamily: string;

    /** An array of {@link TxSprite} instances, each representing a line of rendered text. */
    public sprites: TxSprite[] = [];

    /**
     * @param options Configuration options for the text sprite block.
     */
    constructor(options: TxTextSpriteBlockOptions) {
        this.width = options.width;
        this.fontSize = options.fontSize;
        this.maxDisplayRows = options.maxDisplayRows;
        this.text = options.text;
        this.fontFamily = options.fontFamily || 'sans-serif'; // Default font

        this._createTextSprites();
    }

    /**
     * Creates sprites from the rendered text using the browser's Canvas API.
     */
    private _createTextSprites(): void {
        // Determine the maximum height needed for the canvas
        const canvasHeight = this.fontSize * this.maxDisplayRows;
        if (this.width <= 0 || canvasHeight <= 0) {
            // Invalid dimensions, no sprites can be created.
            return;
        }

        // Create canvas using browser's document.createElement
        const canvas = document.createElement('canvas');
        canvas.width = this.width;
        canvas.height = canvasHeight;

        // willReadFrequently should give us a software buffer rather than GPU
        // since we need to read back the sprites for sending
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
            console.error("TxTextSpriteBlock: Could not get 2D rendering context.");
            return;
        }

        // Initialize canvas: black background, white text
        ctx.fillStyle = 'black';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = 'white';
        ctx.font = `${this.fontSize}px ${this.fontFamily}`;
        ctx.textBaseline = 'top'; // Y-coordinate refers to the top of the text

        const inputTextLines = this.text.split('\n');
        let currentLineDrawY = 0; // Y-coordinate for drawing the current line on the main canvas

        const potentialSprites: Array<{
            text: string;
            drawY: number;
        }> = [];

        // First pass: Collect lines to be rendered and their intended draw positions
        for (let i = 0; i < inputTextLines.length; i++) {
            if (potentialSprites.length >= this.maxDisplayRows) {
                break;
            }
            potentialSprites.push({
                text: inputTextLines[i],
                drawY: currentLineDrawY,
            });
            currentLineDrawY += this.fontSize; // Increment Y for the next line's position
        }

        // Second pass: Draw text and identify exact bounding boxes for sprites
        for (const lineInfo of potentialSprites) {
            const { text: lineText, drawY: lineTopYOnCanvas } = lineInfo;

            // Draw the current line of text onto the main canvas
            ctx.fillText(lineText, 0, lineTopYOnCanvas);

            // Analyze the drawn region for this line to find the actual content bounds
            const lineImageData = ctx.getImageData(0, lineTopYOnCanvas, this.width, this.fontSize);
            const { data, width: imageDataWidth, height: imageDataHeight } = lineImageData;

            let minX = imageDataWidth;
            let minY_relative = imageDataHeight;
            let maxX = -1;
            let maxY_relative = -1;
            let hasVisibleContent = false;

            for (let y = 0; y < imageDataHeight; y++) {
                for (let x = 0; x < imageDataWidth; x++) {
                    const pixelRedChannel = data[(y * imageDataWidth + x) * 4];
                    if (pixelRedChannel > 0) {
                        hasVisibleContent = true;
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY_relative) minY_relative = y;
                        if (y > maxY_relative) maxY_relative = y;
                    }
                }
            }

            if (hasVisibleContent) {
                const spriteActualXOnCanvas = minX;
                const spriteActualYOnCanvas = lineTopYOnCanvas + minY_relative;
                const spriteRenderedWidth = maxX - minX + 1;
                const spriteRenderedHeight = maxY_relative - minY_relative + 1;

                const croppedSpriteImageData = ctx.getImageData(
                    spriteActualXOnCanvas,
                    spriteActualYOnCanvas,
                    spriteRenderedWidth,
                    spriteRenderedHeight
                );

                const { data: croppedData, width: finalSpriteWidth, height: finalSpriteHeight } = croppedSpriteImageData;
                const spritePixelData = new Uint8Array(finalSpriteWidth * finalSpriteHeight);

                for (let i = 0, j = 0; i < croppedData.length; i += 4, j++) {
                    spritePixelData[j] = (croppedData[i] > 127) ? 1 : 0;
                }

                const textLineSprite = new TxSprite({
                    width: finalSpriteWidth,
                    height: finalSpriteHeight,
                    numColors: 2,
                    paletteData: new Uint8Array([0, 0, 0, 255, 255, 255]),
                    pixelData: spritePixelData,
                    compress: false
            });
                this.sprites.push(textLineSprite);
            }
        }
    }

    /**
     * Packs the text block header and sprite offsets into a binary format.
     * @returns Uint8Array Binary representation of the text block.
     * @throws Error if there are no sprites to pack.
     */
    public pack(): Uint8Array {
        if (this.sprites.length === 0) {
            throw new Error("TxTextSpriteBlock: No sprites to pack. Text might be empty or not renderable within constraints.");
        }

        const headerSize = 5;
        const offsetsSize = this.sprites.length * 4;
        const totalPackedSize = headerSize + offsetsSize;

        const buffer = new ArrayBuffer(totalPackedSize);
        const dataView = new DataView(buffer);
        let currentByteOffset = 0;

        dataView.setUint8(currentByteOffset, 0xFF);
        currentByteOffset += 1;
        dataView.setUint16(currentByteOffset, this.width, false);
        currentByteOffset += 2;
        dataView.setUint8(currentByteOffset, this.maxDisplayRows & 0xFF);
        currentByteOffset += 1;
        dataView.setUint8(currentByteOffset, this.sprites.length & 0xFF);
        currentByteOffset += 1;

        let accumulatedSpriteHeight = 0;
        for (const sprite of this.sprites) {
            dataView.setUint16(currentByteOffset, 0, false);
            currentByteOffset += 2;
            dataView.setUint16(currentByteOffset, accumulatedSpriteHeight, false);
            currentByteOffset += 2;
            accumulatedSpriteHeight += sprite.height;
        }

        return new Uint8Array(buffer);
    }
}

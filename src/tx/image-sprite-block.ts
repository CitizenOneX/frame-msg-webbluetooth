import { TxSprite } from './sprite';

/**
 * Options for configuring an image sprite block.
 */
export interface TxImageSpriteBlockOptions {
    /** The source {@link TxSprite} to be split into strips. */
    image: TxSprite;
    /**
     * Optional height of each sprite strip. Defaults to 16.
     * If the source `image` is compressed (`image.compress` is true),
     * this value is dynamically calculated to respect a 4kB packed size limit per strip
     * and any provided value here is ignored.
     */
    spriteLineHeight?: number;
    /** Optional flag whether to render lines as they arrive. Defaults to true. */
    progressiveRender?: boolean;
    /** Optional flag whether lines can be updated after initial render. Defaults to true. */
    updatable?: boolean;
}

/**
 * An image split into horizontal sprite strips.
 */
export class TxImageSpriteBlock {
    /**
     * Source sprite to split.
     */
    public image: TxSprite;
    /**
     * Height of each sprite strip. If the TxSprite is compressed, the strip has a packed size limit of 4kB and this value is dynamically calculated.
     */
    public spriteLineHeight: number;
    /**
     * Whether to render lines as they arrive.
     */
    public progressiveRender: boolean;
    /**
     * Whether lines can be updated after initial render.
     */
    public updatable: boolean;
    /**
     * List of sprite strips.
     */
    public spriteLines: TxSprite[] = [];

    /**
     * Constructs an instance of TxImageSpriteBlock.
     * @param options Configuration options for the image sprite block.
     */
    constructor(options: TxImageSpriteBlockOptions) {
        this.image = options.image;
        this.progressiveRender = options.progressiveRender ?? true;
        this.updatable = options.updatable ?? true;

        if (this.image.compress) {
            // 4k uncompressed (binary packed) limit
            const currentBpp = this.image.bpp; // Using the bpp getter from your TxSprite class
            // Ensure bpp is not zero to avoid division by zero
            const packedBytesPerRow = currentBpp > 0 ? Math.floor((this.image.width + (8 / currentBpp) - 1) / (8 / currentBpp)) : 0;
            this.spriteLineHeight = packedBytesPerRow > 0 ? Math.floor(4096 / packedBytesPerRow) : 0;
             if (this.spriteLineHeight === 0 && packedBytesPerRow > 0) { // Ensure at least 1 line if possible
                this.spriteLineHeight = 1;
            } else if (packedBytesPerRow === 0) { // Handle case where image width or bpp results in zero bytes per row
                this.spriteLineHeight = this.image.height; // Or some other sensible default, maybe error?
            }
        } else {
            this.spriteLineHeight = options.spriteLineHeight ?? 16;
        }
         // Ensure spriteLineHeight is at least 1 if image has height
        if (this.image.height > 0 && this.spriteLineHeight < 1) {
            this.spriteLineHeight = 1;
        }

        this._splitIntoLines();
    }

    /**
     * Splits the source image into horizontal strips.
     * This method needs careful implementation based on how pixelData is structured
     * and how BPP affects its layout if it's not 1 byte per pixel index.
     * The current TxSprite.pixelData is Uint8Array of palette indices.
     */
    private _splitIntoLines(): void {
        // TxSprite.pixelData is Uint8Array of palette indices (1 index per byte).
        // This simplifies things compared to raw packed pixel data at this stage.
        const sourcePixelData = this.image.pixelData;
        const pixelsPerRow = this.image.width; // Each entry in pixelData is one pixel's index

        if (this.spriteLineHeight <= 0) {
             console.warn("TxImageSpriteBlock: spriteLineHeight is zero or negative, cannot split lines.");
             // Optionally, create a single sprite line with the whole image or handle as an error
            if (this.image.height > 0) {
                 this.spriteLines.push(new TxSprite({
                    width: this.image.width,
                    height: this.image.height,
                    numColors: this.image.numColors,
                    paletteData: this.image.paletteData, // Share palette data
                    pixelData: sourcePixelData,        // Use the whole pixel data
                    compress: this.image.compress
                }));
            }
            return;
        }


        // Process full-height lines
        const numFullLines = Math.floor(this.image.height / this.spriteLineHeight);
        for (let i = 0; i < numFullLines; i++) {
            const startYOffset = i * this.spriteLineHeight * pixelsPerRow;
            const endYOffset = startYOffset + this.spriteLineHeight * pixelsPerRow;
            const linePixelData = sourcePixelData.slice(startYOffset, endYOffset);

            this.spriteLines.push(new TxSprite({
                width: this.image.width,
                height: this.spriteLineHeight,
                numColors: this.image.numColors,
                paletteData: this.image.paletteData, // Share palette data
                pixelData: linePixelData,
                compress: this.image.compress
            }));
        }

        // Process final partial line if any
        const remainingHeight = this.image.height % this.spriteLineHeight;
        if (remainingHeight > 0) {
            const startYOffset = numFullLines * this.spriteLineHeight * pixelsPerRow;
            // No endYOffset needed for slice if it's the rest of the array
            const finalLinePixelData = sourcePixelData.slice(startYOffset);

            this.spriteLines.push(new TxSprite({
                width: this.image.width,
                height: remainingHeight,
                numColors: this.image.numColors,
                paletteData: this.image.paletteData, // Share palette data
                pixelData: finalLinePixelData,
                compress: this.image.compress
            }));
        }
    }

    /**
     * Packs the image block header into a binary format.
     * @returns Uint8Array Binary representation of the header
     * @throws Error if there are no sprite lines to pack (though _splitIntoLines should always create at least one if height > 0 and spriteLineHeight > 0)
     */
    pack(): Uint8Array {
        if (this.spriteLines.length === 0 && this.image.height > 0) {
            // This case should ideally be prevented by the constructor logic or _splitIntoLines
            console.warn("TxImageSpriteBlock pack: No sprite lines to pack, but image has height. This might indicate an issue in line splitting.");
            // Fallback or throw, depending on desired strictness. For now, we'll try to pack with original image height if spriteLineHeight was problematic.
             if (this.spriteLineHeight <= 0 && this.image.height > 0) {
                // This indicates spriteLineHeight might have been calculated to 0, try using image.height
                 console.warn("Attempting to pack header with image.height due to zero spriteLineHeight");
            } else {
                 throw new Error("No sprite lines to pack");
            }
        } else if (this.spriteLines.length === 0 && this.image.height === 0) {
            // If image height is 0, it's valid to have no sprite lines.
            // The header will reflect width=X, height=0.
        }


        // Header buffer (9 bytes total: 1 for marker, 2 for width, 2 for height, 2 for spriteLineHeight, 1 for progressive, 1 for updatable)
        // Python struct format: '>BHHHBB'
        const header = new Uint8Array(9);
        const headerView = new DataView(header.buffer);

        let currentSpriteLineHeight = this.spriteLineHeight;
        if (this.image.height > 0 && this.spriteLineHeight <= 0) {
            // If calculated spriteLineHeight was invalid (e.g. 0 due to very wide compressed image),
            // use the image's own height as a fallback for packing, assuming it forms a single "line".
            // This is a tricky situation; the original intent of sprite_line_height might be lost,
            // but packing with 0 can be problematic.
            // The `_splitIntoLines` might have created one line with image.height already if spriteLineHeight was 0.
            // If spriteLines exist, their height should be consistent.
            if (this.spriteLines.length > 0) {
                currentSpriteLineHeight = this.spriteLines[0].height; // Use actual height of first line
            } else {
                 currentSpriteLineHeight = this.image.height; // Fallback if no lines were made but we are forced to pack
            }
        }


        headerView.setUint8(0, 0xFF); // Block marker
        headerView.setUint16(1, this.image.width, false);      // width (big-endian)
        headerView.setUint16(3, this.image.height, false);     // height (big-endian)
        headerView.setUint16(5, currentSpriteLineHeight, false); // sprite_line_height (big-endian)
        headerView.setUint8(7, this.progressiveRender ? 1 : 0); // progressive_render (1 byte)
        headerView.setUint8(8, this.updatable ? 1 : 0);       // updatable (1 byte)

        return header;
    }
}

// Example Usage (assumes TxSprite class is imported and available):
/*
async function testImageSpriteBlock() {
    // Create a mock TxSprite instance
    // For a real scenario, you'd likely use TxSprite.fromImageBytes or TxSprite.fromIndexedPngBytes
    const width = 64;
    const height = 32;
    const numColors = 4;
    const paletteData = new Uint8Array([
        255, 0, 0,   // Red
        0, 255, 0,   // Green
        0, 0, 255,   // Blue
        255, 255, 255 // White
    ]);
    // Simple pixel data: a 2x2 checkerboard pattern of red and green repeated
    const pixelDataArray: number[] = [];
    for (let r = 0; r < height; r++) {
        for (let c = 0; c < width; c++) {
            pixelDataArray.push((r % 2 === 0) ? (c % 2 === 0 ? 0 : 1) : (c % 2 === 0 ? 1 : 0));
        }
    }
    const pixelData = new Uint8Array(pixelDataArray);

    const mockSprite = new TxSprite(width, height, numColors, paletteData, pixelData, false);
    const mockCompressedSprite = new TxSprite(width, height, numColors, paletteData, pixelData, true);


    console.log("Testing non-compressed image block:");
    const imageBlock = new TxImageSpriteBlock(mockSprite, 8); // 8 lines per sprite
    console.log("Number of sprite lines:", imageBlock.spriteLines.length);
    imageBlock.spriteLines.forEach((line, index) => {
        console.log(`Line ${index}: width=${line.width}, height=${line.height}, pixels=${line.pixelData.length}`);
    });
    const packedHeader = imageBlock.pack();
    console.log("Packed Header:", packedHeader);


    console.log("\nTesting compressed image block (dynamic line height):");
    // For a compressed sprite, spriteLineHeight in constructor is ignored if image.compress is true
    const compressedImageBlock = new TxImageSpriteBlock(mockCompressedSprite);
    console.log("Calculated spriteLineHeight for compressed:", compressedImageBlock.spriteLineHeight);
    console.log("Number of sprite lines:", compressedImageBlock.spriteLines.length);
    compressedImageBlock.spriteLines.forEach((line, index) => {
        console.log(`Line ${index}: width=${line.width}, height=${line.height}, pixels=${line.pixelData.length}`);
    });
    const packedCompressedHeader = compressedImageBlock.pack();
    console.log("Packed Compressed Header:", packedCompressedHeader);

    // Test case: image where compressed line height calculation might be tricky
    const wideCompressedSprite = new TxSprite(640, 10, 2, new Uint8Array([0,0,0, 255,255,255]), new Uint8Array(640*10), true);
    console.log("\nTesting wide compressed image block:");
    const wideCompressedBlock = new TxImageSpriteBlock(wideCompressedSprite);
    console.log("Calculated spriteLineHeight for wide compressed:", wideCompressedBlock.spriteLineHeight);
    console.log("Number of sprite lines:", wideCompressedBlock.spriteLines.length);
     wideCompressedBlock.spriteLines.forEach((line, index) => {
        console.log(`Line ${index}: width=${line.width}, height=${line.height}, pixels=${line.pixelData.length}`);
    });
    const packedWideHeader = wideCompressedBlock.pack();
    console.log("Packed Wide Header:", packedWideHeader);

     // Test case: image with height smaller than potential spriteLineHeight
    const shortSprite = new TxSprite(32, 5, numColors, paletteData, new Uint8Array(Array(32*5).fill(0)), false);
    console.log("\nTesting short image block:");
    const shortImageBlock = new TxImageSpriteBlock(shortSprite, 16); // Request 16, but image is only 5 high
    console.log("SpriteLineHeight for short image:", shortImageBlock.spriteLineHeight);
    console.log("Number of sprite lines for short image:", shortImageBlock.spriteLines.length);
    if (shortImageBlock.spriteLines.length > 0) {
        console.log(`Line 0 height: ${shortImageBlock.spriteLines[0].height}`);
    }
    const packedShortHeader = shortImageBlock.pack();
    console.log("Packed Short Header:", packedShortHeader);

}

// testImageSpriteBlock();
*/
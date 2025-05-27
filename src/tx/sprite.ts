import { Image } from 'image-js';
import lz4 from 'lz4js';
import  * as IQ  from 'image-q';
import UPNG from '@pdf-lib/upng';

/**
 * Represents RGB color values.
 */
interface RGBColor {
    r: number;
    g: number;
    b: number;
}

// ProcessedImage interface remains the same

/**
 * A sprite message containing image data with a custom palette.
 */
export class TxSprite {
    public width: number;
    public height: number;
    public numColors: number;
    public paletteData: Uint8Array;
    public pixelData: Uint8Array;
    public compress: boolean;

    constructor(
        width: number,
        height: number,
        numColors: number,
        paletteData: Uint8Array,
        pixelData: Uint8Array,
        compress: boolean = false
    ) {
        this.width = width;
        this.height = height;
        this.numColors = numColors;
        this.paletteData = paletteData;
        this.pixelData = pixelData;
        this.compress = compress;

        if (paletteData.length / 3 !== numColors && numColors > 0) {
            console.warn(`TxSprite constructor: numColors (${numColors}) does not match paletteData length (${paletteData.length / 3} colors).`);
        }
        if (pixelData.length !== width * height && width * height > 0) {
            console.warn(`TxSprite constructor: pixelData length (${pixelData.length}) does not match width*height (${width*height}).`);
        }
    }

    /**
     * Creates a TxSprite from an indexed PNG image.
     * @param imageBytes The ArrayBuffer containing the PNG image data.
     * @param compress Whether to compress the pixel data using LZ4.
     * @returns A TxSprite instance.
     */
    static async fromIndexedPngBytes(imageBytes: ArrayBuffer, compress: boolean = false): Promise<TxSprite> {
        const png = UPNG.decode(imageBytes);

        // no resize or color quantization here, just use the PNG as is
        const { width, height, data, ctype, tabs } = png;
        console.log(`PNG dimensions: ${width}x${height}, data length: ${data.byteLength}, ctype: ${ctype}, PLTE: ${tabs.PLTE}`);

        return new TxSprite(
            width,
            height,
            tabs.PLTE ? tabs.PLTE.length / 3 : 0, // Number of colors in the palette
            tabs.PLTE ? new Uint8Array(tabs.PLTE) : new Uint8Array(), // Palette data
            new Uint8Array(data.slice(0, width * height)), // Pixel data (palette indices)
            compress
        );
    }

    /**
     * Creates a TxSprite from an image file, resizing and quantizing it to a maximum of 16 colors.
     * @param imageBytes The ArrayBuffer containing the image data.
     * @param maxPixels The maximum number of pixels allowed in the sprite.
     * @param compress Whether to compress the pixel data using LZ4.
     * @returns A TxSprite instance.
     */
    static async fromImageBytes(imageBytes: ArrayBuffer, maxPixels: number = 48000, compress: boolean = false): Promise<TxSprite> {
        let image = await Image.load(imageBytes);

        // Ensure image is RGB (image-js typically handles this by having channels property)
        // If image has alpha and we want to discard it or process it:
        // if (image.alpha) { image = image.rgb(); } // Or handle transparency appropriately

        let imgPixels = image.width * image.height;
        if (imgPixels > maxPixels) {
            const scaleFactor = Math.sqrt(maxPixels / imgPixels);
            image = image.resize({
                factor: scaleFactor,
                //interpolation: 'bicubic' // PIL's LANCZOS equivalent: 'bicubic' or 'bilinear'
            });
        }

        if (image.width > 640 || image.height > 400) {
            image = image.resize({
                width: 640,
                height: 400,
                preserveAspectRatio: true,
                interpolation: 'nearestNeighbor' // PIL's NEAREST
            });
        }
        // log width and height after resizing
        console.log(`Resized image to ${image.width}x${image.height}`);

       // Quantize the image to a maximum of 16 colors using image-q
        const inPointContainer = IQ.utils.PointContainer.fromUint8Array(image.getRGBAData(), image.width, image.height);
        console.log(`PointContainer created with ${inPointContainer.getPointArray().length} points.`);

        // Build a palette with a maximum of 15 colors (save 0 for transparent/void/black color)
        const palette = IQ.buildPaletteSync([inPointContainer], {colors: 15});
        console.log(`Palette built: ${palette.getPointContainer().getPointArray().length} colors.`);
        // insert the void color (0,0,0) at the start of the palette
        palette.getPointContainer().getPointArray().unshift(IQ.utils.Point.createByQuadruplet([0, 0, 0, 0]));

        const outPointContainer = IQ.applyPaletteSync(inPointContainer, palette);
        console.log(`OutPointContainer: ${outPointContainer.getPointArray().length} points.`);

        const indexedPixels = new Uint8Array(outPointContainer.toUint32Array());
        console.log(`Indexed pixel data size: ${indexedPixels.length}.`);

        // Convert image-q palette to our flat Uint8Array RGB format
        const actualNumColors = palette.getPointContainer().getPointArray().length;
        const paletteData = new Uint8Array(actualNumColors * 3);
        palette.getPointContainer().getPointArray().forEach((colorPoint, i) => {
            paletteData[i * 3 + 0] = colorPoint.r;
            paletteData[i * 3 + 1] = colorPoint.g;
            paletteData[i * 3 + 2] = colorPoint.b;
            console.log(`Color ${i}: R=${colorPoint.r}, G=${colorPoint.g}, B=${colorPoint.b}`);
        });

        return new TxSprite(
            image.width,
            image.height,
            actualNumColors,
            paletteData,
            indexedPixels,
            compress
        );
    }

    get bpp(): number {
        if (this.numColors <= 0) {
            return 4;
        }
        if (this.numColors <= 2) {
            return 1;
        } else if (this.numColors <= 4) {
            return 2;
        } else if (this.numColors <= 16) {
            return 4;
        } else {
            console.warn(`numColors (${this.numColors}) is greater than 16. Defaulting BPP to 4.`);
            return 4;
        }
    }

    pack(): Uint8Array {
        let packedPixels: Uint8Array;
        const currentBpp = this.bpp;

        switch (currentBpp) {
            case 1:
                packedPixels = TxSprite._pack_1bit(this.pixelData);
                break;
            case 2:
                packedPixels = TxSprite._pack_2bit(this.pixelData);
                break;
            case 4:
                packedPixels = TxSprite._pack_4bit(this.pixelData);
                break;
            default:
                throw new Error(`Unsupported bpp: ${currentBpp}`);
        }

        const header = new Uint8Array(7);
        const headerView = new DataView(header.buffer);

        headerView.setUint16(0, this.width, false);
        headerView.setUint16(2, this.height, false);
        headerView.setUint8(4, this.compress ? 1 : 0);
        headerView.setUint8(5, currentBpp);
        headerView.setUint8(6, this.numColors > 16 ? 16 : this.numColors);

        let finalPixelData = packedPixels;
        if (this.compress) {
            try {
                // Assuming your 'lz4js' import 'lz4' and its 'compress' method are correct for your setup.
                // The second parameter for compression level might need to be an options object
                // depending on the exact lz4 library version/fork you are using.
                // e.g., for ukyo/lz4.js: finalPixelData = lz4.compress(packedPixels, { preferences: { compressionLevel: 9 } });
                // For now, using your existing call style:
                // If this `lz4.compress` is from 'lz4js' (ukyo/lz4.js), the signature is likely (data, options).
                // The original python-lz4 `compression_level=9` is a high compression setting.
                // `ukyo/lz4.js` uses `preferences: { compressionLevel: number (0-16) }`
                 // If your `lz4.compress(data, level)` is from a different lz4 lib that takes level directly, this is fine.
                 // Otherwise, it should be:
                finalPixelData = lz4.compress(Buffer.from(packedPixels), 9);

            } catch (e) {
                console.error("LZ4 compression failed:", e);
                throw e; // Re-throw after logging
            }
        }

        const result = new Uint8Array(header.length + this.paletteData.length + finalPixelData.length);
        result.set(header, 0);
        result.set(this.paletteData, header.length);
        result.set(finalPixelData, header.length + this.paletteData.length);

        return result;
    }

    private static _pack_1bit(data: Uint8Array): Uint8Array {
        const packedLength = Math.ceil(data.length / 8);
        const packed = new Uint8Array(packedLength);
        for (let i = 0; i < data.length; i++) {
            const byteIdx = Math.floor(i / 8);
            const bitOffset = 7 - (i % 8);
            if (data[i] & 0x01) {
                packed[byteIdx] |= (1 << bitOffset);
            }
        }
        return packed;
    }

    private static _pack_2bit(data: Uint8Array): Uint8Array {
        const packedLength = Math.ceil(data.length / 4);
        const packed = new Uint8Array(packedLength);
        for (let i = 0; i < data.length; i++) {
            const byteIdx = Math.floor(i / 4);
            const bitOffset = (3 - (i % 4)) * 2;
            packed[byteIdx] |= (data[i] & 0x03) << bitOffset;
        }
        return packed;
    }

    private static _pack_4bit(data: Uint8Array): Uint8Array {
        const packedLength = Math.ceil(data.length / 2);
        const packed = new Uint8Array(packedLength);
        for (let i = 0; i < data.length; i++) {
            const byteIdx = Math.floor(i / 2);
            const bitOffset = (1 - (i % 2)) * 4;
            packed[byteIdx] |= (data[i] & 0x0F) << bitOffset;
        }
        return packed;
    }
}

// Example usage:
// async function testSpriteWithImageJS() {
//     // 1. Get an ArrayBuffer of an image (e.g., from a file input or fetch)
//     // For testing, you can create a simple one or use a base64 string converted to ArrayBuffer
//     const base64Image = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNkYPhfz0AEYAIAKoABs680gAAAAABJRU5ErkJggg=="; // 2x2 red PNG
//     const imageBytes = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0)).buffer;

//     try {
//         console.log("Testing fromImageBytes with image-js...");
//         const sprite = await TxSprite.fromImageBytes(imageBytes, 48000, true);
//         console.log("Sprite created:", sprite);
//         const packedData = sprite.pack();
//         console.log("Packed sprite data:", packedData);

//         // Test fromIndexedPngBytes (requires an already indexed PNG)
//         // For this, you'd need a PNG that is already 16 colors or less.
//         // const indexedPngBytes = ... ;
//         // const indexedSprite = await TxSprite.fromIndexedPngBytes(indexedPngBytes, false);
//         // console.log("Packed indexed sprite data:", indexedSprite.pack());

//     } catch (error) {
//         console.error("Error in testSpriteWithImageJS:", error);
//     }
// }

// testSpriteWithImageJS();
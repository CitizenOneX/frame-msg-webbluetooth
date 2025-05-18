import { Image, Stack } from 'image-js';
import lz4 from 'lz4js';

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

    // Helper to convert image-js pixel [R,G,B?,A?] to our RGBColor and a unique key
    private static getPixelInfo(image: Image, x: number, y: number): { color: RGBColor, key: number } {
        const pixel = image.getPixelXY(x, y); // Returns [R, G, B, A?]
        const r = pixel[0];
        const g = pixel[1];
        const b = pixel[2];
        // const a = pixel.length > 3 ? pixel[3] : 255; // Alpha not used for palette key here
        const key = (r << 16) | (g << 8) | b;
        return { color: { r, g, b }, key };
    }

    // This method needs substantial changes for image-js
    private static getUniqueColorsFromImage(
        image: Image,
        maxColors: number
    ): { palette: RGBColor[], indexedPixelData: Uint8Array } {
        const uniqueColorMap = new Map<number, number>(); // colorKey to palette index
        const palette: RGBColor[] = [];
        const indexedPixelData = new Uint8Array(image.width * image.height);
        let pixelDataIndex = 0;

        for (let y = 0; y < image.height; y++) {
            for (let x = 0; x < image.width; x++) {
                const { color, key } = TxSprite.getPixelInfo(image, x, y);
                let paletteIdx = uniqueColorMap.get(key);

                if (paletteIdx === undefined) {
                    if (palette.length < maxColors) {
                        paletteIdx = palette.length;
                        palette.push(color);
                        uniqueColorMap.set(key, paletteIdx);
                    } else {
                        // Simplification: If palette is full, find the closest color in the current palette
                        // This is a basic nearest neighbor, not ideal but a starting point.
                        let minDist = Infinity;
                        let closestIdx = 0;
                        for (let i = 0; i < palette.length; i++) {
                            const palColor = palette[i];
                            const dist =
                                Math.abs(palColor.r - color.r) +
                                Math.abs(palColor.g - color.g) +
                                Math.abs(palColor.b - color.b); // Manhattan distance
                            if (dist < minDist) {
                                minDist = dist;
                                closestIdx = i;
                            }
                        }
                        paletteIdx = closestIdx;
                    }
                }
                indexedPixelData[pixelDataIndex++] = paletteIdx;
            }
        }
        return { palette, indexedPixelData };
    }


    static async fromIndexedPngBytes(imageBytes: ArrayBuffer, compress: boolean = false): Promise<TxSprite> {
        const image = await Image.load(imageBytes);

        // For image-js, an "indexed PNG" will load, and we can inspect its properties.
        // If it has a palette, image.palette will be set. image.meta.palette is also mentioned.
        // However, image-js often converts to an internal RGBA format upon load.
        // So, we'll count unique colors as a proxy, similar to the Jimp approach.

        let colorScan = TxSprite.getUniqueColorsFromImage(image, 16);

        if (colorScan.palette.length > 16) {
            throw new Error("PNG must be effectively indexed with a palette of 16 colors or fewer.");
        }

        let currentImage = image;
        if (currentImage.width > 640 || currentImage.height > 400) {
            currentImage = currentImage.resize({
                width: 640,
                height: 400,
                preserveAspectRatio: true,
                interpolation: 'nearestNeighbor' // PIL's NEAREST
            });
            // Re-scan colors if resized
            colorScan = TxSprite.getUniqueColorsFromImage(currentImage, 16);
            if (colorScan.palette.length > 16) { // Should be unlikely with nearestNeighbor
                throw new Error("Resized PNG has too many colors.");
            }
        }

        const numColors = colorScan.palette.length;
        const paletteData = new Uint8Array(numColors * 3);
        for (let i = 0; i < numColors; i++) {
            paletteData[i * 3 + 0] = colorScan.palette[i].r;
            paletteData[i * 3 + 1] = colorScan.palette[i].g;
            paletteData[i * 3 + 2] = colorScan.palette[i].b;
        }

        const pixelData = colorScan.indexedPixelData;

        return new TxSprite(
            currentImage.width,
            currentImage.height,
            numColors,
            paletteData,
            pixelData,
            compress
        );
    }

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

        // Quantization to 16 colors: This is the challenging part with image-js directly.
        // image-js doesn't have a direct MedianCut to N colors.
        // Approach:
        // 1. Try to reduce colors using bit depth if applicable, though this is more for channel reduction.
        //    e.g., `image = image.convertColor('GREY').convertBitDepth(4);` for 16 shades of grey. Not what we want here.
        // 2. For color images, a more robust solution would be to use a dedicated quantization library
        //    with the pixel data obtained from image-js: `image.getPixelsArray()`.
        //
        // Simplified approach for now (similar to the Jimp attempt):
        // Extract unique colors, and if too many, this approach will be suboptimal.
        // A proper quantizer (e.g. from an external library) should be used here for quality.
        // For demonstration, we'll use the getUniqueColorsFromImage, which will take the first 16
        // unique colors or map to nearest if more are found after resizing.
        // This isn't true quantization but a color sampling.

        // To attempt some color reduction before sampling (optional, may not be PIL's median cut quality):
        // image = image.convertBitDepth(8); // Ensure it's 8-bit per channel if it was higher

        let colorScan = TxSprite.getUniqueColorsFromImage(image, 16);
        let finalPaletteRgb = [...colorScan.palette];
        let finalPixelData = colorScan.indexedPixelData;

        while (finalPaletteRgb.length < 16 && finalPaletteRgb.length > 0) {
            finalPaletteRgb.push({ r: 0, g: 0, b: 0 });
        }
        if (finalPaletteRgb.length === 0 && image.width > 0 && image.height > 0) {
            for (let i = 0; i < 16; ++i) finalPaletteRgb.push({ r: 0, g: 0, b: 0 });
        }

        if (finalPaletteRgb.length === 16) {
            const tempColor = finalPaletteRgb[0];
            finalPaletteRgb[0] = finalPaletteRgb[15];
            finalPaletteRgb[15] = tempColor;

            for (let i = 0; i < finalPixelData.length; i++) {
                if (finalPixelData[i] === 0) {
                    finalPixelData[i] = 255; // Temp
                } else if (finalPixelData[i] === 15) {
                    finalPixelData[i] = 0;
                }
            }
            for (let i = 0; i < finalPixelData.length; i++) {
                if (finalPixelData[i] === 255) {
                    finalPixelData[i] = 15;
                }
            }
            finalPaletteRgb[0] = { r: 0, g: 0, b: 0 };
        }

        const numSpriteColors = finalPaletteRgb.length;
        const paletteDataBytes = new Uint8Array(numSpriteColors * 3);
        for (let i = 0; i < numSpriteColors; i++) {
            paletteDataBytes[i * 3 + 0] = finalPaletteRgb[i].r;
            paletteDataBytes[i * 3 + 1] = finalPaletteRgb[i].g;
            paletteDataBytes[i * 3 + 2] = finalPaletteRgb[i].b;
        }

        const expectedPixelDataLength = image.width * image.height;
        if (finalPixelData.length !== expectedPixelDataLength) {
            console.warn(`Pixel data length mismatch. Expected ${expectedPixelDataLength}, got ${finalPixelData.length}. Reinitializing pixel data.`);
            finalPixelData = new Uint8Array(expectedPixelDataLength).fill(0);
        }


        return new TxSprite(
            image.width,
            image.height,
            numSpriteColors > 0 ? numSpriteColors : 16,
            paletteDataBytes,
            finalPixelData,
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
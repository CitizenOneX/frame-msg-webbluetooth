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
 * Options for creating a TxSprite instance.
 */
export interface TxSpriteOptions {
    /** The width of the sprite in pixels. */
    width: number;
    /** The height of the sprite in pixels. */
    height: number;
    /** The number of colors in the sprite's palette. */
    numColors: number;
    /** The palette data as a flat Uint8Array of RGB values. */
    paletteData: Uint8Array;
    /** The pixel data as a Uint8Array of palette indices. */
    pixelData: Uint8Array;
    /** Optional flag whether to compress the pixel data using LZ4. Defaults to false. */
    compress?: boolean;
}

/**
 * A sprite message containing image data with a custom palette.
 */
export class TxSprite {
    /** The width of the sprite in pixels. */
    public width: number;
    /** The height of the sprite in pixels. */
    public height: number;
    /** The number of colors in the sprite's palette. */
    public numColors: number;
    /** The palette data as a flat Uint8Array of RGB values. */
    public paletteData: Uint8Array;
    /** The pixel data as a Uint8Array of palette indices. */
    public pixelData: Uint8Array;
    /** Whether the pixel data is compressed using LZ4. */
    public compress: boolean;

    /**
     * Creates an instance of TxSprite.
     * @param options Configuration options for the sprite.
     */
    constructor(options: TxSpriteOptions) {
        this.width = options.width;
        this.height = options.height;
        this.numColors = options.numColors;
        this.paletteData = options.paletteData;
        this.pixelData = options.pixelData;
        this.compress = options.compress ?? false;

        if (this.paletteData.length / 3 !== this.numColors && this.numColors > 0) {
            console.warn(`TxSprite constructor: numColors (${this.numColors}) does not match paletteData length (${this.paletteData.length / 3} colors).`);
        }
        if (this.pixelData.length !== this.width * this.height && this.width * this.height > 0) {
            console.warn(`TxSprite constructor: pixelData length (${this.pixelData.length}) does not match width*height (${this.width*this.height}).`);
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

        return new TxSprite({
            width,
            height,
            numColors: tabs.PLTE ? tabs.PLTE.length / 3 : 0, // Number of colors in the palette
            paletteData: tabs.PLTE ? new Uint8Array(tabs.PLTE) : new Uint8Array(), // Palette data
            pixelData: new Uint8Array(data.slice(0, width * height)), // Pixel data (palette indices)
            compress
        });
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

        // manually map the quntized pixel data to indices
        const palettePoints = palette.getPointContainer().getPointArray();
        const outputPoints = outPointContainer.getPointArray();
        const indexedPixels = new Uint8Array(outputPoints.length);

        for (let i = 0; i < outputPoints.length; i++) {
            const p = outputPoints[i];
            const r = p.r, g = p.g, b = p.b, a = p.a;

            // Find matching index in palette
            const idx = palettePoints.findIndex(q => q.r === r && q.g === g && q.b === b && q.a === a);
            if (idx === -1) {
                throw new Error(`Could not find palette index for pixel ${i} with color (${r},${g},${b},${a})`);
            }

            indexedPixels[i] = idx;
        }

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

        return new TxSprite({
            width: image.width,
            height: image.height,
            numColors: actualNumColors,
            paletteData,
            pixelData: indexedPixels,
            compress
        });
    }

    /**
     * The number of bits per pixel, derived from the number of colors.
     */
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

    /**
     * Packs the sprite data into a compact binary format.
     * The format includes a header, palette data, and packed pixel data.
     * Pixel data can be optionally compressed using LZ4.
     * @returns A Uint8Array containing the packed sprite data.
     */
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

    /**
     * Packs pixel data into 1-bit per pixel format.
     */
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

    /**
     * Packs pixel data into 2-bits per pixel format.
     */
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

    /**
     * Packs pixel data into 4-bits per pixel format.
     */
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

    /**
     * Converts the TxSprite to a PNG image as an ArrayBuffer.
     * Intended for debugging and visualization purposes.
     * @returns The PNG image data as an ArrayBuffer.
     */
    toPngBytes(): ArrayBuffer {
        // Create a PNG using the indexed pixel data and custom palette
        // log the input parameters
        console.log(`Creating PNG: width=${this.width}, height=${this.height}, numColors=${this.numColors}, paletteData length=${this.paletteData.length}, pixelData length=${this.pixelData.length}`);

        return TxSprite._makeRGBAPngFromIndexed(
            this.width,
            this.height,
            this.paletteData,
            this.pixelData
        );
    }

    /**
     * Create a true-color PNG from an indexed palette and pixel data.
     * @param width Image width in pixels
     * @param height Image height in pixels
     * @param paletteRGB Flat RGB Uint8Array of colors: [r0,g0,b0, r1,g1,b1, ..., rN,gN,bN]
     * @param pixelIndices Uint8Array of palette indices (length = width * height)
     * @returns PNG as ArrayBuffer
     */
    private static _makeRGBAPngFromIndexed(
        width: number,
        height: number,
        paletteRGB: Uint8Array,
        pixelIndices: Uint8Array
    ): ArrayBuffer {

        const numPixels = width * height;
        if (pixelIndices.length !== numPixels) {
            throw new Error(`Pixel index data (${pixelIndices.length}) does not match image size (${numPixels}).`);
        }

        if (paletteRGB.length % 3 !== 0) {
            throw new Error("Palette must be a flat RGB array of triplets.");
        }

        const rgba = new Uint8Array(numPixels * 4);
        for (let i = 0; i < numPixels; i++) {
            const idx = pixelIndices[i];
            if (idx < 0 || idx >= paletteRGB.length / 3) {
                throw new Error(`Pixel index ${idx} out of bounds for palette of length ${paletteRGB.length / 3}.`);
            }
            const r = paletteRGB[idx * 3] ?? 128;
            const g = paletteRGB[idx * 3 + 1] ?? 128;
            const b = paletteRGB[idx * 3 + 2] ?? 128;

            const offset = i * 4;
            rgba[offset] = r;
            rgba[offset + 1] = g;
            rgba[offset + 2] = b;
            rgba[offset + 3] = 255; // fully opaque
        }

        return UPNG.encode([rgba.buffer], width, height, 0); // 0 = lossless
    }
}

/**
 * generate-icons.mjs
 * Generates simple PNG icons for the extension using Canvas API (Node.js via canvas package)
 * OR creates minimal valid PNG files using pure binary encoding.
 *
 * This script creates valid 16x16, 32x32, 48x48, and 128x128 PNG files
 * without requiring any external graphics tools.
 *
 * Run: node generate-icons.mjs
 */

import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconsDir = path.join(__dirname, 'assets', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

/**
 * Creates a minimal valid PNG file from scratch using binary encoding.
 * The icon is a gradient purple circle with a stylised hand gesture symbol.
 *
 * @param {number} size - Icon size in pixels (square).
 * @returns {Buffer} PNG file bytes.
 */
function createIconPNG(size) {
  // We'll write raw RGBA pixel data then encode as PNG manually.
  // PNG structure: signature + IHDR + IDAT + IEND
  
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;
      
      if (dist <= r) {
        // Gradient from indigo (#6366f1) to violet (#8b5cf6)
        const t = (x + y) / (size * 2);
        pixels[idx]     = Math.round(99 + (139 - 99) * t);    // R
        pixels[idx + 1] = Math.round(102 + (92 - 102) * t);   // G
        pixels[idx + 2] = Math.round(241 + (246 - 241) * t);  // B
        pixels[idx + 3] = 255;                                  // A
        
        // Draw a simple "hand up" shape in white
        const inner = r * 0.6;
        const handX = dx / inner;
        const handY = dy / inner;
        
        // Palm area (bottom center)
        if (handY > 0.1 && handY < 0.7 && Math.abs(handX) < 0.5) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
          pixels[idx + 3] = 230;
        }
        // Index finger pointing up
        if (handY > -0.9 && handY < 0.1 && handX > -0.12 && handX < 0.12) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
          pixels[idx + 3] = 230;
        }
        // Middle finger
        if (handY > -0.7 && handY < 0.15 && handX > 0.08 && handX < 0.32) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
          pixels[idx + 3] = 200;
        }
        // Ring finger
        if (handY > -0.5 && handY < 0.25 && handX > 0.28 && handX < 0.50) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
          pixels[idx + 3] = 200;
        }
        // Pinky
        if (handY > -0.3 && handY < 0.30 && handX > -0.50 && handX < -0.28) {
          pixels[idx] = 255;
          pixels[idx + 1] = 255;
          pixels[idx + 2] = 255;
          pixels[idx + 3] = 180;
        }
      }
    }
  }
  
  return encodePNG(size, size, pixels);
}

/**
 * Encodes raw RGBA pixel data into a valid PNG binary.
 * Implements a minimal subset of PNG: IHDR + raw IDAT (uncompressed) + IEND.
 */
function encodePNG(width, height, pixels) {
  // PNG signature
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  
  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB (we'll strip alpha for simplicity in display but keep RGBA data below)
  // Actually use color type 6 (RGBA)
  ihdr[9] = 6;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  
  // For each row, add a filter byte (0 = None) before the pixel data.
  const rawRows = [];
  for (let y = 0; y < height; y++) {
    rawRows.push(0); // filter type None
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rawRows.push(pixels[i], pixels[i+1], pixels[i+2], pixels[i+3]);
    }
  }
  const rawData = Buffer.from(rawRows);
  
  // Compress with zlib (deflate). Node's built-in zlib.
  const compressed = zlib.deflateSync(rawData, { level: 9 });
  
  function makeChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const typeB = Buffer.from(type, 'ascii');
    const crcData = Buffer.concat([typeB, data]);
    const crc = crc32(crcData);
    const crcB = Buffer.alloc(4);
    crcB.writeInt32BE(crc | 0);
    return Buffer.concat([len, typeB, data, crcB]);
  }
  
  const ihdrChunk = makeChunk('IHDR', ihdr);
  const idatChunk = makeChunk('IDAT', compressed);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([sig, ihdrChunk, idatChunk, iendChunk]);
}

// CRC32 table
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) | 0;
}

// Generate icons
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  try {
    const png = await createIconPNG(size);
    const outPath = path.join(iconsDir, `icon${size}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`[icons] Generated icon${size}.png (${png.length} bytes)`);
  } catch (err) {
    console.error(`[icons] Failed to generate icon${size}.png:`, err);
  }
}

console.log('[icons] Done.');

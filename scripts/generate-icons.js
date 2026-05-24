/**
 * Generates icon-192.png and icon-512.png using only Node.js built-ins.
 * Run once: node scripts/generate-icons.js
 */
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

/* ── CRC32 ──────────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ── PNG chunk builder ──────────────────────────────────────── */
function chunk(type, data) {
  const len  = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tb   = Buffer.from(type, 'ascii');
  const crcv = Buffer.alloc(4); crcv.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, crcv]);
}

/* ── PNG encoder (RGB, no alpha) ────────────────────────────── */
function encodePNG(w, h, getPixel) {
  // Build raw scanlines (filter byte 0 + RGB per pixel)
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 3);
    row[0] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = getPixel(x, y);
      row[1 + x * 3]     = r;
      row[1 + x * 3 + 1] = g;
      row[1 + x * 3 + 2] = b;
    }
    rows.push(row);
  }

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0); ihdrData.writeUInt32BE(h, 4);
  ihdrData[8] = 8; ihdrData[9] = 2; // 8-bit RGB

  const compressed = zlib.deflateSync(Buffer.concat(rows), { level: 6 });

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG signature
    chunk('IHDR', ihdrData),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ── Icon pixel function ────────────────────────────────────── */
function makeIconPixel(size) {
  const BG     = [19,  32,  25];   // #132019 dark green background
  const LEAF_L = [42,  107, 74];   // #2a6b4a darker left half
  const LEAF_R = [91,  191, 144];  // #5bbf90 lighter right half
  const VEIN   = [13,  26,  17];   // dark vein line

  const cx      = size / 2;
  const tipY    = size * 0.17;
  const botY    = size * 0.86;
  const maxHw   = size * 0.235;
  const veinW   = Math.max(2, size * 0.018);

  // Rounded-square background mask (matches manifest icon shape)
  const radius  = size * 0.22;
  function inRoundedSquare(x, y) {
    const dx = Math.max(0, Math.abs(x - cx) - (size / 2 - radius));
    const dy = Math.max(0, Math.abs(y - cx) - (size / 2 - radius));
    return dx * dx + dy * dy <= radius * radius;
  }

  function inLeaf(x, y) {
    if (y < tipY || y > botY) return false;
    const t  = (y - tipY) / (botY - tipY);
    const hw = maxHw * Math.sin(Math.PI * t);
    return Math.abs(x - cx) <= hw;
  }

  return (x, y) => {
    if (!inRoundedSquare(x, y)) return BG; // corners outside visible rounded square
    if (!inLeaf(x, y))          return BG;
    if (Math.abs(x - cx) <= veinW) return VEIN;
    return x < cx ? LEAF_L : LEAF_R;
  };
}

/* ── Generate both sizes ────────────────────────────────────── */
const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const buf  = encodePNG(size, size, makeIconPixel(size));
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, buf);
  console.log(`✓  ${file}  (${(buf.length / 1024).toFixed(1)} KB)`);
}

console.log('Done.');

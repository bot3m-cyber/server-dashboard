'use strict';
// Fünf fertige Server-Icons (selbst gezeichnete Pixelbilder im Minecraft-Stil), 64 × 64 Pixel wie von Minecraft verlangt.
// Sie werden beim ersten Abruf erzeugt, es liegen keine Bilddateien im Projekt.
const zlib = require('zlib');

// ---------------------------------------------------------------- PNG-Schreiber (RGBA, ohne Zusatzpakete)

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 Bit, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------- Zeichnen (16 × 16, dann vierfach vergrößert)

const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** Gleichbleibendes Rauschen (gleiche Eingabe, gleiches Bild). */
function noise(x, y, seed) {
  let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return (((n ^ (n >>> 16)) >>> 0) % 1000) / 1000;
}

function canvas() {
  const px = Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => hex('#000000')));
  return {
    set: (x, y, c) => { if (x >= 0 && x < 16 && y >= 0 && y < 16) px[y][x] = Array.isArray(c) ? c : hex(c); },
    get: (x, y) => px[y][x],
    toPng() {
      const rgba = Buffer.alloc(64 * 64 * 4);
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const [r, g, b] = px[y >> 2][x >> 2];
          const o = (y * 64 + x) * 4;
          rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
        }
      }
      return encodePng(64, 64, rgba);
    },
  };
}

const pick = (list, n) => list[Math.min(list.length - 1, Math.floor(n * list.length))];

function grasblock() {
  const c = canvas();
  const grass = ['#4f8f2b', '#5da130', '#6cbd3a', '#559a2d'];
  const dirt = ['#8b5a2b', '#7a4d24', '#9c6a38', '#6e4521'];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = noise(x, y, 1);
      const edge = 4 + Math.floor(noise(x, 99, 2) * 3); // unregelmäßige Graskante
      if (y < edge) c.set(x, y, pick(grass, n));
      else c.set(x, y, n > 0.93 ? '#8a8a8a' : pick(dirt, n));
    }
  }
  return c.toPng();
}

function creeper() {
  const c = canvas();
  const g = ['#3d8a2c', '#4fa23a', '#68b84a', '#44922f'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, pick(g, noise(x, y, 3)));
  const dark = '#101410';
  for (let y = 4; y <= 6; y++) for (const x of [3, 4, 5, 10, 11, 12]) c.set(x, y, dark); // Augen
  for (let y = 7; y <= 8; y++) for (let x = 6; x <= 9; x++) c.set(x, y, dark); // Nase
  for (let y = 9; y <= 12; y++) for (const x of [5, 6, 9, 10]) c.set(x, y, dark); // Mund
  return c.toPng();
}

function diamant() {
  const c = canvas();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, pick(['#222b36', '#2b3541', '#26303b'], noise(x, y, 4)));
  const rows = { 2: [6, 9], 3: [5, 10], 4: [4, 11], 5: [3, 12], 6: [3, 12], 7: [4, 11], 8: [5, 10], 9: [6, 9], 10: [7, 8] };
  for (const [ys, [a, b]] of Object.entries(rows)) {
    const y = Number(ys);
    for (let x = a; x <= b; x++) {
      let col = '#3fd9d1';
      if (x === a || x === b || y === 2 || y === 10) col = '#1fa6a8';
      else if (y <= 4 && x <= 7) col = '#b7fff8';
      else if (y >= 7) col = '#2fbfc0';
      c.set(x, y, col);
    }
  }
  c.set(5, 4, '#ffffff'); c.set(6, 3, '#ffffff');
  return c.toPng();
}

const GLYPH = { T: ['###', '.#.', '.#.', '.#.', '.#.'], N: ['#.#', '###', '###', '#.#', '#.#'] };

function tnt() {
  const c = canvas();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const n = noise(x, y, 5);
      c.set(x, y, x % 4 === 0 ? '#9d2a22' : pick(['#c8372d', '#d1463b', '#bd3027'], n));
    }
  }
  for (let y = 5; y <= 11; y++) for (let x = 0; x < 16; x++) c.set(x, y, y === 5 || y === 11 ? '#cfcfcf' : '#f0f0f0');
  const word = ['T', 'N', 'T'];
  word.forEach((ch, i) => {
    GLYPH[ch].forEach((row, dy) => {
      for (let dx = 0; dx < 3; dx++) if (row[dx] === '#') c.set(2 + i * 4 + dx, 6 + dy, '#1a1a1a');
    });
  });
  return c.toPng();
}

function schwert() {
  const c = canvas();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) c.set(x, y, pick(['#5b9bd5', '#639fd7', '#7ab0de'], (y / 16) * 0.6 + noise(x, y, 6) * 0.4));
  for (let i = 0; i <= 10; i++) {
    const x = 3 + i;
    const y = 12 - i;
    c.set(x, y, '#e6eaee'); c.set(x + 1, y, '#aab3bd'); c.set(x, y + 1, '#c4cbd3');
  }
  c.set(13, 2, '#ffffff'); c.set(14, 2, '#e6eaee'); c.set(13, 1, '#e6eaee');
  for (let k = 0; k < 4; k++) { c.set(2 + k, 8 + k + 0, '#d4a017'); c.set(2 + k, 9 + k, '#a87c0f'); } // Parierstange
  c.set(3, 13, '#7a4d24'); c.set(2, 14, '#6e4521'); c.set(1, 15, '#7a4d24'); c.set(3, 12, '#7a4d24');
  return c.toPng();
}

const PRESETS = [
  { id: 'gras', name: 'Grasblock', draw: grasblock },
  { id: 'creeper', name: 'Creeper', draw: creeper },
  { id: 'diamant', name: 'Diamant', draw: diamant },
  { id: 'tnt', name: 'TNT', draw: tnt },
  { id: 'schwert', name: 'Schwert', draw: schwert },
];
const cache = new Map();

const list = () => PRESETS.map(({ id, name }) => ({ id, name }));

/** Das PNG eines fertigen Icons oder null. */
function render(id) {
  const p = PRESETS.find((x) => x.id === id);
  if (!p) return null;
  if (!cache.has(id)) cache.set(id, p.draw());
  return cache.get(id);
}

module.exports = { list, render, encodePng };

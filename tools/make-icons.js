// 零依赖生成 PWA 图标：两块并排的竖条 + 中间那道缝，就是这个 App 的图标语言。
// 用法：node tools/make-icons.js

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..');
const SS = 4; // 超采样倍数，用来做抗锯齿

const BG = [0x1d, 0x1d, 0x1f]; // DESIGN.md {colors.ink}
const FG = [0xff, 0xff, 0xff];

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // 色彩类型 RGBA

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // 每行的滤波器字节：none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const nx = Math.min(Math.max(px, x + r), x + w - r);
  const ny = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - nx;
  const dy = py - ny;
  return dx * dx + dy * dy <= r * r;
}

function render(size) {
  const N = size * SS;
  const barW = N * 0.26;
  const barH = N * 0.52;
  const gap = N * 0.08;
  const radius = N * 0.07;
  const top = (N - barH) / 2;
  const leftX = (N - (barW * 2 + gap)) / 2;
  const rightX = leftX + barW + gap;

  const out = Buffer.alloc(size * size * 4);
  const samples = SS * SS;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let hits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          if (
            insideRoundRect(px, py, leftX, top, barW, barH, radius) ||
            insideRoundRect(px, py, rightX, top, barW, barH, radius)
          ) {
            hits++;
          }
        }
      }
      const a = hits / samples;
      const i = (y * size + x) * 4;
      out[i] = Math.round(BG[0] + (FG[0] - BG[0]) * a);
      out[i + 1] = Math.round(BG[1] + (FG[1] - BG[1]) * a);
      out[i + 2] = Math.round(BG[2] + (FG[2] - BG[2]) * a);
      out[i + 3] = 255; // iOS 的主屏图标不吃透明，铺满底色
    }
  }

  return out;
}

for (const size of [180, 192, 512]) {
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, size, render(size)));
  console.log(`icon-${size}.png`);
}

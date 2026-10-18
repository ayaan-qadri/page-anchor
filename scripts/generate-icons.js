#!/usr/bin/env node
/**
 * Page Anchor icon pipeline.
 *
 * Derives the extension icon set from a single high-resolution source image:
 * detects the artwork's bounding box, crops a centred square around it,
 * resamples with area averaging, and masks the result into a rounded tile.
 *
 * Usage:
 *   node scripts/generate-icons.js                  # regenerate from assets/icon-source.png
 *   node scripts/generate-icons.js <source.png>     # regenerate from another source
 *   node scripts/generate-icons.js --all            # also emit 19/38/64/96/256/512
 *   node scripts/generate-icons.js <source> --write-master
 *                                                   # write the master to assets/ and stop
 *
 * Deliberately dependency-free: PNG decode/encode is implemented here so the
 * icon set stays reproducible with a plain `node` invocation.
 */
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

/** Optically tighter crop at the smallest sizes so the mark still reads. */
const CROP_PLAN = (size) => (size <= 19 ? 1.04 : 1.22);
const CORNER_RADIUS = 0.22;
/** Distance (sum of channel deltas) from the background that counts as artwork. */
const CONTENT_THRESHOLD = 40;
const CORE_SIZES = [16, 32, 48, 128];
const EXTRA_SIZES = [19, 38, 64, 96, 256, 512];
/**
 * Resolution of the committed master. 512 is 4x the largest shipped icon, so
 * every output still gets supersampled, and it keeps the repo binary small.
 */
const MASTER_SIZE = 512;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }

  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat = [];

  while (pos + 12 <= buf.length) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + length);

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }

    pos += 12 + length;
  }

  if (bitDepth !== 8) throw new Error(`unsupported bit depth: ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNGs are not supported');

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (channels === 0) {
    throw new Error(`unsupported colour type: ${colorType} (expected RGB or RGBA)`);
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const data = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);

  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    unfilterLine(line, previous, channels, filter);

    for (let x = 0; x < width; x++) {
      const s = x * channels;
      const d = (y * width + x) * 4;
      data[d] = line[s];
      data[d + 1] = line[s + 1];
      data[d + 2] = line[s + 2];
      data[d + 3] = channels === 4 ? line[s + 3] : 255;
    }

    previous = line;
  }

  return { width, height, data };
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

function unfilterLine(line, previous, bpp, filter) {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? line[i - bpp] : 0;
    const b = previous[i];
    const c = i >= bpp ? previous[i - bpp] : 0;

    switch (filter) {
      case 0:
        break;
      case 1:
        line[i] = (line[i] + a) & 0xff;
        break;
      case 2:
        line[i] = (line[i] + b) & 0xff;
        break;
      case 3:
        line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
        break;
      case 4:
        line[i] = (line[i] + paeth(a, b, c)) & 0xff;
        break;
      default:
        throw new Error(`unknown PNG filter: ${filter}`);
    }
  }
}

const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const previous = Buffer.alloc(stride);
  const candidate = Buffer.alloc(stride);
  const bpp = 4;

  for (let y = 0; y < height; y++) {
    const line = rgba.subarray(y * stride, (y + 1) * stride);
    let bestFilter = 0;
    let bestScore = Infinity;
    let best = null;

    for (let filter = 0; filter < 5; filter++) {
      let score = 0;

      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = previous[i];
        const c = i >= bpp ? previous[i - bpp] : 0;
        let value;

        switch (filter) {
          case 0:
            value = line[i];
            break;
          case 1:
            value = (line[i] - a) & 0xff;
            break;
          case 2:
            value = (line[i] - b) & 0xff;
            break;
          case 3:
            value = (line[i] - ((a + b) >> 1)) & 0xff;
            break;
          default:
            value = (line[i] - paeth(a, b, c)) & 0xff;
            break;
        }

        candidate[i] = value;
        score += value < 128 ? value : 256 - value;
      }

      if (score < bestScore) {
        bestScore = score;
        bestFilter = filter;
        best = Buffer.from(candidate);
      }
    }

    raw[y * (stride + 1)] = bestFilter;
    best.copy(raw, y * (stride + 1) + 1);
    line.copy(previous);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    PNG_SIGNATURE,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    makeChunk('IEND', Buffer.alloc(0)),
  ]);
}

function contentBounds({ width, height, data }) {
  const bgIndex = 0;
  const bgR = data[bgIndex];
  const bgG = data[bgIndex + 1];
  const bgB = data[bgIndex + 2];

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const delta =
        Math.abs(data[i] - bgR) +
        Math.abs(data[i + 1] - bgG) +
        Math.abs(data[i + 2] - bgB);

      if (delta > CONTENT_THRESHOLD) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (maxX < 0) throw new Error('source image appears to be a single flat colour');

  return { minX, minY, maxX, maxY };
}

function cropSquare(image, bounds, padFactor) {
  const { width, height, data } = image;
  const spanX = bounds.maxX - bounds.minX + 1;
  const spanY = bounds.maxY - bounds.minY + 1;
  const side = Math.round(Math.max(spanX, spanY) * padFactor);

  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreY = (bounds.minY + bounds.maxY) / 2;
  let originX = Math.round(centreX - side / 2);
  let originY = Math.round(centreY - side / 2);

  // Keep the window inside the source; clamp rather than pad
  originX = Math.max(0, Math.min(width - side, originX));
  originY = Math.max(0, Math.min(height - side, originY));

  const out = Buffer.alloc(side * side * 4);

  for (let y = 0; y < side; y++) {
    const sy = Math.min(height - 1, originY + y);
    for (let x = 0; x < side; x++) {
      const sx = Math.min(width - 1, originX + x);
      const s = (sy * width + sx) * 4;
      const d = (y * side + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }

  return { width: side, height: side, data: out };
}

/** Area-averaging resample. Exact for integer ratios, good enough for the rest. */
function resample(src, dw, dh) {
  const { width: sw, height: sh, data } = src;
  if (sw === dw && sh === dh) return src;

  const out = Buffer.alloc(dw * dh * 4);
  const scaleX = sw / dw;
  const scaleY = sh / dh;

  for (let dy = 0; dy < dh; dy++) {
    const y0 = dy * scaleY;
    const y1 = (dy + 1) * scaleY;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(sh - 1, Math.ceil(y1) - 1);

    for (let dx = 0; dx < dw; dx++) {
      const x0 = dx * scaleX;
      const x1 = (dx + 1) * scaleX;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(sw - 1, Math.ceil(x1) - 1);

      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let total = 0;

      for (let sy = iy0; sy <= iy1; sy++) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        if (wy <= 0) continue;

        for (let sx = ix0; sx <= ix1; sx++) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
          if (wx <= 0) continue;

          const weight = wx * wy;
          const s = (sy * sw + sx) * 4;
          r += data[s] * weight;
          g += data[s + 1] * weight;
          b += data[s + 2] * weight;
          a += data[s + 3] * weight;
          total += weight;
        }
      }

      const d = (dy * dw + dx) * 4;
      out[d] = Math.round(r / total);
      out[d + 1] = Math.round(g / total);
      out[d + 2] = Math.round(b / total);
      out[d + 3] = Math.round(a / total);
    }
  }

  return { width: dw, height: dh, data: out };
}

/** Repeated halving preserves detail better than a single large resample. */
function resampleProgressive(src, size) {
  let current = src;
  while (current.width > size * 2) {
    const next = Math.max(size, Math.round(current.width / 2));
    current = resample(current, next, next);
  }
  return resample(current, size, size);
}

/**
 * Clip the tile to a rounded rect with a ~1px anti-aliased edge, using the
 * signed distance to the corner arcs so the outline stays crisp at every size.
 */
function roundTile(image) {
  const size = image.width;
  const radius = size * CORNER_RADIUS;
  const centre = size / 2;
  const straight = centre - radius;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - centre;
      const py = y + 0.5 - centre;
      const dx = Math.max(Math.abs(px) - straight, 0);
      const dy = Math.max(Math.abs(py) - straight, 0);
      const distance = Math.sqrt(dx * dx + dy * dy) - radius;

      let coverage = 0.5 - distance;
      coverage = coverage < 0 ? 0 : coverage > 1 ? 1 : coverage;

      const i = (y * size + x) * 4 + 3;
      image.data[i] = Math.round(image.data[i] * coverage);
    }
  }

  return image;
}

function parseArgs(argv) {
  const options = { source: null, out: 'public', all: false, writeMaster: false };

  for (const arg of argv) {
    if (arg === '--all') options.all = true;
    else if (arg === '--write-master') options.writeMaster = true;
    else if (arg.startsWith('--out=')) options.out = arg.slice('--out='.length);
    else if (!arg.startsWith('--')) options.source = arg;
    else throw new Error(`unknown option: ${arg}`);
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const root = process.cwd();
  const source = path.resolve(options.source ?? path.join(root, 'assets', 'icon-source.png'));
  const outDir = path.resolve(root, options.out);

  if (!fs.existsSync(source)) {
    console.error(`Source image not found: ${source}`);
    console.error('Pass a path, or place a high-resolution PNG at assets/icon-source.png.');
    process.exit(1);
  }

  const image = decodePng(fs.readFileSync(source));

  if (options.writeMaster) {
    const masterDir = path.join(root, 'assets');
    fs.mkdirSync(masterDir, { recursive: true });
    const master = resampleProgressive(image, MASTER_SIZE);
    const target = path.join(masterDir, 'icon-source.png');
    fs.writeFileSync(target, encodePng(master.width, master.height, master.data));
    const kb = (fs.statSync(target).size / 1024).toFixed(0);
    console.log(`Wrote ${path.relative(root, target)} (${MASTER_SIZE}x${MASTER_SIZE}, ${kb} KB)`);
    return;
  }

  const bounds = contentBounds(image);
  const sizes = options.all ? [...CORE_SIZES, ...EXTRA_SIZES] : CORE_SIZES;
  const crops = new Map();

  fs.mkdirSync(outDir, { recursive: true });

  for (const size of [...sizes].sort((a, b) => a - b)) {
    const padFactor = CROP_PLAN(size);
    if (!crops.has(padFactor)) {
      crops.set(padFactor, cropSquare(image, bounds, padFactor));
    }

    const scaled = resampleProgressive(crops.get(padFactor), size);
    const tile = roundTile(scaled);
    const target = path.join(outDir, `icon-${size}.png`);
    fs.writeFileSync(target, encodePng(tile.width, tile.height, tile.data));
    console.log(`icon-${size}.png  (${(fs.statSync(target).size / 1024).toFixed(1)} KB)`);
  }

  console.log(`\nWrote ${sizes.length} icons to ${path.relative(root, outDir) || '.'}`);
}

main();

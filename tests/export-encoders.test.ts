import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { A4, PdfEncoder, rowsPerA4Page } from '../src/export/pdf';
import { PngEncoder, crc32 } from '../src/export/png';
import type { RgbaRows } from '../src/export/rows';

function gradient(width: number, height: number, seed = 0): RgbaRows {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = (x * 7 + seed) & 0xff;
      data[i + 1] = (y * 13 + seed) & 0xff;
      data[i + 2] = (x * y + seed) & 0xff;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}

/** Reverses the PNG "Up" filter and returns RGB rows. */
function unfilterUp(raw: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 3;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (stride + 1)]).toBe(2);
    for (let i = 0; i < stride; i++) {
      const up = y > 0 ? out[(y - 1) * stride + i] : 0;
      out[y * stride + i] = (raw[y * (stride + 1) + 1 + i] + up) & 0xff;
    }
  }
  return out;
}

function rgbOf(image: RgbaRows, fromRow = 0, rows = image.height): Uint8Array {
  const out = new Uint8Array(image.width * rows * 3);
  for (let p = 0; p < image.width * rows; p++) {
    const s = (fromRow * image.width + p) * 4;
    out.set([image.data[s], image.data[s + 1], image.data[s + 2]], p * 3);
  }
  return out;
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function readPng(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks: { type: string; data: Uint8Array }[] = [];
  let at = 8;
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const typeBytes = bytes.subarray(at + 4, at + 8);
    const data = bytes.subarray(at + 8, at + 8 + length);
    expect(view.getUint32(at + 8 + length)).toBe(crc32(typeBytes, data));
    chunks.push({ type: new TextDecoder().decode(typeBytes), data });
    at += 12 + length;
  }
  return chunks;
}

describe('crc32', () => {
  it('matches the standard check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('PngEncoder', () => {
  it('writes a valid PNG whose pixels round-trip across several row batches', async () => {
    const image = gradient(37, 50);
    const png = new PngEncoder(37);
    await png.addRows({ width: 37, height: 20, data: image.data.subarray(0, 37 * 20 * 4) });
    await png.addRows({ width: 37, height: 30, data: image.data.subarray(37 * 20 * 4) });
    const blob = await png.finish();
    expect(blob.type).toBe('image/png');

    const chunks = readPng(await bytesOf(blob));
    expect(chunks.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    const ihdr = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
    expect([ihdr.getUint32(0), ihdr.getUint32(4), chunks[0].data[8], chunks[0].data[9]]).toEqual([37, 50, 8, 2]);

    const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
    expect(unfilterUp(raw, 37, 50)).toEqual(rgbOf(image));
  });

  it('splits large compressed data across IDAT chunks', async () => {
    const width = 700;
    const height = 700;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < data.length; i += 65536) crypto.getRandomValues(data.subarray(i, i + 65536));
    const png = new PngEncoder(width);
    await png.addRows({ width, height, data });
    const chunks = readPng(await bytesOf(await png.finish()));
    expect(chunks.filter((c) => c.type === 'IDAT').length).toBeGreaterThan(1);
  });

  it('rejects rows of the wrong width and an empty image', async () => {
    const png = new PngEncoder(4);
    await expect(png.addRows(gradient(3, 1))).rejects.toThrow(/width/);
    await expect(png.finish()).rejects.toThrow(/No rows/);
  });
});

describe('PdfEncoder', () => {
  function parsePdf(text: string) {
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)?.[1]);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.slice(startxref, startxref + 5)).toBe('xref\n');
    const [, , countText] = /xref\n(\d+) (\d+)\n/.exec(text.slice(startxref))!;
    const count = Number(countText);
    const entries = text.slice(startxref).split('\n').slice(3, 2 + count);
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset).startsWith(`${i + 1} 0 obj\n`)).toBe(true);
    });
    return { count };
  }

  it('slices a tall image onto A4 pages with valid cross-references', async () => {
    const width = 20;
    const pageRows = rowsPerA4Page(width);
    const height = pageRows * 2 + 5;
    const image = gradient(width, height, 3);

    const pdf = new PdfEncoder(width);
    // Uneven batches cross page boundaries mid-batch.
    await pdf.addRows({ width, height: 10, data: image.data.subarray(0, width * 10 * 4) });
    await pdf.addRows({ width, height: height - 10, data: image.data.subarray(width * 10 * 4) });
    const blob = await pdf.finish();
    expect(blob.type).toBe('application/pdf');

    // latin1 keeps one character per byte so string offsets equal byte offsets.
    const bytes = await bytesOf(blob);
    const text = Buffer.from(bytes).toString('latin1');
    const { count } = parsePdf(text);
    expect(count).toBe(3 + 3 * 3);
    expect(text).toContain('/Count 3');
    expect(text).toContain(`/MediaBox [0 0 ${A4.width} ${A4.height}]`);

    const streams = [...text.matchAll(/\/Height (\d+)[^]*?\/Length (\d+) >>\nstream\n/g)];
    expect(streams.map((m) => Number(m[1]))).toEqual([pageRows, pageRows, 5]);
    let from = 0;
    for (const match of streams) {
      const rows = Number(match[1]);
      const start = match.index! + match[0].length;
      const raw = inflateSync(bytes.subarray(start, start + Number(match[2])));
      expect(unfilterUp(raw, width, rows)).toEqual(rgbOf(image, from, rows));
      from += rows;
    }
  });

  it('pins a short last page to the top of the sheet', async () => {
    const pdf = new PdfEncoder(100);
    await pdf.addRows(gradient(100, 50));
    const text = Buffer.from(await bytesOf(await pdf.finish())).toString('latin1');
    const drawHeight = (A4.width * 50) / 100;
    expect(text).toContain(`q ${A4.width} 0 0 ${drawHeight} 0 ${Number((A4.height - drawHeight).toFixed(2))} cm /Im0 Do Q`);
  });

  it('can make one page the size of the image, however tall, instead of A4 pages', async () => {
    const pdf = new PdfEncoder(200, { pointsPerPixel: 0.5 });
    await pdf.addRows(gradient(200, 2000));
    const text = Buffer.from(await bytesOf(await pdf.finish())).toString('latin1');
    expect(text).toContain('/Count 1');
    expect(text).toContain('/MediaBox [0 0 100 1000]');
    expect(text).toContain('q 100 0 0 1000 0 0 cm /Im0 Do Q');
  });

  it('ends pages in the gap between lines of text instead of cutting a line in half, losing no rows', async () => {
    const width = 20;
    const pageRows = rowsPerA4Page(width);
    const height = 120;
    // Lines of "text" 9 rows tall with 3 blank rows between; a plain break at pageRows would land mid-line.
    const isBlank = (y: number) => y % 12 >= 9;
    expect(isBlank(pageRows)).toBe(false);
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    for (let y = 0; y < height; y++) {
      if (isBlank(y)) continue;
      for (let x = 0; x < width; x++) data.set([(x * 37 + y * 11) & 0xff, (y * 53) & 0xff, (x * y) & 0xff], (y * width + x) * 4);
    }
    const pdf = new PdfEncoder(width);
    await pdf.addRows({ width, height, data });
    const text = Buffer.from(await bytesOf(await pdf.finish())).toString('latin1');
    const heights = [...text.matchAll(/\/Height (\d+)/g)].map((m) => Number(m[1]));

    expect(heights.reduce((a, b) => a + b, 0)).toBe(height);
    let top = 0;
    for (const h of heights.slice(0, -1)) {
      expect(h).toBeLessThanOrEqual(pageRows);
      // The rows on both sides of every break are blank.
      expect([isBlank(top + h - 1), isBlank(top + h)]).toEqual([true, true]);
      top += h;
    }
  });

  it('refuses to write an empty document', async () => {
    await expect(new PdfEncoder(10).finish()).rejects.toThrow(/No rows/);
  });

  it('gives each A4 page as its own PNG for printing, holding every row once', async () => {
    const width = 20;
    const image = gradient(width, rowsPerA4Page(width) * 2 + 5);
    const encoder = new PdfEncoder(width);
    await encoder.addRows(image);
    const pages = await encoder.finishImages();
    expect(pages.length).toBe(3);

    let row = 0;
    for (const page of pages) {
      expect(page.type).toBe('image/png');
      const chunks = readPng(await bytesOf(page));
      const header = new DataView(chunks[0].data.buffer, chunks[0].data.byteOffset);
      expect(header.getUint32(0)).toBe(width);
      const height = header.getUint32(4);
      expect(height).toBeLessThanOrEqual(rowsPerA4Page(width));
      const idat = chunks.filter((c) => c.type === 'IDAT').map((c) => c.data);
      const raw = inflateSync(Buffer.concat(idat));
      expect(unfilterUp(raw, width, height)).toEqual(rgbOf(image, row, height));
      row += height;
    }
    expect(row).toBe(image.height);
  });
});

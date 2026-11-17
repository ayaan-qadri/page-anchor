import { ScanlineFilter, type RgbaRows } from './rows';
import { ZlibStream } from './zlib';

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const IDAT_CHUNK_BYTES = 1 << 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(...parts: Uint8Array[]): number {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) crc = CRC_TABLE[(crc ^ part[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  const typeBytes = new TextEncoder().encode(type);
  view.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(typeBytes, data));
  return out;
}

/** Builds an RGB PNG row by row, so an image of any height never needs one canvas that large; the height is whatever was added. */
export class PngEncoder {
  private readonly filter: ScanlineFilter;
  private readonly zlib = new ZlibStream();
  private rowsWritten = 0;

  constructor(readonly width: number) {
    this.filter = new ScanlineFilter(width);
  }

  /** Appends every row of `image`, which must be exactly `width` pixels wide. */
  async addRows(image: RgbaRows): Promise<void> {
    if (image.width !== this.width) throw new Error(`Row width ${image.width} does not match ${this.width}`);
    await this.zlib.write(this.filter.encode(image.data, 0, image.height));
    this.rowsWritten += image.height;
  }

  async finish(): Promise<Blob> {
    if (this.rowsWritten === 0) throw new Error('No rows were added');
    const compressed = new Uint8Array(await (await this.zlib.close()).arrayBuffer());

    const header = new Uint8Array(13);
    const view = new DataView(header.buffer);
    view.setUint32(0, this.width);
    view.setUint32(4, this.rowsWritten);
    header[8] = 8; // bit depth
    header[9] = 2; // truecolor RGB

    const parts: BlobPart[] = [SIGNATURE, chunk('IHDR', header)];
    for (let i = 0; i < compressed.length; i += IDAT_CHUNK_BYTES) {
      parts.push(chunk('IDAT', compressed.subarray(i, i + IDAT_CHUNK_BYTES)));
    }
    parts.push(chunk('IEND', new Uint8Array(0)));
    return new Blob(parts, { type: 'image/png' });
  }

  async abort(): Promise<void> {
    await this.zlib.abort();
  }
}

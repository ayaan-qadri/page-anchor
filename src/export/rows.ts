/** The parts of ImageData the encoders read. */
export type RgbaRows = Pick<ImageData, 'width' | 'height' | 'data'>;

/** PNG "Up" filter: screenshots repeat a lot vertically, so this compresses far better than unfiltered rows. */
const FILTER_UP = 2;

/** One instance per image: both PNG and PDF (/Predictor 15) filter the first row against an all-zero row. */
export class ScanlineFilter {
  private previous: Uint8Array;

  constructor(readonly width: number) {
    this.previous = new Uint8Array(width * 3);
  }

  get bytesPerRow(): number {
    return 1 + this.width * 3;
  }

  /** Encodes `rowCount` rows of `rgba` (row stride `width * 4`) starting at `startRow`. */
  encode(rgba: Uint8ClampedArray, startRow: number, rowCount: number): Uint8Array {
    return this.encodeRgbRows(Array.from({ length: rowCount }, (_, r) => rgbRow(rgba, startRow + r, this.width)));
  }

  encodeRgbRows(rows: readonly Uint8Array[]): Uint8Array {
    const out = new Uint8Array(rows.length * this.bytesPerRow);
    let prev = this.previous;
    let o = 0;
    for (const row of rows) {
      out[o++] = FILTER_UP;
      for (let c = 0; c < row.length; c++) out[o++] = (row[c] - prev[c]) & 0xff;
      prev = row;
    }
    this.previous = prev;
    return out;
  }
}

export function rgbRow(rgba: Uint8ClampedArray, row: number, width: number): Uint8Array {
  const out = new Uint8Array(width * 3);
  for (let x = 0, s = row * width * 4, c = 0; x < width; x++, s += 4) {
    out[c++] = rgba[s];
    out[c++] = rgba[s + 1];
    out[c++] = rgba[s + 2];
  }
  return out;
}

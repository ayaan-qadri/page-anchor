import { ScanlineFilter, rgbRow, type RgbaRows } from './rows';
import { ZlibStream } from './zlib';

/** A4 portrait in PDF points. */
export const A4 = { width: 595.28, height: 841.89 } as const;

const encoder = new TextEncoder();

function num(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Image rows that fill one A4 page when the image is scaled to the page width. */
export function rowsPerA4Page(width: number): number {
  return Math.max(1, Math.floor((width * A4.height) / A4.width));
}

interface PageImage {
  height: number;
  data: Blob;
}

/** How far up from a full page to look for a gap between lines to break at. */
const BREAK_SEARCH_SHARE = 0.2;

/** Caps the rows held back for that search on very wide pages. */
const BREAK_SEARCH_PIXELS = 4_000_000;

/** A row boundary where at most this share of pixels changes is a gap, not the middle of a line of text. */
const QUIET_SHARE = 0.01;

/** Pixels whose channels differ by no more than this count as unchanged, so anti-aliasing noise does not hide a gap. */
const PIXEL_TOLERANCE = 8;

function changedPixels(a: Uint8Array, b: Uint8Array): number {
  let changed = 0;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i] - b[i]) > PIXEL_TOLERANCE || Math.abs(a[i + 1] - b[i + 1]) > PIXEL_TOLERANCE || Math.abs(a[i + 2] - b[i + 2]) > PIXEL_TOLERANCE) changed++;
  }
  return changed;
}

/** One page exactly the image's size instead of A4 pages, at `pointsPerPixel` PDF points per image pixel. */
export interface ImageSizedPage {
  pointsPerPixel: number;
}

/** Each A4 page is a lossless slice of one tall image, reusing the PNG row predictor so no image codec is needed. */
export class PdfEncoder {
  private readonly pageRows: number;
  private readonly searchRows: number;
  private readonly pages: PageImage[] = [];
  private current: { zlib: ZlibStream; filter: ScanlineFilter; rows: number } | null = null;
  /** The newest rows of the current page, kept uncompressed so the page can end at a gap between lines. */
  private held: Uint8Array[] = [];

  constructor(
    readonly width: number,
    private readonly imageSized?: ImageSizedPage
  ) {
    this.pageRows = imageSized ? Infinity : rowsPerA4Page(width);
    this.searchRows = Math.max(1, Math.min(Math.floor(this.pageRows * BREAK_SEARCH_SHARE), Math.floor(BREAK_SEARCH_PIXELS / width)));
  }

  async addRows(image: RgbaRows): Promise<void> {
    if (image.width !== this.width) throw new Error(`Row width ${image.width} does not match ${this.width}`);
    for (let r = 0; r < image.height; r++) {
      this.held.push(rgbRow(image.data, r, this.width));
      if ((this.current?.rows ?? 0) + this.held.length >= this.pageRows) {
        await this.breakPage();
      } else if (this.held.length >= this.searchRows * 2) {
        await this.compress(this.held.splice(0, this.held.length - this.searchRows));
      }
    }
  }

  /** Rows of `held` that stay on this page: up to the quietest boundary near the bottom, or all of them when every boundary cuts through content. */
  private quietCut(): number {
    const { held } = this;
    let best = held.length;
    let fewest = Infinity;
    for (let c = held.length - 1; c >= 1; c--) {
      const changed = changedPixels(held[c - 1], held[c]);
      if (changed < fewest) {
        best = c;
        fewest = changed;
        if (changed === 0) break;
      }
    }
    return fewest <= this.width * QUIET_SHARE ? best : held.length;
  }

  private async breakPage(): Promise<void> {
    const keep = this.quietCut();
    await this.compress(this.held.slice(0, keep));
    this.held = this.held.slice(keep);
    await this.closePage();
  }

  private async compress(rows: Uint8Array[]): Promise<void> {
    if (rows.length === 0) return;
    if (!this.current) this.current = { zlib: new ZlibStream(), filter: new ScanlineFilter(this.width), rows: 0 };
    await this.current.zlib.write(this.current.filter.encodeRgbRows(rows));
    this.current.rows += rows.length;
  }

  private async closePage(): Promise<void> {
    const page = this.current;
    if (!page) return;
    this.current = null;
    this.pages.push({ height: page.rows, data: await page.zlib.close() });
  }

  async finish(): Promise<Blob> {
    await this.compress(this.held);
    this.held = [];
    await this.closePage();
    if (this.pages.length === 0) throw new Error('No rows were added');

    const parts: BlobPart[] = [];
    const offsets: number[] = [];
    let size = 0;
    const push = (part: string | Blob) => {
      const bytes = typeof part === 'string' ? encoder.encode(part) : part;
      parts.push(bytes);
      size += bytes instanceof Blob ? bytes.size : bytes.length;
    };
    const object = (id: number, body: string | (string | Blob)[]) => {
      offsets[id] = size;
      push(`${id} 0 obj\n`);
      if (typeof body === 'string') push(body);
      else body.forEach(push);
      push('\nendobj\n');
    };

    // The binary comment line marks the file as binary for transfer tools.
    push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
    object(1, '<< /Type /Catalog /Pages 2 0 R >>');

    const kids: string[] = [];
    let id = 3;
    for (const page of this.pages) {
      const imageId = id++;
      const contentId = id++;
      const pageId = id++;
      kids.push(`${pageId} 0 R`);

      const params = `<< /Predictor 15 /Colors 3 /BitsPerComponent 8 /Columns ${this.width} >>`;
      object(imageId, [
        `<< /Type /XObject /Subtype /Image /Width ${this.width} /Height ${page.height} /ColorSpace /DeviceRGB ` +
          `/BitsPerComponent 8 /Filter /FlateDecode /DecodeParms ${params} /Length ${page.data.size} >>\nstream\n`,
        page.data,
        '\nendstream',
      ]);

      const pageW = this.imageSized ? this.width * this.imageSized.pointsPerPixel : A4.width;
      const drawHeight = (pageW * page.height) / this.width;
      const pageH = this.imageSized ? drawHeight : A4.height;
      const content = `q ${num(pageW)} 0 0 ${num(drawHeight)} 0 ${num(pageH - drawHeight)} cm /Im0 Do Q`;
      object(contentId, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      object(
        pageId,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] ` +
          `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`
      );
    }
    object(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);

    const xrefOffset = size;
    const count = id;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
    push(xref);
    push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    return new Blob(parts, { type: 'application/pdf' });
  }

  async abort(): Promise<void> {
    this.held = [];
    const page = this.current;
    this.current = null;
    await page?.zlib.abort();
  }
}

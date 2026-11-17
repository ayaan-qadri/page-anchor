type CloneInto = <T>(value: T, scope: object) => T;

/** Firefox content scripts live in their own compartment, and the page-owned stream rejects their byte arrays unless they are cloned into the page first. */
const toPage: (chunk: Uint8Array) => Uint8Array = (() => {
  const cloneInto = (globalThis as { cloneInto?: CloneInto }).cloneInto;
  return typeof cloneInto === 'function' && typeof window !== 'undefined' ? (chunk) => cloneInto(chunk, window) : (chunk) => chunk;
})();

/** Streams bytes through the browser's native zlib compressor, which is the format both PNG IDAT and PDF FlateDecode expect. */
export class ZlibStream {
  private readonly writer: WritableStreamDefaultWriter<BufferSource>;
  private readonly output: Promise<Blob>;

  constructor() {
    const stream = new CompressionStream('deflate');
    this.writer = stream.writable.getWriter();
    // Drained from the start so writes never stall on backpressure.
    this.output = new Response(stream.readable).blob();
  }

  async write(chunk: Uint8Array): Promise<void> {
    await this.writer.write(toPage(chunk) as Uint8Array<ArrayBuffer>);
  }

  async close(): Promise<Blob> {
    await this.writer.close();
    return this.output;
  }

  async abort(): Promise<void> {
    await this.writer.abort().catch(() => {});
    await this.output.catch(() => {});
  }
}

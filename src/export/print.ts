import { getExtensionApi } from '../core/inject';
import { ExportError } from './capture';

export const PRINT_PAGE_PATH = '/print.html';

export const PRINT_READY = 'page-anchor:print-ready';
export const PRINT_REQUEST = 'page-anchor:print';
export const PRINT_STARTED = 'page-anchor:print-started';
export const PRINT_DONE = 'page-anchor:print-done';
export const PRINT_FAILED = 'page-anchor:print-failed';

export interface PrintRequest {
  type: typeof PRINT_REQUEST;
  images: Blob[];
  /** Prints at this CSS width (an area at its on-screen size); without it each image fills the sheet. */
  width?: number;
  /** The printed page's title, which names the file when printing to PDF. */
  title: string;
}

export function isPrintRequest(data: unknown): data is PrintRequest {
  const request = data as Partial<PrintRequest> | null;
  return request?.type === PRINT_REQUEST && typeof request.title === 'string' && Array.isArray(request.images) && request.images.every((image) => image instanceof Blob);
}

const READY_TIMEOUT_MS = 10_000;

const FRAME_STYLES = 'position:fixed;width:0;height:0;border:0;visibility:hidden;pointer-events:none';

/** Prints from a hidden extension frame, so the page's own print styles and content rules never touch the images. Resolves once the print dialog opens. */
export function printImages(container: HTMLElement, images: Blob[], width?: number): Promise<void> {
  const title = document.title || window.location.hostname;
  const ext = getExtensionApi();
  if (!ext) return Promise.reject(new ExportError('print-failed', 'Extension context is gone'));
  const url = ext.runtime.getURL(PRINT_PAGE_PATH);
  // A dialog that never reported closing leaves its frame behind; only one is ever kept.
  container.querySelector(`iframe[src="${url}"]`)?.remove();
  const frame = document.createElement('iframe');
  frame.setAttribute('style', FRAME_STYLES);
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.src = url;

  return new Promise<void>((resolve, reject) => {
    const listeners = new AbortController();
    const finish = () => {
      listeners.abort();
      frame.remove();
    };
    const fail = (detail: string) => {
      clearTimeout(timer);
      finish();
      reject(new ExportError('print-failed', detail));
    };
    const timer = setTimeout(() => fail('Print page did not load'), READY_TIMEOUT_MS);

    window.addEventListener(
      'message',
      (event: MessageEvent) => {
        if (event.source !== frame.contentWindow) return;
        const type = (event.data as { type?: unknown } | null)?.type;
        if (type === PRINT_READY) {
          clearTimeout(timer);
          const request: PrintRequest = { type: PRINT_REQUEST, images, width, title };
          // The frame's own origin, which is the extension's fixed one even when it was loaded from a per-session address.
          frame.contentWindow?.postMessage(request, event.origin);
        } else if (type === PRINT_STARTED) {
          resolve();
        } else if (type === PRINT_DONE) {
          finish();
        } else if (type === PRINT_FAILED) {
          fail('Images did not load');
        }
      },
      { signal: listeners.signal }
    );
    container.appendChild(frame);
  });
}

/** Sent by the page app to ask the background for a screenshot of its tab; only extension pages can call captureVisibleTab. */
export const CAPTURE_VIEWPORT_MESSAGE = 'PAGE_ANCHOR_CAPTURE_VIEWPORT';

/** Firefox only: a document area in CSS pixels and its output density; other browsers ignore it and shoot the visible area. */
export interface CaptureViewportRequest {
  type: typeof CAPTURE_VIEWPORT_MESSAGE;
  region?: { rect: { x: number; y: number; width: number; height: number }; scale: number };
}

export type CaptureViewportResponse = { dataUrl: string } | { error: 'tab-inactive' | 'blocked' | 'capture-failed'; detail?: string };

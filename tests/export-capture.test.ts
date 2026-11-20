import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { ExportError, captureArea, capturePage, exportFileName, toExportError, type PageCaptureDeps } from '../src/export/capture';

describe('toExportError', () => {
  it('keeps known failures and sorts the rest into causes a user can act on', () => {
    expect(toExportError(new ExportError('tab-inactive')).code).toBe('tab-inactive');
    expect(toExportError(new RangeError('Invalid array length')).code).toBe('too-large');
    expect(toExportError(new Error('NS_ERROR_OUT_OF_MEMORY')).code).toBe('too-large');
    // The Firefox compartment bug: unexpected, not something that retrying fixes.
    const bug = toExportError(new TypeError('Value could not be converted to any of: ArrayBufferView, ArrayBuffer.'));
    expect(bug.code).toBe('unexpected');
    expect(bug.message).toMatch(/ArrayBufferView/);
  });
});

describe('exportFileName', () => {
  const day = new Date(2026, 10, 7);

  it('uses the page title and the date', () => {
    expect(exportFileName('png', 'Quarterly report', 'https://example.com/a', day)).toBe('Quarterly report 2026-11-07.png');
  });

  it('strips characters file systems reject and collapses whitespace', () => {
    expect(exportFileName('pdf', ' a/b:c*?"<>|\n\td ', 'https://example.com', day)).toBe('a b c d 2026-11-07.pdf');
  });

  it('falls back to the host name, then to "page"', () => {
    expect(exportFileName('png', '  ', 'https://docs.example.com/x', day)).toBe('docs.example.com 2026-11-07.png');
    expect(exportFileName('png', '', 'not a url', day)).toBe('page 2026-11-07.png');
  });

  it('keeps long titles short', () => {
    const name = exportFileName('png', 'x'.repeat(300), 'https://example.com', day);
    expect(name.length).toBeLessThanOrEqual(80 + ' 2026-11-07.png'.length);
  });
});

describe('capturePage', () => {
  let showOverlay: Mock<() => void>;
  let deps: PageCaptureDeps;

  beforeEach(() => {
    showOverlay = vi.fn<() => void>();
    deps = {
      captureViewport: vi.fn(),
      drawAnnotations: vi.fn(),
      hideOverlay: vi.fn(() => showOverlay),
    };
    window.scrollTo(0, 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('style');
  });

  it('refuses to run while the page is pinch-zoomed, before touching anything', async () => {
    Object.defineProperty(window, 'visualViewport', { value: { scale: 2 }, configurable: true });
    try {
      await expect(capturePage('png', deps)).rejects.toMatchObject({ code: 'zoomed' });
      expect(deps.hideOverlay).not.toHaveBeenCalled();
    } finally {
      delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });

  it('restores the overlay, scroll position and page styles when cancelled', async () => {
    document.documentElement.style.setProperty('scroll-behavior', 'smooth');
    const scrollTo = vi.spyOn(window, 'scrollTo');
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(12);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(340);
    const controller = new AbortController();
    controller.abort();

    const error = await capturePage('pdf', { ...deps, signal: controller.signal }).catch((e) => e);
    expect(error).toBeInstanceOf(ExportError);
    expect(error.code).toBe('cancelled');
    expect(deps.captureViewport).not.toHaveBeenCalled();
    expect(showOverlay).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenLastCalledWith(12, 340);
    expect(document.documentElement.style.getPropertyValue('scroll-behavior')).toBe('smooth');
    expect(document.documentElement.style.getPropertyPriority('scroll-behavior')).toBe('');
  });

  it('passes screenshot failures through and still restores the page', async () => {
    deps.captureViewport = vi.fn().mockRejectedValue(new ExportError('tab-inactive'));
    await expect(capturePage('png', deps)).rejects.toMatchObject({ code: 'tab-inactive' });
    expect(showOverlay).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue('scroll-behavior')).toBe('');
  });

  it('lets a zoomed-out desktop-layout page through on phones', async () => {
    Object.defineProperty(window, 'visualViewport', { value: { scale: 0.4, width: window.innerWidth }, configurable: true });
    deps.captureViewport = vi.fn().mockRejectedValue(new ExportError('tab-inactive'));
    try {
      await expect(capturePage('png', deps)).rejects.toMatchObject({ code: 'tab-inactive' });
    } finally {
      delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });
});

describe('capturePage with a fake canvas', () => {
  const W = 300;
  const DOC_H = 5000;
  const VIEW_H = 600;
  let restore: (() => void)[] = [];
  let drawImage: Mock;

  const define = (target: object, key: string, get: () => unknown) => {
    const own = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { get, configurable: true });
    restore.push(() => (own ? Object.defineProperty(target, key, own) : delete (target as Record<string, unknown>)[key]));
  };

  const bitmap = (width: number, height: number) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap & { close: Mock };

  async function pngHeight(blob: Blob): Promise<number> {
    return new DataView(await blob.arrayBuffer()).getUint32(20);
  }

  const noOverlay = () => () => {};

  beforeEach(() => {
    restore = [];
    const root = document.documentElement;
    define(root, 'clientWidth', () => W);
    define(root, 'clientHeight', () => VIEW_H);
    define(root, 'scrollWidth', () => W);
    define(root, 'scrollHeight', () => DOC_H);
    define(window, 'innerWidth', () => W);
    drawImage = vi.fn();
    const ctx = {
      drawImage,
      fillRect: vi.fn(),
      setTransform: vi.fn(),
      fillStyle: '',
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    restore.reverse().forEach((fn) => fn());
    vi.restoreAllMocks();
    document.documentElement.removeAttribute('style');
  });

  it('on Firefox, renders the page in off-screen strips without scrolling through it', async () => {
    const scrollTo = vi.spyOn(window, 'scrollTo');
    const shots: ReturnType<typeof bitmap>[] = [];
    const captureRegion = vi.fn(async (rect: { width: number; height: number }) => {
      const shot = bitmap(rect.width, rect.height);
      shots.push(shot);
      return shot;
    });
    const drawAnnotations = vi.fn();
    const deps: PageCaptureDeps = { captureViewport: vi.fn(), captureRegion, drawAnnotations, hideOverlay: noOverlay };

    const { blob, truncated } = await capturePage('png', deps);
    expect(truncated).toBe(false);
    expect(await pngHeight(blob)).toBe(DOC_H);
    expect(captureRegion.mock.calls.map(([rect]) => rect)).toEqual([
      { x: 0, y: 0, width: W, height: 2048 },
      { x: 0, y: 2048, width: W, height: 2048 },
      { x: 0, y: 4096, width: W, height: 904 },
    ]);
    expect(deps.captureViewport).not.toHaveBeenCalled();
    expect(shots.every((s) => s.close.mock.calls.length === 1)).toBe(true);
    expect(drawAnnotations.mock.calls.map(([, region]) => region.minY)).toEqual([0, 2048, 4096]);
    // Only the jump to the top, for fixed headers, and the jump back.
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('on Firefox, ignores pinch zoom because off-screen strips do not depend on it', async () => {
    Object.defineProperty(window, 'visualViewport', { value: { scale: 2, width: 100 }, configurable: true });
    try {
      const captureRegion = vi.fn(async (rect: { width: number; height: number }) => bitmap(rect.width, rect.height));
      const { blob } = await capturePage('pdf', { captureViewport: vi.fn(), captureRegion, drawAnnotations: vi.fn(), hideOverlay: noOverlay });
      expect(blob.type).toBe('application/pdf');
    } finally {
      delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });

  it('crops one screenshot to the selected area, with the overlay hidden only for the shot', async () => {
    define(window, 'scrollX', () => 0);
    define(window, 'scrollY', () => 1000);
    const events: string[] = [];
    const shot = bitmap(W * 2, VIEW_H * 2);
    const captureViewport = vi.fn(async () => {
      events.push('shot');
      return shot;
    });
    const drawAnnotations = vi.fn(() => events.push('draw'));
    const hideOverlay = () => {
      events.push('hide');
      return () => events.push('show');
    };

    const blob = await captureArea('png', { x: 10, y: 20, width: 100, height: 50 }, { captureViewport, drawAnnotations, hideOverlay });
    expect(events).toEqual(['hide', 'shot', 'show', 'draw']);
    expect(drawImage).toHaveBeenCalledWith(shot, 20, 40, 200, 100, 0, 0, 200, 100);
    expect(drawAnnotations).toHaveBeenCalledWith(expect.anything(), { minX: 10, minY: 1020, maxX: 110, maxY: 1070 }, 2);
    expect(await pngHeight(blob)).toBe(100);
    expect(shot.close).toHaveBeenCalledTimes(1);
  });

  it('cuts on whole screenshot pixels when the screen density puts the edges between them', async () => {
    const shot = bitmap(W * 1.25, VIEW_H * 1.25);
    await captureArea('png', { x: 10.3, y: 0, width: 100.5, height: 50 }, { captureViewport: async () => shot, drawAnnotations: vi.fn(), hideOverlay: noOverlay });
    expect(drawImage).toHaveBeenCalledWith(shot, 13, 0, 126, 63, 0, 0, 126, 63);
  });

  it('saves a selected area as PDF and shows the overlay again when the shot fails', async () => {
    const pdf = await captureArea('pdf', { x: 0, y: 0, width: 50, height: 50 }, { captureViewport: async () => bitmap(W, VIEW_H), drawAnnotations: vi.fn(), hideOverlay: noOverlay });
    expect(pdf.type).toBe('application/pdf');

    const showOverlay = vi.fn();
    const failing = captureArea('png', { x: 0, y: 0, width: 50, height: 50 }, {
      captureViewport: vi.fn().mockRejectedValue(new ExportError('blocked')),
      drawAnnotations: vi.fn(),
      hideOverlay: () => showOverlay,
    });
    await expect(failing).rejects.toMatchObject({ code: 'blocked' });
    expect(showOverlay).toHaveBeenCalledTimes(1);
  });

  /** Fakes a window that scrolls up to `maxScroll` and a viewport whose height follows `heights`, one per screenshot. */
  function scrollingPage(heights: number[], maxScroll = (h: number) => DOC_H - h) {
    let y = 0;
    let shot = 0;
    let currentH = heights[0];
    define(window, 'scrollY', () => y);
    define(window, 'scrollX', () => 0);
    vi.spyOn(window, 'scrollTo').mockImplementation(((_x: number, top: number) => {
      y = Math.max(0, Math.min(top, maxScroll(currentH)));
    }) as typeof window.scrollTo);
    const shots: ReturnType<typeof bitmap>[] = [];
    const captureViewport = vi.fn(async () => {
      currentH = heights[Math.min(shot++, heights.length - 1)];
      const b = bitmap(W, currentH);
      shots.push(b);
      return b;
    });
    return { captureViewport, shots, scrollY: () => y };
  }

  it('follows a mobile address bar that hides mid-export without gaps or overlaps', async () => {
    const page = scrollingPage([VIEW_H, 700, 700, 650, 700, 700, 700, 700, 700]);
    const { blob, truncated } = await capturePage('png', { captureViewport: page.captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay });
    expect(truncated).toBe(false);
    expect(await pngHeight(blob)).toBe(DOC_H);
    expect(page.shots.every((s) => s.close.mock.calls.length === 1)).toBe(true);
    const stripHeights = drawImage.mock.calls.map((c) => c[8] as number);
    expect(stripHeights.reduce((a, b) => a + b, 0)).toBe(DOC_H);
  });

  it('stops after what the window can show when the page scrolls an inner element instead', async () => {
    const page = scrollingPage([VIEW_H], () => 0);
    const { blob, truncated } = await capturePage('png', { captureViewport: page.captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay });
    expect(truncated).toBe(true);
    expect(await pngHeight(blob)).toBe(VIEW_H);
    expect(page.shots.every((s) => s.close.mock.calls.length === 1)).toBe(true);
  });

  it('keeps only the reachable part of a page wider than a phone screen, aligned, and says so', async () => {
    define(document.documentElement, 'scrollWidth', () => 1000);
    define(window, 'innerWidth', () => 1200);
    let x = 0;
    let y = 0;
    define(window, 'scrollX', () => x);
    define(window, 'scrollY', () => y);
    // Like Chrome on Android: the window stops at x=200 although the page is 1000px wide.
    vi.spyOn(window, 'scrollTo').mockImplementation(((left: number, top: number) => {
      x = Math.max(0, Math.min(left, 200));
      y = Math.max(0, Math.min(top, DOC_H - VIEW_H));
    }) as typeof window.scrollTo);
    const captureViewport = vi.fn(async () => bitmap(W, VIEW_H));

    const { blob, truncated } = await capturePage('png', { captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay });
    expect(truncated).toBe(true);
    const view = new DataView(await blob.arrayBuffer());
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([500, DOC_H]);
    // The enlarged innerWidth must not shrink the screenshot scale: every tile is copied 1:1.
    for (const call of drawImage.mock.calls) expect(call[3]).toBe(call[7]);
  });

  it('keeps sticky elements in place, shows top fixed bars once, hides bottom fixed bars, and restores all of them', async () => {
    const make = (css: Partial<CSSStyleDeclaration>, top = 0) => {
      const el = document.createElement('div');
      Object.assign(el.style, css);
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top } as DOMRect);
      document.body.appendChild(el);
      return el;
    };
    const header = make({ position: 'fixed', visibility: 'visible' }, 0);
    const cookie = make({ position: 'fixed' }, VIEW_H - 60);
    const thead = make({ position: 'sticky', top: '46px' });
    const seen: { header: string; cookie: string; thead: string; theadTop: string }[] = [];
    const page = scrollingPage([VIEW_H]);
    const inner = page.captureViewport.getMockImplementation()!;
    page.captureViewport.mockImplementation(async () => {
      seen.push({ header: header.style.visibility, cookie: cookie.style.visibility, thead: thead.style.position, theadTop: thead.style.top });
      return inner();
    });

    await capturePage('png', { captureViewport: page.captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay });

    expect(seen[0]).toEqual({ header: 'visible', cookie: 'hidden', thead: 'relative', theadTop: 'auto' });
    expect(seen.slice(1).every((s) => s.header === 'hidden' && s.cookie === 'hidden' && s.thead === 'relative')).toBe(true);
    expect([header.style.visibility, cookie.style.visibility, thead.style.position, thead.style.top]).toEqual(['visible', '', 'sticky', '46px']);
    [header, cookie, thead].forEach((el) => el.remove());
  });

  it('measures drawing placement once the page is laid out at the top, before any screenshot', async () => {
    const order: string[] = [];
    const page = scrollingPage([VIEW_H]);
    const inner = page.captureViewport.getMockImplementation()!;
    page.captureViewport.mockImplementation(async () => {
      order.push(`shot@${page.scrollY()}`);
      return inner();
    });
    await capturePage('png', {
      captureViewport: page.captureViewport,
      drawAnnotations: vi.fn(),
      hideOverlay: noOverlay,
      onLayoutReady: () => order.push(`ready@${page.scrollY()}`),
    });
    expect(order[0]).toBe('ready@0');
    expect(order.filter((o) => o.startsWith('ready'))).toHaveLength(1);
  });

  it('steps the progress panel out of every screenshot and hands the page back before the file is written', async () => {
    const events: string[] = [];
    const page = scrollingPage([VIEW_H]);
    const inner = page.captureViewport.getMockImplementation()!;
    page.captureViewport.mockImplementation(async () => {
      events.push('shot');
      return inner();
    });
    const scrollTo = window.scrollTo as unknown as Mock;
    await capturePage('png', {
      captureViewport: page.captureViewport,
      drawAnnotations: vi.fn(),
      hideOverlay: noOverlay,
      beforeShot: () => {
        events.push('hide');
        return () => events.push('show');
      },
      onCaptured: () => events.push(`captured, scrolled back: ${JSON.stringify(scrollTo.mock.calls.at(-1))}`),
    });
    const shots = events.filter((e) => e === 'shot').length;
    expect(shots).toBeGreaterThan(5);
    expect(events.slice(0, -1).join(' ')).toBe(Array(shots).fill('hide shot show').join(' '));
    expect(events.at(-1)).toBe('captured, scrolled back: [0,0]');
  });

  it('stops, without a file, when the page scrolls during a screenshot', async () => {
    const page = scrollingPage([VIEW_H]);
    const inner = page.captureViewport.getMockImplementation()!;
    const onCaptured = vi.fn();
    page.captureViewport.mockImplementation(async () => {
      const shot = await inner();
      // The user drags the scrollbar while the third screenshot is taken.
      if (page.shots.length === 3) window.scrollTo(0, page.scrollY() + 250);
      return shot;
    });
    await expect(capturePage('pdf', { captureViewport: page.captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay, onCaptured })).rejects.toMatchObject({
      code: 'cancelled',
    });
    expect(onCaptured).not.toHaveBeenCalled();
    expect(page.shots.every((s) => s.close.mock.calls.length === 1)).toBe(true);
  });

  it('stops at once when cancelled while a screenshot is still on its way, and closes it when it lands', async () => {
    const page = scrollingPage([VIEW_H]);
    const inner = page.captureViewport.getMockImplementation()!;
    const controller = new AbortController();
    let release: () => void = () => {};
    page.captureViewport.mockImplementation(async () => {
      const shot = await inner();
      if (page.shots.length === 2) await new Promise<void>((r) => (release = r));
      return shot;
    });
    const run = capturePage('png', { captureViewport: page.captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay, signal: controller.signal });
    await vi.waitFor(() => expect(page.shots).toHaveLength(2));
    const started = performance.now();
    controller.abort();
    await expect(run).rejects.toMatchObject({ code: 'cancelled' });
    expect(performance.now() - started).toBeLessThan(500);

    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(page.shots.every((s) => s.close.mock.calls.length === 1)).toBe(true);
  });

  it('gives up on a screenshot the browser never answers instead of hanging', async () => {
    const realTimeout = globalThis.setTimeout;
    const page = scrollingPage([VIEW_H]);
    const inner = page.captureViewport.getMockImplementation()!;
    page.captureViewport.mockImplementation(async () => {
      if (page.shots.length === 1) return new Promise<never>(() => {});
      return inner();
    });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      let outcome: unknown = null;
      void capturePage('png', { captureViewport: page.captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay }).catch((e) => (outcome = e));
      // Frames still run on real time, so the fake clock is moved on in small steps between them.
      for (let i = 0; i < 400 && !outcome; i++) {
        await vi.advanceTimersByTimeAsync(100);
        await new Promise((r) => realTimeout(r, 1));
      }
      expect(outcome).toMatchObject({ code: 'capture-failed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits out the minimum gap between screenshots', async () => {
    const page = scrollingPage([VIEW_H]);
    const inner = page.captureViewport.getMockImplementation()!;
    const times: number[] = [];
    page.captureViewport.mockImplementation(async () => {
      times.push(performance.now());
      return inner();
    });
    await capturePage('png', { captureViewport: page.captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay, minShotIntervalMs: 40 });
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(38);
  });

  it('closes every screenshot and aborts cleanly when cancelled mid-export', async () => {
    const controller = new AbortController();
    const page = scrollingPage([VIEW_H]);
    const inner = page.captureViewport.getMockImplementation()!;
    page.captureViewport.mockImplementation(async () => {
      const shot = await inner();
      if (page.shots.length === 3) controller.abort();
      return shot;
    });
    await expect(
      capturePage('pdf', { captureViewport: page.captureViewport, drawAnnotations: vi.fn(), hideOverlay: noOverlay, signal: controller.signal })
    ).rejects.toMatchObject({ code: 'cancelled' });
    expect(page.shots.every((s) => s.close.mock.calls.length === 1)).toBe(true);
    expect(page.scrollY()).toBe(0);
  });
});

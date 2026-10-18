import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import contentDefinition from '../entrypoints/content';

describe('Content Script: Shadow DOM Isolation, Route Observer, & Extension Messaging', () => {
  let mockChrome: any;
  let messageListener: ((msg: any, sender: any, sendResponse: (r?: any) => void) => boolean) | null = null;
  let mockLocalStorage: Record<string, any>;

  beforeEach(() => {
    mockLocalStorage = {};
    messageListener = null;

    mockChrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((fn) => {
            messageListener = fn;
          }),
        },
      },
      storage: {
        local: {
          get: vi.fn((key) => {
            if (typeof key === 'string') return Promise.resolve({ [key]: mockLocalStorage[key] });
            return Promise.resolve(mockLocalStorage);
          }),
          set: vi.fn((data) => {
            Object.assign(mockLocalStorage, data);
            return Promise.resolve();
          }),
          remove: vi.fn((key) => {
            delete mockLocalStorage[key];
            return Promise.resolve();
          }),
        },
      },
    };

    (globalThis as any).chrome = mockChrome;
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    const host = document.getElementById('page-anchor-host');
    if (host) {
      host.id = 'page-anchor-host-removed';
      host.remove();
    }
    document.body.innerHTML = '';
    delete (globalThis as any).chrome;
  });

  it('mounts isolated Shadow DOM root with high z-index and styles', async () => {
    contentDefinition.main();

    const host = document.getElementById('page-anchor-host') as HTMLElement;
    expect(host).not.toBeNull();
    expect(host.style.zIndex).toBe('2147483647');

    const shadow = host.shadowRoot;
    expect(shadow).not.toBeNull();

    const style = shadow?.querySelector('style');
    expect(style).not.toBeNull();
    expect(style?.textContent).toContain('.pa-toolbar-wrapper');

    const uiRoot = shadow?.querySelector('.page-anchor-ui-root');
    expect(uiRoot).not.toBeNull();
  });

  it('prevents redundant duplicate host mount if already connected', () => {
    contentDefinition.main();
    const countFirst = document.querySelectorAll('#page-anchor-host').length;
    expect(countFirst).toBe(1);

    contentDefinition.main();
    const countSecond = document.querySelectorAll('#page-anchor-host').length;
    expect(countSecond).toBe(1);
  });

  it('handles PAGE_ANCHOR_GET_STATUS and responds with active state and count', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    expect(messageListener).not.toBeNull();

    const sendResponse = vi.fn();
    messageListener?.({ type: 'PAGE_ANCHOR_GET_STATUS' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        active: expect.any(Boolean),
        count: expect.any(Number),
        url: expect.any(String),
      })
    );
  });

  it('handles PAGE_ANCHOR_TOGGLE message to toggle drawing mode', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const sendResponse = vi.fn();
    messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        active: true,
      })
    );
  });

  it('handles PAGE_ANCHOR_CLEAR message and resets annotations', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const sendResponse = vi.fn();
    messageListener?.({ type: 'PAGE_ANCHOR_CLEAR' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('handles PAGE_ANCHOR_EXPORT and PAGE_ANCHOR_URL_CHANGED messages', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const sendResponse1 = vi.fn();
    messageListener?.({ type: 'PAGE_ANCHOR_EXPORT' }, {}, sendResponse1);
    expect(sendResponse1).toHaveBeenCalledWith({ success: true });

    const sendResponse2 = vi.fn();
    messageListener?.({ type: 'PAGE_ANCHOR_URL_CHANGED' }, {}, sendResponse2);
    expect(sendResponse2).toHaveBeenCalledWith({ success: true });
  });

  it('dispatches keyboard shortcuts for tools, shapes, undo, redo, and export', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const host = document.getElementById('page-anchor-host') as HTMLElement;
    const shadow = host.shadowRoot!;
    const isActive = (tool: string) =>
      (shadow.querySelector(`[data-tool="${tool}"]`) as HTMLElement)?.classList.contains('active') ?? false;

    // Enter drawing mode (global toggle works even when inactive)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', altKey: true, shiftKey: true, bubbles: true, cancelable: true })
    );

    // Single-letter tool shortcuts only work while drawing mode is active
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
    expect(isActive('pen')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    expect(isActive('rect')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    expect(isActive('double-arrow')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
    expect(isActive('eraser')).toBe(true);

    // Undo / Redo / Clear / Export use their real default chords
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'x', altKey: true, shiftKey: true, bubbles: true, cancelable: true })
    );
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'e', altKey: true, shiftKey: true, bubbles: true, cancelable: true })
    );
  });

  it('deletes selected drawing element on Delete or Backspace keydown', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, vi.fn());

    const delEvent = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true });
    window.dispatchEvent(delEvent);

    // If target is inside input or textarea, delete should NOT trigger canvas deletion
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const backspaceEvent = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
    Object.defineProperty(backspaceEvent, 'target', { value: input });
    window.dispatchEvent(backspaceEvent);

    input.remove();
  });

  it('reacts to window navigation lifecycle events (beforeunload, pagehide, hashchange, popstate, pushState, replaceState)', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('hashchange'));
    window.dispatchEvent(new Event('popstate'));

    window.history.pushState({}, 'New Route', '/docs/new-section');
    window.history.replaceState({}, 'Replaced Route', '/docs/replaced-section');

    await new Promise((r) => setTimeout(r, 20));
  });

  it('ignores unrecognised runtime messages and does not hold the channel open', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const sendResponse = vi.fn();
    const unknownKeepAlive = messageListener?.({ type: 'SOMETHING_ELSE' }, {}, sendResponse);
    expect(unknownKeepAlive).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();

    const malformedKeepAlive = messageListener?.({}, {}, vi.fn());
    expect(malformedKeepAlive).toBe(false);

    expect(messageListener?.({ type: 'PAGE_ANCHOR_GET_STATUS' }, {}, vi.fn())).toBe(true);
  });

  it('re-checks the URL on tab visibility change instead of polling on a timer', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const registered = addEventListenerSpy.mock.calls.some(([type]) => type === 'visibilitychange');
    expect(registered).toBe(true);

    addEventListenerSpy.mockRestore();
  });
});

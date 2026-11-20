import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import contentDefinition from '../entrypoints/page-app';

import { setBootHandoff } from '../src/core/boot-handoff';
import { getPageStorageKey } from '../src/core/storage';

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
        sendMessage: vi.fn(() => Promise.resolve()),
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

  it('stays dormant on a page without drawings, then mounts an isolated host when opened', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById('page-anchor-host')).toBeNull();

    messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, vi.fn());
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

  describe('access to websites', () => {
    const toastText = () => document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.pa-toast:not(.pa-toast-hiding) .pa-toast-text')?.textContent ?? '';
    const toggle = () => messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, vi.fn());
    const answerAccess = (granted: boolean) =>
      mockChrome.runtime.sendMessage.mockImplementation((msg: { type: string }) => Promise.resolve(msg.type === 'PAGE_ANCHOR_SITE_ACCESS' ? { granted } : undefined));

    it('says so once when the toolbar opens on a site without access, and Set up opens settings for that site', async () => {
      answerAccess(false);
      contentDefinition.main();
      toggle();
      await vi.waitFor(() => expect(toastText()).toBe("Drawings on this site won't reappear on their own"));
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PAGE_ANCHOR_SITE_ACCESS' });

      const button = document.getElementById('page-anchor-host')!.shadowRoot!.querySelector('.pa-toast-btn') as HTMLButtonElement;
      expect(button.textContent).toBe('Set up');
      button.click();
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PAGE_ANCHOR_OPEN_OPTIONS', site: window.location.href });

      // Closing and reopening the toolbar on the same page does not repeat it.
      toggle();
      toggle();
      await new Promise((r) => setTimeout(r, 20));
      expect(toastText()).toBe('');
    });

    it('stays quiet when the site has access', async () => {
      answerAccess(true);
      contentDefinition.main();
      toggle();
      await new Promise((r) => setTimeout(r, 20));
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PAGE_ANCHOR_SITE_ACCESS' });
      expect(toastText()).toBe('');
    });

    it('stays quiet when the background cannot answer', async () => {
      mockChrome.runtime.sendMessage.mockImplementation(() => Promise.reject(new Error('no receiver')));
      contentDefinition.main();
      toggle();
      await new Promise((r) => setTimeout(r, 20));
      expect(toastText()).toBe('');
    });

    it('the More menu opens plain settings', async () => {
      answerAccess(true);
      contentDefinition.main();
      toggle();
      const shadow = document.getElementById('page-anchor-host')!.shadowRoot!;
      (shadow.querySelector('[data-action="open-options"]') as HTMLButtonElement).click();
      expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'PAGE_ANCHOR_OPEN_OPTIONS', site: undefined });
    });
  });

  it('prevents redundant duplicate host mount if already connected', () => {
    contentDefinition.main();
    messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, vi.fn());
    const countFirst = document.querySelectorAll('#page-anchor-host').length;
    expect(countFirst).toBe(1);

    contentDefinition.main();
    messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, vi.fn());
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

  it('handles PAGE_ANCHOR_URL_CHANGED messages', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const sendResponse = vi.fn();
    messageListener?.({ type: 'PAGE_ANCHOR_URL_CHANGED' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith({ success: true });
  });

  it('dispatches keyboard shortcuts for tools, shapes, undo, redo, and clear', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    // Enter drawing mode (global toggle works even when inactive, and builds the UI on first use)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', altKey: true, shiftKey: true, bubbles: true, cancelable: true })
    );
    const shadow = (document.getElementById('page-anchor-host') as HTMLElement).shadowRoot!;
    const isActive = (tool: string) =>
      (shadow.querySelector(`[data-tool="${tool}"]`) as HTMLElement)?.classList.contains('active') ?? false;

    // Single-letter tool shortcuts only work while drawing mode is active
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
    expect(isActive('pen')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
    expect(isActive('rect')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }));
    expect(isActive('double-arrow')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'e', bubbles: true, cancelable: true }));
    expect(isActive('eraser')).toBe(true);

    // Undo / Redo / Clear use their real default chords
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'x', altKey: true, shiftKey: true, bubbles: true, cancelable: true })
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

  it('reacts to window navigation lifecycle events (beforeunload, pagehide, hashchange, popstate)', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    window.dispatchEvent(new Event('beforeunload'));
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('hashchange'));
    window.dispatchEvent(new Event('popstate'));

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

    // Responses are sent synchronously, so the channel is never held open.
    expect(messageListener?.({ type: 'PAGE_ANCHOR_GET_STATUS' }, {}, vi.fn())).toBe(false);
  });

  it('re-checks the URL on tab visibility change instead of polling on a timer', async () => {
    const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const registered = addEventListenerSpy.mock.calls.some(([type]) => type === 'visibilitychange');
    expect(registered).toBe(true);

    addEventListenerSpy.mockRestore();
  });
  describe('Regression fixes', () => {
    const pageKey = () => getPageStorageKey(window.location.href, 'clean');
    const stroke = (id: string) => ({
      id,
      type: 'pen',
      points: [{ x: 10, y: 10 }, { x: 40, y: 40 }],
      strokeColor: '#ef4444',
      strokeWidth: 4,
      opacity: 1,
      createdAt: 1,
      bbox: { minX: 10, minY: 10, maxX: 40, maxY: 40 },
    });
    const status = () => {
      const sendResponse = vi.fn();
      messageListener?.({ type: 'PAGE_ANCHOR_GET_STATUS' }, {}, sendResponse);
      return sendResponse.mock.calls[0][0];
    };
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const dataWrites = () =>
      mockChrome.storage.local.set.mock.calls.filter(([items]: [Record<string, unknown>]) =>
        Object.keys(items).some((k) => k.startsWith('page_anchor_data:'))
      ).length;
    const shadow = () => document.getElementById('page-anchor-host')!.shadowRoot!;
    const undoButton = () => shadow().querySelector('[data-action="undo"]') as HTMLButtonElement;

    it('pins host styles with !important so page CSS cannot hide or transform the overlay', () => {
      contentDefinition.main();
      messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, vi.fn());
      const host = document.getElementById('page-anchor-host') as HTMLElement;
      for (const prop of ['transform', 'filter', 'display', 'visibility', 'opacity', 'contain', 'z-index']) {
        expect(host.style.getPropertyPriority(prop)).toBe('important');
      }
      expect(host.style.getPropertyValue('transform')).toBe('none');
    });

    it('takes over from an older copy on the page instead of leaving it dead', async () => {
      contentDefinition.main();
      messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, vi.fn());
      const first = document.getElementById('page-anchor-host') as HTMLElement;
      const firstListener = messageListener;

      contentDefinition.main();
      await wait(20);

      expect(document.querySelectorAll('#page-anchor-host')).toHaveLength(0);
      expect(first.dataset.destroyed).toBe('true');
      expect(first.isConnected).toBe(false);
      expect(firstListener?.({ type: 'PAGE_ANCHOR_GET_STATUS' }, {}, vi.fn())).toBe(false);

      const sendResponse = vi.fn();
      messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, sendResponse);
      expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
      const hosts = document.querySelectorAll('#page-anchor-host');
      expect(hosts).toHaveLength(1);
      expect(hosts[0]).not.toBe(first);
    });

    it('mounts on its own when the page already has drawings, without opening the toolbar', async () => {
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);
      expect(document.getElementById('page-anchor-host')).not.toBeNull();
      expect(status().count).toBe(1);
      expect(status().active).toBe(false);
    });

    it('opens the toolbar right away when the boot script loaded it for the user', async () => {
      setBootHandoff({ openToolbar: true });
      contentDefinition.main();
      expect(status().active).toBe(true);
      await wait(20);
      expect(status().active).toBe(true);
    });

    it('shows the drawings the boot script already read, without opening the toolbar', async () => {
      setBootHandoff({ openToolbar: false, data: { url: window.location.href, normalizedUrl: '', pageTitle: '', updatedAt: 3, elements: [stroke('h1'), stroke('h2')] as never[] } });
      contentDefinition.main();
      await wait(20);
      expect(status().count).toBe(2);
      expect(status().active).toBe(false);
      expect(mockChrome.storage.local.get).not.toHaveBeenCalledWith(pageKey());
    });

    it('never writes page data on pagehide when there are no local edits', async () => {
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);

      window.dispatchEvent(new Event('pagehide'));
      window.dispatchEvent(new Event('beforeunload'));
      await wait(20);

      expect(dataWrites()).toBe(0);
      expect(mockLocalStorage[pageKey()].elements).toHaveLength(1);
    });

    it('does not save before the initial load finishes', async () => {
      mockChrome.storage.local.get = vi.fn(() => new Promise(() => {}));
      contentDefinition.main();
      await wait(10);

      messageListener?.({ type: 'PAGE_ANCHOR_CLEAR' }, {}, vi.fn());
      await wait(320);

      expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
      expect(mockChrome.storage.local.remove).not.toHaveBeenCalled();
    });

    it('routes the clear message through the normal save path with undo', async () => {
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a'), stroke('b')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);
      expect(status().count).toBe(2);

      messageListener?.({ type: 'PAGE_ANCHOR_CLEAR' }, {}, vi.fn());
      await wait(320);

      expect(status().count).toBe(0);
      expect(mockLocalStorage[pageKey()]).toBeUndefined();
      expect(undoButton().disabled).toBe(false);
    });

    const notify = (keys: string[]) => messageListener?.({ type: 'PAGE_ANCHOR_STORAGE_CHANGED', keys }, {}, vi.fn());

    it('live-reloads drawings saved by another tab when this tab has no local edits', async () => {
      contentDefinition.main();
      await wait(20);
      expect(status().count).toBe(0);

      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('x'), stroke('y')], updatedAt: 99 };
      notify([pageKey()]);
      await wait(120);
      expect(status().count).toBe(2);

      delete mockLocalStorage[pageKey()];
      notify([pageKey()]);
      await wait(120);
      expect(status().count).toBe(0);
    });

    it('merges another tab’s drawings into unsaved local edits instead of dropping either', async () => {
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);

      messageListener?.({ type: 'PAGE_ANCHOR_CLEAR' }, {}, vi.fn());
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a'), stroke('r1'), stroke('r2')], updatedAt: 50 };
      notify([pageKey()]);
      await wait(400);

      expect(status().count).toBe(2);
      expect(mockLocalStorage[pageKey()].elements.map((e: { id: string }) => e.id)).toEqual(['r1', 'r2']);
    });

    it('keeps undo history when a notice arrives but its drawings did not change', async () => {
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);

      messageListener?.({ type: 'PAGE_ANCHOR_CLEAR' }, {}, vi.fn());
      await wait(320);
      expect(undoButton().disabled).toBe(false);

      notify([pageKey(), 'page_anchor_index']);
      await wait(120);
      expect(undoButton().disabled).toBe(false);
    });

    it('ignores notices about other pages', async () => {
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [], updatedAt: 7 };
      notify(['page_anchor_data:https://elsewhere.example/']);
      await wait(120);
      expect(status().count).toBe(1);
    });

    it('applies settings changed in another tab', async () => {
      contentDefinition.main();
      await wait(20);

      mockLocalStorage['page_anchor_settings'] = { shortcuts: { 'tool-pen': 'g' } };
      notify(['page_anchor_settings']);
      await wait(50);
      messageListener?.({ type: 'PAGE_ANCHOR_TOGGLE' }, {}, vi.fn());
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true }));

      expect((shadow().querySelector('[data-tool="pen"]') as HTMLElement).classList.contains('active')).toBe(true);
    });

    it('keeps undo history across a same-page hash change', async () => {
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);

      messageListener?.({ type: 'PAGE_ANCHOR_CLEAR' }, {}, vi.fn());
      await wait(20);

      window.location.hash = '#details';
      window.dispatchEvent(new Event('hashchange'));
      await wait(20);

      expect(undoButton().disabled).toBe(false);
      window.location.hash = '';
    });

    it('tears itself down when its extension context is gone instead of showing a save error', async () => {
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);
      const host = document.getElementById('page-anchor-host') as HTMLElement;

      mockChrome.storage.local.get = vi.fn(() => Promise.reject(new Error('Extension context invalidated.')));
      messageListener?.({ type: 'PAGE_ANCHOR_CLEAR' }, {}, vi.fn());
      await wait(320);

      expect(host.dataset.destroyed).toBe('true');
      expect(host.isConnected).toBe(false);
      expect(host.shadowRoot!.querySelector('.pa-save-error')).toBeNull();
    });

    it('still shows the save error while the extension context is valid', async () => {
      mockChrome.runtime.id = 'test-extension';
      mockLocalStorage[pageKey()] = { url: window.location.href, elements: [stroke('a')], updatedAt: 1 };
      contentDefinition.main();
      await wait(20);

      mockChrome.storage.local.get = vi.fn(() => Promise.reject(new Error('IO error')));
      messageListener?.({ type: 'PAGE_ANCHOR_CLEAR' }, {}, vi.fn());
      await wait(320);

      expect(shadow().querySelector('.pa-save-error')).not.toBeNull();
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initOptions } from '../entrypoints/options/options';

type Store = Record<string, unknown>;

function makeArea(store: Store) {
  return {
    get: vi.fn((key: string | null) => {
      if (typeof key === 'string') return Promise.resolve({ [key]: store[key] });
      return Promise.resolve({ ...store });
    }),
    set: vi.fn((data: Store) => {
      Object.assign(store, data);
      return Promise.resolve();
    }),
    remove: vi.fn((keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key];
      return Promise.resolve();
    }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 30));

function savedSettings(store: Store): Record<string, unknown> {
  return (store['page_anchor_settings'] ?? {}) as Record<string, unknown>;
}

function badgeFor(id: string): HTMLButtonElement {
  return document.querySelector(`.pa-key-badge[data-shortcut-id="${id}"]`) as HTMLButtonElement;
}

function pressKey(init: KeyboardEventInit) {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('Options Page: Configuration, Shortcuts Recorder, Persistence, & Backups', () => {
  let mockSyncStore: Store;
  let mockLocalStore: Store;
  let mockChrome: { runtime: { openOptionsPage: ReturnType<typeof vi.fn> }; storage: { sync: ReturnType<typeof makeArea>; local: ReturnType<typeof makeArea> } };

  beforeEach(() => {
    mockSyncStore = {};
    mockLocalStore = {};

    let html = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');
    html = html.replace(/<link[^>]*>/gi, '').replace(/<script[^>]*>.*?<\/script>/gi, '');
    document.body.innerHTML = html;

    mockChrome = {
      runtime: { openOptionsPage: vi.fn() },
      storage: { sync: makeArea(mockSyncStore), local: makeArea(mockLocalStore) },
    };

    vi.stubGlobal('chrome', mockChrome);
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
    URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('navigates tabs using click and ARIA keyboard patterns (ArrowRight, ArrowLeft, Home, End)', async () => {
    await initOptions();

    const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.pa-tab-btn'));
    expect(tabs.length).toBeGreaterThanOrEqual(3);

    expect(tabs[0].getAttribute('aria-selected')).toBe('true');

    tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');

    tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(tabs[tabs.length - 1].getAttribute('aria-selected')).toBe('true');

    tabs[tabs.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  });

  it('records a new keystroke shortcut and binds it to configuration', async () => {
    await initOptions();

    const badge = document.querySelector('.pa-key-badge') as HTMLButtonElement;
    expect(badge).not.toBeNull();

    badge.click();
    expect(badge.classList.contains('recording')).toBe(true);
    expect(badge.textContent).toBe('Press keys...');

    pressKey({ key: 'k', code: 'KeyK', ctrlKey: true, shiftKey: true });

    expect(badge.classList.contains('recording')).toBe(false);
    expect(badge.textContent?.toLowerCase()).toContain('k');
  });

  it('cancels shortcut recording when Escape key is pressed', async () => {
    await initOptions();

    const badge = document.querySelector('.pa-key-badge') as HTMLButtonElement;
    const initialText = badge.textContent;

    badge.click();
    expect(badge.classList.contains('recording')).toBe(true);

    pressKey({ key: 'Escape' });
    expect(badge.classList.contains('recording')).toBe(false);
    expect(badge.textContent).toBe(initialText);
  });

  it('detects browser shortcut conflict and flags warning styling', async () => {
    await initOptions();

    const badge = document.querySelector('.pa-key-badge') as HTMLButtonElement;
    badge.click();
    pressKey({ key: 't', code: 'KeyT', ctrlKey: true });

    expect(badge.classList.contains('border-amber-500')).toBe(true);
    expect(badge.title).toContain('conflicts with');
  });

  it('refuses a key already bound to another action and explains why inline', async () => {
    await initOptions();

    const pen = badgeFor('tool-pen');
    const before = pen.textContent;
    pen.click();
    pressKey({ key: 'h', code: 'KeyH' });

    expect(pen.textContent).toBe(before);
    expect(pen.classList.contains('recording')).toBe(false);
    const error = document.getElementById('shortcut-error-tool-pen') as HTMLElement;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Already used by Highlighter.');
    expect(pen.getAttribute('aria-describedby')).toBe(error.id);

    pen.click();
    expect(error.hidden).toBe(true);
    pressKey({ key: 'q', code: 'KeyQ' });
    expect(pen.textContent).toBe('Q');
    expect(error.hidden).toBe(true);
  });

  it('refuses to save while two actions share a shortcut', async () => {
    mockLocalStore['page_anchor_settings'] = { shortcuts: { 'tool-pen': 'h' } };
    await initOptions();

    const error = document.getElementById('shortcut-error-tool-pen') as HTMLElement;
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe('Also used by Highlighter.');

    const strokeSimplification = document.getElementById('pref-stroke-simplification') as HTMLInputElement;
    strokeSimplification.checked = false;
    strokeSimplification.dispatchEvent(new Event('change', { bubbles: true }));
    mockChrome.storage.local.set.mockClear();

    (document.getElementById('btn-save') as HTMLButtonElement).click();
    await flush();

    expect(mockChrome.storage.local.set).not.toHaveBeenCalled();
    expect(document.getElementById('save-status')?.dataset.state).toBe('dirty');
  });

  it('cancels the first recording when a second one starts', async () => {
    await initOptions();

    const first = badgeFor('toggle-active');
    const second = badgeFor('tool-pen');
    const firstText = first.textContent;

    first.click();
    second.click();

    expect(first.textContent).toBe(firstText);
    expect(first.classList.contains('recording')).toBe(false);
    expect(second.classList.contains('recording')).toBe(true);

    pressKey({ key: 'q', code: 'KeyQ' });
    expect(second.textContent).toBe('Q');
    expect(first.textContent).toBe(firstText);
  });

  it('stops recording when switching tabs', async () => {
    await initOptions();

    const pen = badgeFor('tool-pen');
    const before = pen.textContent;
    pen.click();
    (document.getElementById('tab-btn-persistence') as HTMLButtonElement).click();

    expect(pen.classList.contains('recording')).toBe(false);
    expect(pen.textContent).toBe(before);
    pressKey({ key: 'q', code: 'KeyQ' });
    expect(pen.textContent).toBe(before);
  });

  it('stops recording when shortcuts are reset', async () => {
    await initOptions();

    badgeFor('tool-pen').click();
    (document.getElementById('btn-reset-shortcuts') as HTMLButtonElement).click();

    const pen = badgeFor('tool-pen');
    expect(pen.classList.contains('recording')).toBe(false);
    pressKey({ key: 'q', code: 'KeyQ' });
    expect(pen.textContent).toBe('P');
    expect(document.querySelector('.pa-key-badge.recording')).toBeNull();
  });

  it('updates persistence form settings and saves them', async () => {
    await initOptions();

    const urlMatchMode = document.getElementById('pref-url-match-mode') as HTMLSelectElement;
    urlMatchMode.value = 'domain';
    urlMatchMode.dispatchEvent(new Event('change'));

    const orphanMode = document.getElementById('pref-orphan-mode') as HTMLSelectElement;
    orphanMode.value = 'dimmed';
    orphanMode.dispatchEvent(new Event('change'));

    const strokeSimplification = document.getElementById('pref-stroke-simplification') as HTMLInputElement;
    strokeSimplification.checked = false;
    strokeSimplification.dispatchEvent(new Event('change'));

    (document.getElementById('btn-save') as HTMLButtonElement).click();
    await flush();

    expect(mockChrome.storage.local.set).toHaveBeenCalled();
    const saved = savedSettings(mockLocalStore);
    expect(saved.urlMatchMode).toBe('domain');
    expect(saved.orphanedAnchorMode).toBe('dimmed');
    expect(saved.strokeSimplification).toBe(false);
    expect('isToolbarOpen' in saved).toBe(false);
  });

  it('no longer offers a setting to open the toolbar on page load', async () => {
    await initOptions();
    expect(document.getElementById('pref-toolbar-open')).toBeNull();
  });

  it('saves only the edited keys, keeping changes made in other tabs meanwhile', async () => {
    mockLocalStore['page_anchor_settings'] = { defaultStrokeColor: '#111111', toolbarPosition: { x: 1, y: 2 } };
    await initOptions();

    mockLocalStore['page_anchor_settings'] = {
      defaultStrokeColor: '#222222',
      toolbarPosition: { x: 50, y: 60 },
      areAnnotationsVisible: false,
    };

    const strokeSimplification = document.getElementById('pref-stroke-simplification') as HTMLInputElement;
    strokeSimplification.checked = false;
    strokeSimplification.dispatchEvent(new Event('change', { bubbles: true }));

    (document.getElementById('btn-save') as HTMLButtonElement).click();
    await flush();

    const saved = savedSettings(mockLocalStore);
    expect(saved.strokeSimplification).toBe(false);
    expect(saved.defaultStrokeColor).toBe('#222222');
    expect(saved.toolbarPosition).toEqual({ x: 50, y: 60 });
    expect(saved.areAnnotationsVisible).toBe(false);
  });

  it('resets shortcuts to defaults when reset button is confirmed', async () => {
    await initOptions();
    (document.getElementById('btn-reset-shortcuts') as HTMLButtonElement).click();
    expect(globalThis.confirm).toHaveBeenCalled();
  });

  it('handles JSON backup export and import file reader flow', async () => {
    await initOptions();

    (document.getElementById('btn-export-backup') as HTMLButtonElement).click();
    await flush();

    expect(URL.createObjectURL).toHaveBeenCalled();

    const fileInput = document.getElementById('backup-file-input') as HTMLInputElement;
    const mockFile = new File(
      [JSON.stringify({ page_anchor_settings: { defaultStrokeColor: '#abcdef' } })],
      'page-anchor-backup.json',
      { type: 'application/json' }
    );

    Object.defineProperty(fileInput, 'files', { value: [mockFile], writable: true });

    fileInput.dispatchEvent(new Event('change'));
    await flush();

    const status = document.getElementById('import-status') as HTMLElement;
    expect(status.textContent).toBe('Backup restored successfully!');
  });

  it('clears the file picker after an import so the same file can be picked again', async () => {
    await initOptions();

    const fileInput = document.getElementById('backup-file-input') as HTMLInputElement;
    const file = new File([JSON.stringify({ page_anchor_settings: {} })], 'b.json', { type: 'application/json' });
    Object.defineProperty(fileInput, 'files', { value: [file], writable: true });
    const valueSetter = vi.fn();
    Object.defineProperty(fileInput, 'value', { get: () => '', set: valueSetter, configurable: true });

    fileInput.dispatchEvent(new Event('change'));
    await flush();

    expect(valueSetter).toHaveBeenCalledWith('');
  });

  it('keeps the download link attached and its URL alive until the download has started', async () => {
    await initOptions();
    vi.useFakeTimers();

    let attachedOnClick = false;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      attachedOnClick = this.isConnected;
    });

    (document.getElementById('btn-export-backup') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(0);

    expect(clickSpy).toHaveBeenCalled();
    expect(attachedOnClick).toBe(true);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    expect(document.querySelector('a[download]')).toBeNull();
    clickSpy.mockRestore();
  });

  it('renders saved-page titles and URLs as text, not injected markup', async () => {
    const url = 'https://example.com/a';
    mockLocalStore[`page_anchor_data:${url}`] = { url, normalizedUrl: url, pageTitle: 'x', updatedAt: Date.now(), elements: [] };
    mockLocalStore['page_anchor_index'] = {
      [url]: {
        normalizedUrl: url,
        url,
        pageTitle: '<img src=x onerror="globalThis.pwned=true">',
        updatedAt: Date.now(),
        elementCount: 2,
      },
    };

    await initOptions();

    const list = document.getElementById('saved-pages-list') as HTMLElement;
    expect(list.querySelector('img')).toBeNull();
    expect(Reflect.get(globalThis, 'pwned')).toBeUndefined();

    const titleEl = list.querySelector('.pa-saved-title') as HTMLElement;
    expect(titleEl.textContent).toBe('<img src=x onerror="globalThis.pwned=true">');
  });

  it('does not render a stored non-http(s) URL as a clickable link', async () => {
    const key = 'https://evil.test/';
    mockLocalStore[`page_anchor_data:${key}`] = { url: key, normalizedUrl: key, pageTitle: 'x', updatedAt: Date.now(), elements: [] };
    mockLocalStore['page_anchor_index'] = {
      [key]: {
        normalizedUrl: key,
        url: 'javascript:alert(document.domain)',
        pageTitle: 'Hostile backup entry',
        updatedAt: Date.now(),
        elementCount: 1,
      },
    };

    await initOptions();

    const list = document.getElementById('saved-pages-list') as HTMLElement;
    expect(list.querySelector('a.pa-saved-url')).toBeNull();

    const urlEl = list.querySelector('.pa-saved-url') as HTMLElement;
    expect(urlEl.tagName).toBe('SPAN');
    expect(urlEl.getAttribute('href')).toBeNull();
    expect(urlEl.textContent).toBe('javascript:alert(document.domain)');
  });
});

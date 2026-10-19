import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PopupSettingsPanel } from '../entrypoints/popup/popup-settings';

const SETTINGS_KEY = 'page_anchor_settings';
const INDEX_KEY = 'page_anchor_index';

/** Minimal in-memory stand-in for `chrome.storage.local` (callback & promise style). */
function createStorageMock(seed: Record<string, any> = {}) {
  const store: Record<string, any> = { ...seed };
  return {
    store,
    api: {
      get: vi.fn((keys: any, cb?: (data: any) => void) => {
        let out: Record<string, any>;
        if (keys === null || keys === undefined) out = { ...store };
        else if (typeof keys === 'string') out = { [keys]: store[keys] };
        else if (Array.isArray(keys)) {
          out = {};
          keys.forEach((k) => {
            out[k] = store[k];
          });
        } else out = { ...store };
        if (typeof cb === 'function') {
          cb(out);
          return;
        }
        return Promise.resolve(out);
      }),
      set: vi.fn((data: Record<string, any>, cb?: () => void) => {
        Object.assign(store, data);
        if (typeof cb === 'function') cb();
      }),
      remove: vi.fn((keys: any, cb?: () => void) => {
        const list = Array.isArray(keys) ? keys : [keys];
        list.forEach((k) => delete store[k]);
        if (typeof cb === 'function') cb();
      }),
    },
  };
}

describe('Popup settings panel', () => {
  let root: HTMLElement;
  let storage: ReturnType<typeof createStorageMock>;

  /** Lets the panel's debounce-free but asynchronous save settle. */
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function mountPanel(seed?: Record<string, any>) {
    storage = createStorageMock(seed);
    (globalThis as any).chrome = { storage: { local: storage.api } };
    (globalThis as any).browser = (globalThis as any).chrome;
    const panel = new PopupSettingsPanel(root, () => {});
    return panel;
  }

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
    delete (globalThis as any).browser;
    document.body.innerHTML = '';
  });

  it('renders every settings section with labelled controls', async () => {
    const panel = mountPanel();
    await panel.mount();

    const headings = Array.from(root.querySelectorAll('h3')).map((h) => h.textContent);
    expect(headings).toEqual([
      'Persistence & matching',
      'Keyboard shortcuts',
      'Saved pages',
      'Backup & restore',
    ]);

    const controls = Array.from(root.querySelectorAll<HTMLElement>('input, select'));
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('saves a changed preference immediately, without a save button', async () => {
    const panel = mountPanel();
    await panel.mount();

    const select = root.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('clean');

    select.value = 'domain';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(storage.api.set).toHaveBeenCalled();
    expect(storage.store[SETTINGS_KEY].urlMatchMode).toBe('domain');
    expect(root.querySelector('button[type="button"]')).toBeTruthy();
  });

  it('rebinds a shortcut from a recorded keystroke and persists it', async () => {
    const panel = mountPanel();
    await panel.mount();

    root.querySelector<HTMLButtonElement>('button[aria-label="Open keyboard shortcut settings"]')!.click();

    const badge = root.querySelector<HTMLButtonElement>('button[data-shortcut-id="tool-pen"]')!;
    badge.click();
    expect(badge.textContent).toBe('Press keys…');

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', altKey: true, bubbles: true, cancelable: true }));
    await flush();

    expect(badge.textContent).toBe('Alt + G');
    expect(storage.store[SETTINGS_KEY].shortcuts['tool-pen']).toBe('Alt+g');
  });

  it('cancels recording on Escape without changing the shortcut', async () => {
    const panel = mountPanel();
    await panel.mount();

    root.querySelector<HTMLButtonElement>('button[aria-label="Open keyboard shortcut settings"]')!.click();

    const badge = root.querySelector<HTMLButtonElement>('button[data-shortcut-id="tool-pen"]')!;
    const original = badge.textContent;
    badge.click();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await flush();

    expect(badge.textContent).toBe(original);
    expect(storage.api.set).not.toHaveBeenCalled();
  });

  it('shows shortcuts behind a drill-down card and returns via back', async () => {
    const panel = mountPanel();
    await panel.mount();

    // The default view stays short: the list itself is not rendered up front.
    expect(root.querySelector('button[data-shortcut-id="tool-pen"]')).toBeNull();

    root.querySelector<HTMLButtonElement>('button[aria-label="Open keyboard shortcut settings"]')!.click();
    expect(root.querySelector('button[data-shortcut-id="tool-pen"]')).not.toBeNull();

    root.querySelector<HTMLButtonElement>('button[aria-label="Back to settings"]')!.click();
    await flush();
    expect(root.querySelector('button[data-shortcut-id="tool-pen"]')).toBeNull();
    expect(Array.from(root.querySelectorAll('h3')).map((h) => h.textContent)).toContain('Keyboard shortcuts');
  });

  it('keeps the saved-page list behind a drill-down row that reports count and size', async () => {
    const panel = mountPanel({
      [INDEX_KEY]: {
        'https://example.com/a': {
          normalizedUrl: 'https://example.com/a',
          url: 'https://example.com/a',
          pageTitle: 'Example A',
          updatedAt: Date.now(),
          elementCount: 4,
          bytes: 2048,
        },
      },
    });
    await panel.mount();

    expect(root.querySelector('button[aria-label^="Delete saved drawings"]')).toBeNull();

    const nav = root.querySelector<HTMLButtonElement>('button[aria-label="Open saved pages"]')!;
    expect(nav.textContent).toContain('1 page · 2 KB stored');

    nav.click();
    await flush();

    expect(root.querySelector('button[aria-label^="Delete saved drawings"]')).not.toBeNull();
    expect(root.textContent).toContain('4 elements · 2 KB');
    expect(root.textContent).toContain('1 page · 2 KB stored in this browser');
  });

  it('measures saved pages that were stored before sizes were tracked', async () => {
    const panel = mountPanel({
      [INDEX_KEY]: {
        'https://example.com/legacy': {
          normalizedUrl: 'https://example.com/legacy',
          url: 'https://example.com/legacy',
          pageTitle: 'Legacy',
          updatedAt: Date.now(),
          elementCount: 1,
        },
      },
      'page_anchor_data:https://example.com/legacy': {
        url: 'https://example.com/legacy',
        normalizedUrl: 'https://example.com/legacy',
        pageTitle: 'Legacy',
        updatedAt: Date.now(),
        elements: [{ id: '1', type: 'pen', points: [], strokeColor: '#000', strokeWidth: 1, opacity: 1, createdAt: 1 }],
      },
    });
    await panel.mount();

    const nav = root.querySelector<HTMLButtonElement>('button[aria-label="Open saved pages"]')!;
    expect(nav.textContent).toMatch(/1 page · \d+(\.\d)? B stored/);

    nav.click();
    await flush();
    expect(root.textContent).toContain('1 element ·');
  });

  it('lists saved pages and removes one when its delete button is used', async () => {
    const panel = mountPanel({
      [INDEX_KEY]: {
        'https://example.com/a': {
          normalizedUrl: 'https://example.com/a',
          url: 'https://example.com/a',
          pageTitle: 'Example A',
          updatedAt: Date.now(),
          elementCount: 4,
        },
      },
    });
    await panel.mount();

    root.querySelector<HTMLButtonElement>('button[aria-label="Open saved pages"]')!.click();
    await flush();

    const deleteBtn = root.querySelector<HTMLButtonElement>('button[aria-label^="Delete saved drawings"]')!;
    expect(deleteBtn.getAttribute('aria-label')).toBe('Delete saved drawings for Example A');

    deleteBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(storage.api.remove).toHaveBeenCalled();
    expect(storage.store[INDEX_KEY]).not.toHaveProperty('https://example.com/a');
    expect(root.querySelector('button[aria-label^="Delete saved drawings"]')).toBeNull();
  });

  it('returns from the saved-page list via back', async () => {
    const panel = mountPanel({
      [INDEX_KEY]: {
        'https://example.com/a': {
          normalizedUrl: 'https://example.com/a',
          url: 'https://example.com/a',
          pageTitle: 'Example A',
          updatedAt: Date.now(),
          elementCount: 4,
        },
      },
    });
    await panel.mount();

    root.querySelector<HTMLButtonElement>('button[aria-label="Open saved pages"]')!.click();
    await flush();
    expect(root.querySelector('button[aria-label="Open saved pages"]')).toBeNull();

    root.querySelector<HTMLButtonElement>('button[aria-label="Back to settings"]')!.click();
    await flush();
    expect(Array.from(root.querySelectorAll('h3')).map((h) => h.textContent)).toContain('Saved pages');
    expect(root.querySelector('button[aria-label="Open saved pages"]')).not.toBeNull();
  });

  it('renders untrusted saved page titles and URLs as text, never as markup', async () => {
    const panel = mountPanel({
      [INDEX_KEY]: {
        '<img src=x onerror="window.__pwned=1">': {
          normalizedUrl: 'https://example.com/x',
          url: '<script>window.__pwned=1</script>',
          pageTitle: '<img src=x onerror="window.__pwned=1">',
          updatedAt: Date.now(),
          elementCount: 1,
        },
      },
    });
    await panel.mount();

    root.querySelector<HTMLButtonElement>('button[aria-label="Open saved pages"]')!.click();
    await flush();

    expect((globalThis as any).window?.__pwned).toBeUndefined();
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror="window.__pwned=1">');
    expect(root.textContent).toContain('<script>window.__pwned=1</script>');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initOptions } from '../entrypoints/options/options';

describe('Options Page: Configuration, Shortcuts Recorder, Persistence, & Backups', () => {
  let mockChrome: any;
  let mockSyncStore: Record<string, any>;
  let mockLocalStore: Record<string, any>;

  beforeEach(() => {
    mockSyncStore = {};
    mockLocalStore = {};

    let html = fs.readFileSync(
      path.resolve(__dirname, '../entrypoints/options/index.html'),
      'utf-8'
    );
    html = html.replace(/<link[^>]*>/gi, '').replace(/<script[^>]*>.*?<\/script>/gi, '');
    document.body.innerHTML = html;

    mockChrome = {
      runtime: {
        openOptionsPage: vi.fn(),
      },
      storage: {
        sync: {
          get: vi.fn((key) => {
            if (typeof key === 'string') return Promise.resolve({ [key]: mockSyncStore[key] });
            return Promise.resolve(mockSyncStore);
          }),
          set: vi.fn((data) => {
            Object.assign(mockSyncStore, data);
            return Promise.resolve();
          }),
        },
        local: {
          get: vi.fn((key) => {
            if (typeof key === 'string') return Promise.resolve({ [key]: mockLocalStore[key] });
            return Promise.resolve(mockLocalStore);
          }),
          set: vi.fn((data) => {
            Object.assign(mockLocalStore, data);
            return Promise.resolve();
          }),
        },
      },
    };

    (globalThis as any).chrome = mockChrome;
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);
    (globalThis as any).URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
    (globalThis as any).URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
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

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        code: 'KeyK',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      })
    );

    expect(badge.classList.contains('recording')).toBe(false);
    expect(badge.textContent?.toLowerCase()).toContain('k');
  });

  it('cancels shortcut recording when Escape key is pressed', async () => {
    await initOptions();

    const badge = document.querySelector('.pa-key-badge') as HTMLButtonElement;
    const initialText = badge.textContent;

    badge.click();
    expect(badge.classList.contains('recording')).toBe(true);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(badge.classList.contains('recording')).toBe(false);
    expect(badge.textContent).toBe(initialText);
  });

  it('detects browser shortcut conflict and flags warning styling', async () => {
    await initOptions();

    const badge = document.querySelector('.pa-key-badge') as HTMLButtonElement;
    badge.click();

    // Press Ctrl+T (reserved browser new tab)
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 't',
        code: 'KeyT',
        ctrlKey: true,
        bubbles: true,
      })
    );

    expect(badge.classList.contains('border-amber-500')).toBe(true);
    expect(badge.title).toContain('conflicts with');
  });

  it('updates form settings for pen, highlighter, font, and URL persistence', async () => {
    await initOptions();

    const penColor = document.getElementById('pref-pen-color') as HTMLInputElement;
    penColor.value = '#10b981';
    penColor.dispatchEvent(new Event('input'));

    const penWidth = document.getElementById('pref-pen-width') as HTMLInputElement;
    penWidth.value = '12';
    penWidth.dispatchEvent(new Event('input'));

    const highlighterColor = document.getElementById('pref-highlighter-color') as HTMLInputElement;
    highlighterColor.value = '#ec4899';
    highlighterColor.dispatchEvent(new Event('input'));

    const fontSize = document.getElementById('pref-font-size') as HTMLInputElement;
    fontSize.value = '22';
    fontSize.dispatchEvent(new Event('input'));

    const urlMatchMode = document.getElementById('pref-url-match-mode') as HTMLSelectElement;
    urlMatchMode.value = 'domain';
    urlMatchMode.dispatchEvent(new Event('change'));

    const orphanMode = document.getElementById('pref-orphan-mode') as HTMLSelectElement;
    orphanMode.value = 'dimmed';
    orphanMode.dispatchEvent(new Event('change'));

    const saveBtn = document.getElementById('btn-save') as HTMLButtonElement;
    saveBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(mockChrome.storage.local.set).toHaveBeenCalled();
  });

  it('resets shortcuts to defaults when reset button is confirmed', async () => {
    await initOptions();

    const resetBtn = document.getElementById('btn-reset-shortcuts') as HTMLButtonElement;
    resetBtn.click();

    expect(globalThis.confirm).toHaveBeenCalled();
  });

  it('handles JSON backup export and import file reader flow', async () => {
    await initOptions();

    const exportBtn = document.getElementById('btn-export-backup') as HTMLButtonElement;
    exportBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(globalThis.URL.createObjectURL).toHaveBeenCalled();

    const fileInput = document.getElementById('backup-file-input') as HTMLInputElement;
    const mockFile = new File(
      [
        JSON.stringify({
          page_anchor_settings: { defaultStrokeColor: '#abcdef' },
        }),
      ],
      'page-anchor-backup.json',
      { type: 'application/json' }
    );

    Object.defineProperty(fileInput, 'files', {
      value: [mockFile],
      writable: true,
    });

    fileInput.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 30));

    const status = document.getElementById('import-status') as HTMLElement;
    expect(status.textContent).toBe('Backup restored successfully!');
  });

  it('renders saved-page titles and URLs as text, not injected markup', async () => {
    mockLocalStore['page_anchor_index'] = {
      'https://example.com/a': {
        normalizedUrl: 'https://example.com/a',
        url: 'https://example.com/a',
        pageTitle: '<img src=x onerror="globalThis.pwned=true">',
        updatedAt: Date.now(),
        elementCount: 2,
      },
    };

    await initOptions();

    const list = document.getElementById('saved-pages-list') as HTMLElement;
    expect(list.querySelector('img')).toBeNull();
    expect((globalThis as any).pwned).toBeUndefined();

    const titleEl = list.querySelector('.pa-saved-title') as HTMLElement;
    expect(titleEl.textContent).toBe('<img src=x onerror="globalThis.pwned=true">');
  });

  it('does not render a stored non-http(s) URL as a clickable link', async () => {
    mockLocalStore['page_anchor_index'] = {
      'https://evil.test/': {
        normalizedUrl: 'https://evil.test/',
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

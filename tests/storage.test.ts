import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearPageData,
  getPageStorageKey,
  exportAllDataAsJson,
  getAllSavedPagesSummary,
  importDataFromJson,
  isSafeHttpUrl,
  loadPageData,
  loadSettings,
  normalizeUrl,
  rekeySavedPages,
  savePageData,
  saveSettings,
} from '../src/core/storage';
import { AnchorElement } from '../src/types/engine.types';

describe('Storage Engine: URL Normalization', () => {
  it('strips tracking query parameters and scroll hashes in "clean" mode', () => {
    const rawUrl = 'https://example.com/article?utm_source=twitter&id=42&utm_medium=cpc&fbclid=xyz#section-comments';
    const normalized = normalizeUrl(rawUrl, 'clean');

    expect(normalized).toBe('https://example.com/article?id=42');
    expect(normalized).not.toContain('utm_source');
    expect(normalized).not.toContain('fbclid');
    expect(normalized).not.toContain('#section-comments');
  });

  it('preserves exact query strings and hashes when "exact" mode is chosen', () => {
    const rawUrl = 'https://example.com/path?query=val#heading';
    expect(normalizeUrl(rawUrl, 'exact')).toBe(rawUrl);
  });

  it('reduces to origin when "domain" mode is chosen', () => {
    const rawUrl = 'https://sub.example.com:8080/nested/path?key=val#hash';
    expect(normalizeUrl(rawUrl, 'domain')).toBe('https://sub.example.com:8080');
  });

  it('keeps hash-router fragments but strips plain section anchors in "clean" mode', () => {
    expect(normalizeUrl('https://app.example.com/#/inbox/42', 'clean')).toBe('https://app.example.com/#/inbox/42');
    expect(normalizeUrl('https://app.example.com/#!/settings', 'clean')).toBe('https://app.example.com/#!/settings');
    expect(normalizeUrl('https://app.example.com/#/a', 'clean')).not.toBe(normalizeUrl('https://app.example.com/#/b', 'clean'));
    expect(normalizeUrl('https://example.com/docs#install', 'clean')).toBe('https://example.com/docs');
  });

  it('treats a trailing slash as the same page but keeps the root path', () => {
    expect(normalizeUrl('https://example.com/docs/', 'clean')).toBe(normalizeUrl('https://example.com/docs', 'clean'));
    expect(normalizeUrl('https://example.com/', 'clean')).toBe('https://example.com/');
  });

  it('keeps meaningful ref and source parameters', () => {
    expect(normalizeUrl('https://example.com/compare?ref=main&source=x&utm_source=y', 'clean')).toBe(
      'https://example.com/compare?ref=main&source=x'
    );
  });
});

describe('Storage Engine: URL Safety Allowlist', () => {
  it('accepts absolute http and https URLs', () => {
    expect(isSafeHttpUrl('https://example.com/page?q=1#hash')).toBe(true);
    expect(isSafeHttpUrl('http://localhost:3000/doc')).toBe(true);
  });

  it('rejects script, data, file, relative, and non-string values', () => {
    expect(isSafeHttpUrl('javascript:alert(document.domain)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeHttpUrl('//example.com/page')).toBe(false);
    expect(isSafeHttpUrl('/relative/path')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
    expect(isSafeHttpUrl(undefined)).toBe(false);
    expect(isSafeHttpUrl(null)).toBe(false);
    expect(isSafeHttpUrl(42)).toBe(false);
  });
});

describe('Storage Engine: Persistence with Mocked Chrome Storage', () => {
  let mockStore: Record<string, any> = {};

  beforeEach(() => {
    mockStore = {};

    (globalThis as any).chrome = {
      runtime: {
        lastError: null,
      },
      storage: {
        local: {
          get: async (keys: any) => {
            if (typeof keys === 'string') return { [keys]: mockStore[keys] };
            return { ...mockStore };
          },
          set: async (items: Record<string, any>) => {
            Object.assign(mockStore, items);
          },
          remove: async (keys: string | string[]) => {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete mockStore[key];
          },
        },
      },
    };
  });

  it('saves and reloads page annotations accurately', async () => {
    const url = 'https://example.com/doc';
    const elements: AnchorElement[] = [
      {
        id: 'stroke-1',
        type: 'pen',
        points: [{ x: 10, y: 10 }, { x: 20, y: 20 }],
        strokeColor: '#ef4444',
        strokeWidth: 4,
        opacity: 1,
        createdAt: 1000,
        bbox: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
      },
    ];

    await savePageData(url, elements, 'Test Document Title');

    const loaded = await loadPageData(url);
    expect(loaded).not.toBeNull();
    expect(loaded?.pageTitle).toBe('Test Document Title');
    expect(loaded?.elements).toHaveLength(1);
    expect(loaded?.elements[0].id).toBe('stroke-1');
  });

  it('updates global index and reports saved pages summary', async () => {
    const url1 = 'https://example.com/page1';
    const url2 = 'https://example.com/page2';

    await savePageData(url1, [{ id: '1', type: 'pen', points: [], strokeColor: '#000', strokeWidth: 1, opacity: 1, createdAt: 1, bbox: { minX:0, minY:0, maxX:0, maxY:0 } }], 'Page 1');
    await savePageData(url2, [{ id: '2', type: 'pen', points: [], strokeColor: '#000', strokeWidth: 1, opacity: 1, createdAt: 1, bbox: { minX:0, minY:0, maxX:0, maxY:0 } }], 'Page 2');

    const summary = await getAllSavedPagesSummary();
    expect(summary).toHaveLength(2);
    expect(summary.map((s) => s.pageTitle)).toContain('Page 1');
    expect(summary.map((s) => s.pageTitle)).toContain('Page 2');
  });

  it('reports the stored size of each saved page', async () => {
    const url = 'https://example.com/sized';
    await savePageData(
      url,
      [{ id: '1', type: 'pen', points: [{ x: 1, y: 2 }], strokeColor: '#000', strokeWidth: 1, opacity: 1, createdAt: 1, bbox: { minX:1, minY:2, maxX:1, maxY:2 } }],
      'Sized'
    );

    const [entry] = await getAllSavedPagesSummary();
    expect(entry.bytes).toBeGreaterThan(0);
    expect(entry.bytes).toBe(JSON.stringify(mockStore['page_anchor_data:https://example.com/sized']).length);
  });

  it('measures index entries that predate size tracking', async () => {
    const key = 'page_anchor_data:https://example.com/legacy';
    mockStore['page_anchor_index'] = {
      'https://example.com/legacy': {
        normalizedUrl: 'https://example.com/legacy',
        url: 'https://example.com/legacy',
        pageTitle: 'Legacy',
        updatedAt: 1,
        elementCount: 1,
      },
    };
    mockStore[key] = { pageTitle: 'Legacy', elements: [], url: 'x', normalizedUrl: 'x', updatedAt: 1 };

    const [entry] = await getAllSavedPagesSummary();
    expect(entry.bytes).toBe(JSON.stringify(mockStore[key]).length);
  });

  it('clears page data and removes it from the global index', async () => {
    const url = 'https://example.com/to-clear';
    await savePageData(url, [{ id: '1', type: 'pen', points: [], strokeColor: '#000', strokeWidth: 1, opacity: 1, createdAt: 1, bbox: { minX:0, minY:0, maxX:0, maxY:0 } }], 'To Clear');

    expect(await getAllSavedPagesSummary()).toHaveLength(1);

    await clearPageData(url);

    const loaded = await loadPageData(url);
    expect(loaded).toBeNull();
    expect(await getAllSavedPagesSummary()).toHaveLength(0);
  });

  it('exports and restores JSON backups accurately', async () => {
    await saveSettings({ defaultStrokeWidth: 8 });
    const backupJson = await exportAllDataAsJson();
    expect(backupJson).toContain('page_anchor_settings');

    mockStore = {};
    const beforeRestore = await loadSettings();
    expect(beforeRestore.defaultStrokeWidth).toBe(4);

    const restoredOk = await importDataFromJson(backupJson);
    expect(restoredOk).toBe(true);

    const afterRestore = await loadSettings();
    expect(afterRestore.defaultStrokeWidth).toBe(8);
  });

  it('does not lose an overlapping settings write', async () => {
    await Promise.all([
      saveSettings({ defaultStrokeWidth: 9 }),
      saveSettings({ defaultStrokeColor: '#10b981' }),
      saveSettings({ keepToolbarOpen: true }),
    ]);

    const settings = await loadSettings();
    expect(settings.defaultStrokeWidth).toBe(9);
    expect(settings.defaultStrokeColor).toBe('#10b981');
    expect(settings.keepToolbarOpen).toBe(true);
  });

  it('keeps saving after one settings write fails', async () => {
    const originalSet = (globalThis as any).chrome.storage.local.set;
    let calls = 0;
    (globalThis as any).chrome.storage.local.set = (data: any) => {
      calls += 1;
      if (calls === 1) throw new Error('quota');
      return originalSet(data);
    };

    await expect(saveSettings({ defaultStrokeWidth: 7 })).rejects.toThrow('quota');
    await saveSettings({ defaultFontSize: 22 });

    (globalThis as any).chrome.storage.local.set = originalSet;
    const settings = await loadSettings();
    expect(settings.defaultFontSize).toBe(22);
  });

  describe('Settings Schema Migration', () => {
    it('maps a legacy `performanceMode` value onto `strokeSimplification`', async () => {
      mockStore['page_anchor_settings'] = { performanceMode: false };

      const settings = await loadSettings();
      expect(settings.strokeSimplification).toBe(false);
      expect((settings as any).performanceMode).toBeUndefined();
    });

    it('prefers an explicit `strokeSimplification` over a stale `performanceMode`', async () => {
      mockStore['page_anchor_settings'] = { strokeSimplification: false, performanceMode: true };

      const settings = await loadSettings();
      expect(settings.strokeSimplification).toBe(false);
    });

    it('migrates legacy keys from imported backups', async () => {
      const backup = JSON.stringify({
        page_anchor_settings: { performanceMode: false },
      });

      expect(await importDataFromJson(backup)).toBe(true);

      const settings = await loadSettings();
      expect(settings.strokeSimplification).toBe(false);
    });

    it('collapses legacy Ctrl/Cmd modifier tokens onto the neutral Mod', async () => {
      mockStore['page_anchor_settings'] = {
        shortcuts: { 'action-undo': 'Ctrl+z', 'action-redo': 'Cmd+y', 'tool-pen': 'p' },
      };

      const settings = await loadSettings();
      expect(settings.shortcuts['action-undo']).toBe('Mod+z');
      expect(settings.shortcuts['action-redo']).toBe('Mod+y');
      expect(settings.shortcuts['tool-pen']).toBe('p');
    });

    it('canonicalizes shortcut tokens in imported backups', async () => {
      const backup = JSON.stringify({
        page_anchor_settings: { shortcuts: { 'action-select-all': 'Ctrl+a' } },
      });

      expect(await importDataFromJson(backup)).toBe(true);

      const settings = await loadSettings();
      expect(settings.shortcuts['action-select-all']).toBe('Mod+a');
    });
  });

  describe('Backup Import Boundary Validation', () => {
    it('rejects payloads that are not a JSON object', async () => {
      expect(await importDataFromJson('not json at all')).toBe(false);
      expect(await importDataFromJson('[1, 2, 3]')).toBe(false);
      expect(await importDataFromJson('null')).toBe(false);
      expect(await importDataFromJson('"a string"')).toBe(false);
      expect(await importDataFromJson('')).toBe(false);
      expect(mockStore).toEqual({});
    });

    it('rejects a payload with no namespaced keys and writes nothing', async () => {
      const ok = await importDataFromJson(JSON.stringify({ version: 1, settings: {}, pages: {} }));

      expect(ok).toBe(false);
      expect(mockStore).toEqual({});
    });

    it('never writes foreign keys, even alongside valid ones', async () => {
      const ok = await importDataFromJson(
        JSON.stringify({
          evil_key: { anything: true },
          page_anchor_settings: { defaultStrokeWidth: 11 },
        })
      );

      expect(ok).toBe(true);
      expect(mockStore.evil_key).toBeUndefined();

      const settings = await loadSettings();
      expect(settings.defaultStrokeWidth).toBe(11);
    });

    it('rejects namespaced keys whose values are not objects', async () => {
      const ok = await importDataFromJson(
        JSON.stringify({ page_anchor_settings: 'garbage', page_anchor_index: [1, 2] })
      );

      expect(ok).toBe(false);
      expect(mockStore).toEqual({});
    });

    it('rejects oversized backups without parsing them', async () => {
      const oversized = JSON.stringify({ page_anchor_settings: { pad: 'a'.repeat(5_000_000) } });

      expect(await importDataFromJson(oversized)).toBe(false);
      expect(mockStore).toEqual({});
    });

    it('repairs or drops malformed elements instead of importing crash-prone data', async () => {
      const backup = JSON.stringify({
        'page_anchor_data:https://example.com/broken': {
          url: 'https://example.com/broken',
          normalizedUrl: 'https://example.com/broken',
          pageTitle: 'Broken',
          updatedAt: 1,
          elements: [
            { id: 'bad-text', type: 'text', x: 1, y: 2 },
            {
              id: 'bad-anchor',
              type: 'pen',
              points: [{ x: 1, y: 2 }],
              anchor: { selector: 'x' },
            },
            { id: 'bad-type', type: 'lasso', x: 1 },
            {
              id: 'good',
              type: 'pen',
              points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
              strokeColor: '#000',
              strokeWidth: 2,
              opacity: 1,
              createdAt: 1,
              bbox: { minX: 1, minY: 2, maxX: 3, maxY: 4 },
            },
          ],
        },
      });

      expect(await importDataFromJson(backup)).toBe(true);

      const loaded = await loadPageData('https://example.com/broken');
      const ids = loaded!.elements.map((e) => e.id);
      expect(ids).not.toContain('bad-text');
      expect(ids).not.toContain('bad-type');
      expect(ids).toContain('good');
      expect(loaded!.elements.find((e) => e.id === 'bad-anchor')!.anchor).toBeUndefined();
    });
  });
  describe('Regression: writes, index and keying', () => {
    const el = (id: string) =>
      ({ id, type: 'pen', points: [], strokeColor: '#000', strokeWidth: 1, opacity: 1, createdAt: 1, bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 } }) as AnchorElement;

    it('drops the stale isToolbarOpen key instead of mapping it', async () => {
      mockStore['page_anchor_settings'] = { isToolbarOpen: true };
      const settings = await loadSettings();
      expect((settings as any).isToolbarOpen).toBeUndefined();
      expect(settings.keepToolbarOpen).toBe(false);
    });

    it('fails the save instead of writing under a default-mode key when the settings read fails', async () => {
      mockStore['page_anchor_settings'] = { urlMatchMode: 'exact' };
      const originalGet = (globalThis as any).chrome.storage.local.get;
      (globalThis as any).chrome.storage.local.get = async () => {
        throw new Error('transient');
      };
      await expect(savePageData('https://example.com/a#x', [el('1')], 'A')).rejects.toThrow('transient');
      (globalThis as any).chrome.storage.local.get = originalGet;
      expect(Object.keys(mockStore).filter((k) => k.startsWith('page_anchor_data:'))).toHaveLength(0);
    });

    it('merges another tab’s save instead of overwriting it', async () => {
      const url = 'https://example.com/shared';
      const a = el('a');
      const first = await savePageData(url, [a], 'S');
      const base = { elements: [a], stamp: first.data!.updatedAt };

      const tabB = await savePageData(url, [a, el('from-b')], 'S', undefined, base);
      expect(tabB.mergedRemote).toBe(false);

      const tabA = await savePageData(url, [a, el('from-a')], 'S', undefined, base);
      expect(tabA.mergedRemote).toBe(true);
      expect(tabA.data!.elements.map((e) => e.id)).toEqual(['a', 'from-b', 'from-a']);
      expect(tabA.data!.updatedAt).toBeGreaterThan(tabB.data!.updatedAt);
      expect((await loadPageData(url))!.elements.map((e) => e.id)).toEqual(['a', 'from-b', 'from-a']);
    });

    it('skips the write when merging leaves storage unchanged', async () => {
      const url = 'https://example.com/noop';
      const a = el('a');
      const first = await savePageData(url, [a], 'S');
      const other = await savePageData(url, [a, el('b')], 'S');
      const stale = await savePageData(url, [a], 'S', undefined, { elements: [a], stamp: first.data!.updatedAt });
      expect(stale.wrote).toBe(false);
      expect(stale.data!.updatedAt).toBe(other.data!.updatedAt);
    });

    it('serializes concurrent saves so no index entry is lost', async () => {
      await Promise.all(
        Array.from({ length: 8 }, (_, i) => savePageData(`https://example.com/p${i}`, [el(`e${i}`)], `P${i}`))
      );
      expect(Object.keys(mockStore['page_anchor_index'])).toHaveLength(8);
    });

    it('rebuilds missing index entries and drops entries whose data is gone', async () => {
      mockStore['page_anchor_data:https://example.com/kept'] = {
        url: 'https://example.com/kept', normalizedUrl: 'https://example.com/kept', pageTitle: 'Kept', updatedAt: 5, elements: [el('k')],
      };
      mockStore['page_anchor_index'] = {
        'https://example.com/gone': { normalizedUrl: 'https://example.com/gone', url: '', pageTitle: 'Gone', updatedAt: 1, elementCount: 1 },
      };
      const summary = await getAllSavedPagesSummary();
      expect(summary.map((s) => s.pageTitle)).toEqual(['Kept']);
      await new Promise((r) => setTimeout(r, 0));
      expect(Object.keys(mockStore['page_anchor_index'])).toEqual(['https://example.com/kept']);
    });

    it('re-keys and merges saved pages when the URL match mode changes', async () => {
      await savePageData('https://example.com/a', [el('a1'), el('shared')], 'A');
      await new Promise((r) => setTimeout(r, 2));
      await savePageData('https://example.com/b?x=1', [el('b1'), el('shared')], 'B');

      await saveSettings({ urlMatchMode: 'domain' });

      const keys = Object.keys(mockStore).filter((k) => k.startsWith('page_anchor_data:'));
      expect(keys).toEqual(['page_anchor_data:https://example.com']);
      const merged = mockStore['page_anchor_data:https://example.com'];
      expect(merged.elements.map((e: any) => e.id).sort()).toEqual(['a1', 'b1', 'shared']);
      expect(merged.pageTitle).toBe('B');
      expect(Object.keys(mockStore['page_anchor_index'])).toEqual(['https://example.com']);
      expect((await loadPageData('https://example.com/anything'))?.elements).toHaveLength(3);
    });

    it('re-keys pages saved under older clean-mode rules', async () => {
      mockStore['page_anchor_data:https://example.com/docs/'] = {
        url: 'https://example.com/docs/', normalizedUrl: 'https://example.com/docs/', pageTitle: 'Docs', updatedAt: 1, elements: [el('d')],
      };
      await rekeySavedPages();
      expect(mockStore['page_anchor_data:https://example.com/docs/']).toBeUndefined();
      expect((await loadPageData('https://example.com/docs'))?.elements).toHaveLength(1);
    });

    it('merges an imported index with the current one instead of replacing it', async () => {
      await savePageData('https://example.com/local', [el('l')], 'Local');
      const backup = JSON.stringify({
        page_anchor_index: {
          'https://example.com/imported': { normalizedUrl: 'https://example.com/imported', url: 'https://example.com/imported', pageTitle: 'Imported', updatedAt: 2, elementCount: 1 },
        },
        'page_anchor_data:https://example.com/imported': {
          url: 'https://example.com/imported', normalizedUrl: 'https://example.com/imported', pageTitle: 'Imported', updatedAt: 2, elements: [el('i')],
        },
        page_anchor_unknown_thing: { foo: 1 },
      });
      expect(await importDataFromJson(backup)).toBe(true);
      const titles = (await getAllSavedPagesSummary()).map((s) => s.pageTitle).sort();
      expect(titles).toEqual(['Imported', 'Local']);
      expect(mockStore.page_anchor_unknown_thing).toBeUndefined();
    });

    it('exposes the storage key used for a page under a given mode', () => {
      expect(getPageStorageKey('https://example.com/x/#top', 'clean')).toBe('page_anchor_data:https://example.com/x');
    });
  });
});

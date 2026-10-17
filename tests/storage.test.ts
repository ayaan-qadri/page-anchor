import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearPageData,
  exportAllDataAsJson,
  getAllSavedPagesSummary,
  importDataFromJson,
  isSafeHttpUrl,
  loadPageData,
  loadSettings,
  normalizeUrl,
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
          get: (keys: any, cb: (res: any) => void) => {
            if (keys === null) {
              cb({ ...mockStore });
            } else if (typeof keys === 'string') {
              cb({ [keys]: mockStore[keys] });
            } else {
              cb({ ...mockStore });
            }
          },
          set: (items: Record<string, any>, cb?: () => void) => {
            Object.assign(mockStore, items);
            cb?.();
          },
          remove: (key: string, cb?: () => void) => {
            delete mockStore[key];
            cb?.();
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
  });
});

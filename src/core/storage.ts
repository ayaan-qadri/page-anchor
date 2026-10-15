import {
  AnchorElement,
  ExtensionSettings,
  PageAnchorData,
  PageMetadataSummary,
} from './types';
import { DEFAULT_SHORTCUTS } from './shortcuts';

export { DEFAULT_SHORTCUTS };

export const DEFAULT_SETTINGS: ExtensionSettings = {
  shortcuts: DEFAULT_SHORTCUTS,
  defaultStrokeColor: '#ef4444', // vibrant red
  defaultStrokeWidth: 4,
  defaultHighlighterColor: '#facc15', // vibrant yellow
  defaultHighlighterWidth: 20,
  defaultFontSize: 18,
  urlMatchMode: 'clean',
  performanceMode: true,
  toolbarPosition: null,
  isToolbarOpen: false, // Minimized by default so it never intrudes on page load/reload!
  showFloatingPill: true,
  areAnnotationsVisible: true,
};

const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'mc_eid',
  'ref',
  'source',
]);

/**
 * Normalizes URL according to user settings (stripping trackers, hashes, etc.)
 */
export function normalizeUrl(
  rawUrl: string,
  mode: 'clean' | 'exact' | 'domain' = 'clean'
): string {
  try {
    const parsed = new URL(rawUrl);

    if (mode === 'domain') {
      return parsed.origin;
    }

    if (mode === 'exact') {
      return parsed.href;
    }

    // Default 'clean' mode:
    // Remove query tracking params
    const keysToRemove: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.startsWith('utm_')) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach((k) => parsed.searchParams.delete(k));

    // Sort remaining search params for canonical key
    parsed.searchParams.sort();

    // Strip in-page scroll anchors (#section-2)
    parsed.hash = '';

    return parsed.href;
  } catch {
    return rawUrl;
  }
}

function getStorageKey(normalizedUrl: string): string {
  return `page_anchor_data:${normalizedUrl}`;
}

const INDEX_KEY = 'page_anchor_index';
const SETTINGS_KEY = 'page_anchor_settings';

/**
 * Safely accesses storage across Chrome, Edge, Firefox, and Safari.
 */
function getStorage(): any {
  if (typeof browser !== 'undefined' && (browser as any)?.storage?.local) {
    return (browser as any).storage.local;
  }
  if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
    return chrome.storage.local;
  }
  return null;
}

function hasRuntimeError(): boolean {
  if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) return true;
  if (typeof browser !== 'undefined' && (browser as any)?.runtime?.lastError) return true;
  return false;
}

function getRuntimeError(): any {
  if (typeof chrome !== 'undefined' && chrome.runtime?.lastError) return chrome.runtime.lastError;
  if (typeof browser !== 'undefined' && (browser as any)?.runtime?.lastError) return (browser as any).runtime.lastError;
  return null;
}

async function storageGet(key: string | null): Promise<Record<string, any> | null> {
  const storage = getStorage();
  if (!storage) return null;
  return new Promise((resolve) => {
    try {
      const res = storage.get(key as any, (data: any) => {
        if (hasRuntimeError()) resolve(null);
        else resolve(data || null);
      });
      if (res && typeof (res as any).then === 'function') {
        (res as Promise<any>).then((data) => resolve(data || null)).catch(() => resolve(null));
      }
    } catch {
      resolve(null);
    }
  });
}

async function storageSet(data: Record<string, any>): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  return new Promise((resolve, reject) => {
    try {
      const res = storage.set(data, () => {
        if (hasRuntimeError()) reject(getRuntimeError());
        else resolve();
      });
      if (res && typeof (res as any).then === 'function') {
        (res as Promise<any>).then(resolve).catch(reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

async function storageRemove(key: string): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  return new Promise((resolve, reject) => {
    try {
      const res = storage.remove(key, () => {
        if (hasRuntimeError()) reject(getRuntimeError());
        else resolve();
      });
      if (res && typeof (res as any).then === 'function') {
        (res as Promise<any>).then(resolve).catch(reject);
      }
    } catch (e) {
      reject(e);
    }
  });
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const result = await storageGet(SETTINGS_KEY);
  const stored = result?.[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
  if (!stored) return DEFAULT_SETTINGS;

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    shortcuts: {
      ...DEFAULT_SETTINGS.shortcuts,
      ...(stored.shortcuts || {}),
    },
  };
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  const current = await loadSettings();
  const merged = { ...current, ...settings };
  await storageSet({ [SETTINGS_KEY]: merged });
}

export async function loadPageData(rawUrl: string): Promise<PageAnchorData | null> {
  const settings = await loadSettings();
  const normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
  const key = getStorageKey(normalized);
  const res = await storageGet(key);
  return (res?.[key] as PageAnchorData) || null;
}

export async function savePageData(
  rawUrl: string,
  elements: AnchorElement[],
  pageTitle: string
): Promise<void> {
  const settings = await loadSettings();
  const normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
  const key = getStorageKey(normalized);

  if (elements.length === 0) {
    await clearPageData(rawUrl);
    return;
  }

  const data: PageAnchorData = {
    url: rawUrl,
    normalizedUrl: normalized,
    pageTitle: pageTitle || (typeof document !== 'undefined' ? document.title : '') || rawUrl,
    updatedAt: Date.now(),
    elements,
  };

  await storageSet({ [key]: data });
  await updateIndexEntry({
    normalizedUrl: normalized,
    url: rawUrl,
    pageTitle: data.pageTitle,
    updatedAt: data.updatedAt,
    elementCount: elements.length,
  });
}

export async function clearPageData(rawUrl: string): Promise<void> {
  const settings = await loadSettings();
  const normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
  const key = getStorageKey(normalized);

  await storageRemove(key);
  await removeIndexEntry(normalized);
}

async function updateIndexEntry(entry: PageMetadataSummary): Promise<void> {
  const res = await storageGet(INDEX_KEY);
  const index = (res?.[INDEX_KEY] || {}) as Record<string, PageMetadataSummary>;
  index[entry.normalizedUrl] = entry;
  await storageSet({ [INDEX_KEY]: index });
}

async function removeIndexEntry(normalizedUrl: string): Promise<void> {
  const res = await storageGet(INDEX_KEY);
  const index = (res?.[INDEX_KEY] || {}) as Record<string, PageMetadataSummary>;
  if (index[normalizedUrl]) {
    delete index[normalizedUrl];
    await storageSet({ [INDEX_KEY]: index });
  }
}

export async function getAllSavedPagesSummary(): Promise<PageMetadataSummary[]> {
  const res = await storageGet(INDEX_KEY);
  const index = (res?.[INDEX_KEY] || {}) as Record<string, PageMetadataSummary>;
  const list = Object.values(index);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  return list;
}

export async function exportAllDataAsJson(): Promise<string> {
  const allData = await storageGet(null);
  return JSON.stringify(allData || {}, null, 2);
}

export async function importDataFromJson(jsonStr: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(jsonStr);
    await storageSet(parsed);
    return true;
  } catch {
    return false;
  }
}

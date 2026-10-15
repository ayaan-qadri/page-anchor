import {
  AnchorElement,
  ExtensionSettings,
  PageAnchorData,
  PageMetadataSummary,
  ShortcutAction,
} from './types';

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  'toggle-active': 'Alt+D',
  'tool-select': 'v',
  'tool-pen': 'p',
  'tool-highlighter': 'h',
  'tool-rect': 'r',
  'tool-circle': 'c',
  'tool-line': 'l',
  'tool-arrow': 'a',
  'tool-text': 't',
  'tool-eraser': 'e',
  'action-undo': 'Ctrl+z',
  'action-redo': 'Ctrl+y',
  'action-clear': 'Ctrl+Alt+k',
  'action-export': 'Ctrl+Alt+e',
  'action-toggle-toolbar': 'Alt+t',
};

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
function getStorage(): chrome.storage.StorageArea | null {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }
  if (typeof browser !== 'undefined' && (browser as any).storage && (browser as any).storage.local) {
    return (browser as any).storage.local;
  }
  return null;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const storage = getStorage();
  if (!storage) return DEFAULT_SETTINGS;

  return new Promise((resolve) => {
    storage.get(SETTINGS_KEY, (result: Record<string, any>) => {
      const stored = result?.[SETTINGS_KEY] as Partial<ExtensionSettings> | undefined;
      if (chrome.runtime.lastError || !stored) {
        resolve(DEFAULT_SETTINGS);
      } else {
        resolve({
          ...DEFAULT_SETTINGS,
          ...stored,
          shortcuts: {
            ...DEFAULT_SETTINGS.shortcuts,
            ...(stored.shortcuts || {}),
          },
        });
      }
    });
  });
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  const storage = getStorage();
  if (!storage) return;

  const current = await loadSettings();
  const merged = { ...current, ...settings };

  return new Promise((resolve, reject) => {
    storage.set({ [SETTINGS_KEY]: merged }, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}

export async function loadPageData(rawUrl: string): Promise<PageAnchorData | null> {
  const storage = getStorage();
  if (!storage) return null;

  const settings = await loadSettings();
  const normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
  const key = getStorageKey(normalized);

  return new Promise((resolve) => {
    storage.get(key, (res) => {
      if (chrome.runtime.lastError || !res || !res[key]) {
        resolve(null);
      } else {
        resolve(res[key] as PageAnchorData);
      }
    });
  });
}

export async function savePageData(
  rawUrl: string,
  elements: AnchorElement[],
  pageTitle: string
): Promise<void> {
  const storage = getStorage();
  if (!storage) return;

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
    pageTitle: pageTitle || document.title || rawUrl,
    updatedAt: Date.now(),
    elements,
  };

  return new Promise((resolve, reject) => {
    storage.set({ [key]: data }, async () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      // Update global index
      await updateIndexEntry({
        normalizedUrl: normalized,
        url: rawUrl,
        pageTitle: data.pageTitle,
        updatedAt: data.updatedAt,
        elementCount: elements.length,
      });
      resolve();
    });
  });
}

export async function clearPageData(rawUrl: string): Promise<void> {
  const storage = getStorage();
  if (!storage) return;

  const settings = await loadSettings();
  const normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
  const key = getStorageKey(normalized);

  return new Promise((resolve, reject) => {
    storage.remove(key, async () => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
        return;
      }
      await removeIndexEntry(normalized);
      resolve();
    });
  });
}

async function updateIndexEntry(entry: PageMetadataSummary): Promise<void> {
  const storage = getStorage();
  if (!storage) return;

  return new Promise((resolve) => {
    storage.get(INDEX_KEY, (res: Record<string, any>) => {
      const index = (res?.[INDEX_KEY] || {}) as Record<string, PageMetadataSummary>;
      index[entry.normalizedUrl] = entry;
      storage.set({ [INDEX_KEY]: index }, () => resolve());
    });
  });
}

async function removeIndexEntry(normalizedUrl: string): Promise<void> {
  const storage = getStorage();
  if (!storage) return;

  return new Promise((resolve) => {
    storage.get(INDEX_KEY, (res: Record<string, any>) => {
      const index = (res?.[INDEX_KEY] || {}) as Record<string, PageMetadataSummary>;
      if (index[normalizedUrl]) {
        delete index[normalizedUrl];
        storage.set({ [INDEX_KEY]: index }, () => resolve());
      } else {
        resolve();
      }
    });
  });
}

export async function getAllSavedPagesSummary(): Promise<PageMetadataSummary[]> {
  const storage = getStorage();
  if (!storage) return [];

  return new Promise((resolve) => {
    storage.get(INDEX_KEY, (res: Record<string, any>) => {
      const index = (res?.[INDEX_KEY] || {}) as Record<string, PageMetadataSummary>;
      const list = Object.values(index);
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(list);
    });
  });
}

export async function exportAllDataAsJson(): Promise<string> {
  const storage = getStorage();
  if (!storage) return '{}';

  return new Promise((resolve) => {
    storage.get(null, (allData: Record<string, any>) => {
      resolve(JSON.stringify(allData, null, 2));
    });
  });
}

export async function importDataFromJson(jsonStr: string): Promise<boolean> {
  const storage = getStorage();
  if (!storage) return false;

  try {
    const parsed = JSON.parse(jsonStr);
    return new Promise((resolve) => {
      storage.set(parsed, () => {
        resolve(!chrome.runtime.lastError);
      });
    });
  } catch {
    return false;
  }
}

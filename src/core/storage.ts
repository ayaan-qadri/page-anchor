import { AnchorElement, DOMAnchor } from '../types/engine.types';
import {
  ExtensionSettings,
  PageAnchorData,
  PageMetadataSummary,
  UrlMatchMode,
} from '../types/storage.types';
import { computeBoundingBox } from './geometry';
import { DEFAULT_SHORTCUTS } from './shortcuts';

export type { ExtensionSettings, PageAnchorData, PageMetadataSummary, UrlMatchMode };
export { DEFAULT_SHORTCUTS };

export const DEFAULT_SETTINGS: ExtensionSettings = {
  shortcuts: DEFAULT_SHORTCUTS,
  defaultStrokeColor: '#ef4444',
  defaultStrokeWidth: 4,
  defaultHighlighterColor: '#facc15',
  defaultHighlighterWidth: 20,
  defaultFontSize: 18,
  urlMatchMode: 'clean',
  strokeSimplification: true,
  toolbarPosition: null,
  isToolbarOpen: false,
  showFloatingPill: true,
  areAnnotationsVisible: true,
  domAnchoringEnabled: true,
  orphanedAnchorMode: 'hide',
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

    const keysToRemove: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.startsWith('utm_')) {
        keysToRemove.push(key);
      }
    });
    keysToRemove.forEach((k) => parsed.searchParams.delete(k));

    parsed.searchParams.sort();
    parsed.hash = '';

    return parsed.href;
  } catch {
    return rawUrl;
  }
}

/** Namespace owning every key; also the backup export/import allowlist. */
const STORAGE_NAMESPACE = 'page_anchor_';

const INDEX_KEY = `${STORAGE_NAMESPACE}index`;
const SETTINGS_KEY = `${STORAGE_NAMESPACE}settings`;
const DATA_KEY_PREFIX = `${STORAGE_NAMESPACE}data:`;

function getStorageKey(normalizedUrl: string): string {
  return `${DATA_KEY_PREFIX}${normalizedUrl}`;
}

/**
 * True only for absolute `http:`/`https:` URLs. Stored URLs can originate from
 * an untrusted backup, so a `javascript:`/`data:` value must never reach an href.
 */
export function isSafeHttpUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const { protocol } = new URL(raw);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

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

/**
 * Applies setting-key renames from older schema versions so stored preferences
 * survive upgrades. `performanceMode` used to bundle viewport culling (now
 * always on) with stroke simplification, so its value now maps to the latter.
 */
function migrateSettings(stored: Record<string, any>): Record<string, any> {
  const migrated = { ...stored };
  if (
    migrated.strokeSimplification === undefined &&
    typeof migrated.performanceMode === 'boolean'
  ) {
    migrated.strokeSimplification = migrated.performanceMode;
  }
  delete migrated.performanceMode;
  return migrated;
}

export async function loadSettings(): Promise<ExtensionSettings> {
  const result = await storageGet(SETTINGS_KEY);
  const stored = result?.[SETTINGS_KEY] as Record<string, any> | undefined;
  if (!stored) {
    return {
      ...DEFAULT_SETTINGS,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts },
    };
  }

  const migrated = migrateSettings(stored);
  return {
    ...DEFAULT_SETTINGS,
    ...migrated,
    shortcuts: {
      ...DEFAULT_SETTINGS.shortcuts,
      ...(migrated.shortcuts || {}),
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
  pageTitle: string,
  domAnchoringEnabled?: boolean
): Promise<void> {
  const settings = await loadSettings();
  const normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
  const key = getStorageKey(normalized);

  if (elements.length === 0) {
    await clearPageData(rawUrl, normalized);
    return;
  }

  const existing = await storageGet(key);
  const existingData = existing?.[key] as PageAnchorData | undefined;

  const data: PageAnchorData = {
    url: rawUrl,
    normalizedUrl: normalized,
    pageTitle: pageTitle || (typeof document !== 'undefined' ? document.title : '') || rawUrl,
    updatedAt: Date.now(),
    elements,
    domAnchoringEnabled: domAnchoringEnabled !== undefined ? domAnchoringEnabled : existingData?.domAnchoringEnabled,
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

export async function clearPageData(rawUrl: string, knownNormalizedUrl?: string): Promise<void> {
  let normalized = knownNormalizedUrl;
  if (!normalized) {
    const settings = await loadSettings();
    normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
  }
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

/** Upper bound on an imported backup, to bound parsing cost and storage writes. */
const MAX_BACKUP_CHARS = 5_000_000;

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Serializes only the extension's own namespaced keys, so backups round-trip. */
export async function exportAllDataAsJson(): Promise<string> {
  const allData = (await storageGet(null)) || {};
  const owned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith(STORAGE_NAMESPACE)) owned[key] = value;
  }
  return JSON.stringify(owned, null, 2);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function num(value: unknown, fallback = 0): number {
  return isFiniteNumber(value) ? value : fallback;
}

function isPoint(value: unknown): boolean {
  return isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function sanitizeAnchor(raw: unknown): DOMAnchor | undefined {
  if (!isPlainObject(raw) || typeof raw.selector !== 'string' || !isPlainObject(raw.initialRect)) {
    return undefined;
  }
  const rect = raw.initialRect;
  return {
    selector: raw.selector,
    fallbackSelectors: Array.isArray(raw.fallbackSelectors)
      ? raw.fallbackSelectors.filter((s): s is string => typeof s === 'string')
      : undefined,
    textQuote:
      isPlainObject(raw.textQuote) && typeof raw.textQuote.exact === 'string'
        ? { exact: raw.textQuote.exact }
        : undefined,
    initialRect: {
      left: num(rect.left),
      top: num(rect.top),
      width: num(rect.width),
      height: num(rect.height),
    },
  };
}

function sanitizeElement(raw: unknown): AnchorElement | null {
  if (!isPlainObject(raw) || typeof raw.id !== 'string') return null;

  const base = {
    id: raw.id,
    strokeColor: typeof raw.strokeColor === 'string' ? raw.strokeColor : '#ef4444',
    strokeWidth: num(raw.strokeWidth, 2),
    opacity: num(raw.opacity, 1),
    createdAt: num(raw.createdAt),
    anchor: sanitizeAnchor(raw.anchor),
  };

  const type = raw.type;
  if (type === 'pen' || type === 'highlighter') {
    const element = {
      ...base,
      type,
      points: Array.isArray(raw.points) ? raw.points.filter(isPoint) : [],
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    } as AnchorElement;
    element.bbox = computeBoundingBox(element);
    return element;
  }
  if (type === 'text') {
    if (typeof raw.text !== 'string') return null;
    const element = {
      ...base,
      type,
      x: num(raw.x),
      y: num(raw.y),
      text: raw.text,
      fontSize: num(raw.fontSize, 18),
      fontColor: typeof raw.fontColor === 'string' ? raw.fontColor : '#ffffff',
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    } as AnchorElement;
    element.bbox = computeBoundingBox(element);
    return element;
  }
  if (
    type === 'rect' ||
    type === 'circle' ||
    type === 'line' ||
    type === 'arrow' ||
    type === 'double-arrow'
  ) {
    const element = {
      ...base,
      type,
      startX: num(raw.startX),
      startY: num(raw.startY),
      endX: num(raw.endX),
      endY: num(raw.endY),
      bbox: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
    } as AnchorElement;
    element.bbox = computeBoundingBox(element);
    return element;
  }
  return null;
}

function sanitizePageData(raw: Record<string, any>): PageAnchorData {
  return {
    url: typeof raw.url === 'string' ? raw.url : '',
    normalizedUrl: typeof raw.normalizedUrl === 'string' ? raw.normalizedUrl : '',
    pageTitle: typeof raw.pageTitle === 'string' ? raw.pageTitle : '',
    updatedAt: num(raw.updatedAt),
    elements: Array.isArray(raw.elements)
      ? raw.elements.map(sanitizeElement).filter((e): e is AnchorElement => e !== null)
      : [],
    domAnchoringEnabled: typeof raw.domAnchoringEnabled === 'boolean' ? raw.domAnchoringEnabled : undefined,
  };
}

function sanitizeSettings(raw: Record<string, any>): Record<string, any> {
  const shortcuts: Record<string, string> = {};
  if (isPlainObject(raw.shortcuts)) {
    for (const [action, key] of Object.entries(raw.shortcuts)) {
      if (typeof key === 'string') shortcuts[action] = key;
    }
  }
  return { ...migrateSettings(raw), shortcuts };
}

function sanitizeIndex(raw: Record<string, any>): Record<string, PageMetadataSummary> {
  const index: Record<string, PageMetadataSummary> = {};
  for (const [normalizedUrl, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) continue;
    index[normalizedUrl] = {
      normalizedUrl: typeof entry.normalizedUrl === 'string' ? entry.normalizedUrl : normalizedUrl,
      url: typeof entry.url === 'string' ? entry.url : '',
      pageTitle: typeof entry.pageTitle === 'string' ? entry.pageTitle : '',
      updatedAt: num(entry.updatedAt),
      elementCount: num(entry.elementCount),
    };
  }
  return index;
}

/**
 * Restores a backup from `exportAllDataAsJson`. The file is untrusted, so it is
 * validated before anything is written; `false` means "invalid backup format".
 */
export async function importDataFromJson(jsonStr: string): Promise<boolean> {
  if (typeof jsonStr !== 'string' || jsonStr.length === 0 || jsonStr.length > MAX_BACKUP_CHARS) {
    return false;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return false;
  }

  if (!isPlainObject(parsed)) return false;

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!key.startsWith(STORAGE_NAMESPACE) || !isPlainObject(value)) continue;
    if (key === SETTINGS_KEY) sanitized[key] = sanitizeSettings(value);
    else if (key === INDEX_KEY) sanitized[key] = sanitizeIndex(value);
    else if (key.startsWith(DATA_KEY_PREFIX)) sanitized[key] = sanitizePageData(value);
    else sanitized[key] = value;
  }

  if (Object.keys(sanitized).length === 0) return false;

  try {
    await storageSet(sanitized);
  } catch {
    return false;
  }
  return true;
}

import { AnchorElement, DOMAnchor, ToolType } from '../types/engine.types';
import {
  ExtensionSettings,
  PageAnchorData,
  PageMetadataSummary,
  UrlMatchMode,
} from '../types/storage.types';
import { computeBoundingBox, isShapeType } from './geometry';
import { getExtensionApi } from './inject';
import { MAX_DELETED_IDS, mergeDeletedIds, mergePageElements, sameElements } from './merge';
import {
  DATA_KEY_PREFIX,
  INDEX_KEY,
  SETTINGS_STORAGE_KEY,
  STORAGE_CHANGED_MESSAGE,
  STORAGE_NAMESPACE,
  getPageStorageKey,
  getStorageKey,
  normalizeUrl,
  type StorageChangedMessage,
} from './page-key';
import { DEFAULT_SHORTCUTS, canonicalizeShortcut } from './shortcuts';

export type { ExtensionSettings, PageAnchorData, PageMetadataSummary, UrlMatchMode };
export { DEFAULT_SHORTCUTS, SETTINGS_STORAGE_KEY, STORAGE_CHANGED_MESSAGE, getPageStorageKey, normalizeUrl };
export type { StorageChangedMessage };

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
  areAnnotationsVisible: true,
  domAnchoringEnabled: true,
  orphanedAnchorMode: 'hide',
};

const SETTINGS_KEY = SETTINGS_STORAGE_KEY;

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

type StoredItems = Record<string, unknown>;

function getStorageArea() {
  return getExtensionApi()?.storage?.local ?? null;
}

/** Rejects on failure so callers never mistake a failed read for "nothing stored". */
async function storageGet(key: string | null): Promise<StoredItems> {
  const area = getStorageArea();
  if (!area) return {};
  const result: StoredItems | undefined = await area.get(key);
  return result ?? {};
}

let localRelay: ((keys: string[]) => void) | null = null;

/** The background cannot message itself, so it relays its own writes directly. */
export function setStorageChangeRelay(relay: (keys: string[]) => void): void {
  localRelay = relay;
}

/** storage.onChanged would hand every tab the full old and new value of each write, which costs every open tab hundreds of ms for a large page, so tabs get key names only. */
function announceChange(keys: string[]): void {
  if (localRelay) {
    localRelay(keys);
    return;
  }
  const message: StorageChangedMessage = { type: STORAGE_CHANGED_MESSAGE, keys };
  try {
    const sent = getExtensionApi()?.runtime.sendMessage(message);
    if (sent && typeof sent.catch === 'function') sent.catch(() => {});
  } catch {}
}

async function storageSet(data: StoredItems): Promise<void> {
  const area = getStorageArea();
  if (!area) return;
  await area.set(data);
  announceChange(Object.keys(data));
}

async function storageRemove(keys: string | string[]): Promise<void> {
  const area = getStorageArea();
  if (!area) return;
  await area.remove(keys);
  announceChange(Array.isArray(keys) ? keys : [keys]);
}

let writeChain: Promise<unknown> = Promise.resolve();

/** Serializes this context's read-modify-write cycles so they cannot interleave. */
function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task);
  writeChain = run.catch(() => {});
  return run;
}

/**
 * Applies setting-key renames from older schema versions so stored preferences
 * survive upgrades. `performanceMode` used to bundle viewport culling (now
 * always on) with stroke simplification, so its value now maps to the latter.
 */
function migrateSettings(stored: StoredItems): StoredItems {
  const migrated = { ...stored };
  if (
    migrated.strokeSimplification === undefined &&
    typeof migrated.performanceMode === 'boolean'
  ) {
    migrated.strokeSimplification = migrated.performanceMode;
  }
  delete migrated.performanceMode;
  // The toolbar never opens by itself on page load, so neither the old live state nor the old preference applies.
  delete migrated.isToolbarOpen;
  delete migrated.keepToolbarOpen;
  return migrated;
}

/**
 * Collapses legacy modifier tokens in every stored binding onto the neutral
 * `Mod`, so shortcuts recorded before the cross-platform rename keep matching.
 */
function canonicalizeShortcuts(shortcuts: StoredItems): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [action, key] of Object.entries(shortcuts)) {
    if (typeof key === 'string') out[action] = canonicalizeShortcut(key);
  }
  return out;
}

export function settingsFromStored(stored: unknown): ExtensionSettings {
  if (!isPlainObject(stored)) {
    return {
      ...DEFAULT_SETTINGS,
      shortcuts: { ...DEFAULT_SETTINGS.shortcuts },
    };
  }

  const migrated = migrateSettings(stored);
  const storedShortcuts = isPlainObject(migrated.shortcuts) ? migrated.shortcuts : {};
  return {
    ...DEFAULT_SETTINGS,
    ...migrated,
    shortcuts: canonicalizeShortcuts({
      ...DEFAULT_SETTINGS.shortcuts,
      ...storedShortcuts,
    }),
  } as ExtensionSettings;
}

async function readSettings(): Promise<ExtensionSettings> {
  const result = await storageGet(SETTINGS_KEY);
  return settingsFromStored(result[SETTINGS_KEY]);
}

/** Display-oriented read: falls back to defaults when storage is unavailable. Writes use `readSettings`. */
export async function loadSettings(): Promise<ExtensionSettings> {
  try {
    return await readSettings();
  } catch {
    return settingsFromStored(undefined);
  }
}

export async function saveSettings(settings: Partial<ExtensionSettings>): Promise<void> {
  return enqueueWrite(async () => {
    const current = await readSettings();
    if (settings.urlMatchMode && settings.urlMatchMode !== current.urlMatchMode) {
      await rekeyPages(settings.urlMatchMode);
    }
    const merged = { ...current, ...settings };
    await storageSet({ [SETTINGS_KEY]: merged });
  });
}

export async function loadPageData(rawUrl: string): Promise<PageAnchorData | null> {
  const settings = await readSettings();
  const key = getPageStorageKey(rawUrl, settings.urlMatchMode);
  const res = await storageGet(key);
  return (res[key] as PageAnchorData | undefined) || null;
}

/** Resolves with what was written, or `null` when the page was emptied and its key removed. */
/** The stored version a tab's drawings derive from; `stamp` is its `updatedAt`, or null when nothing was stored. */
export interface SyncBase {
  elements: readonly AnchorElement[];
  stamp: number | null;
}

export interface SaveResult {
  /** What storage now holds for the page, or null when it holds nothing. */
  data: PageAnchorData | null;
  /** True when another tab's changes were folded in, so the caller should show `data` instead of its own state. */
  mergedRemote: boolean;
  /** False when storage already matched and nothing was written. */
  wrote: boolean;
}

export async function savePageData(
  rawUrl: string,
  elements: AnchorElement[],
  pageTitle: string,
  domAnchoringEnabled?: boolean,
  base?: SyncBase,
  /** Set when this tab has no edits of its own: storage is only touched if another tab's save needs folding in. */
  onlyIfRemoteMoved = false
): Promise<SaveResult> {
  return enqueueWrite(async () => {
    const settings = await readSettings();
    const normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
    const key = getStorageKey(normalized);

    const existing = await storageGet(key);
    const existingData = existing[key] as PageAnchorData | undefined;
    const remoteMoved = base !== undefined && (existingData?.updatedAt ?? null) !== base.stamp;
    if (onlyIfRemoteMoved && !remoteMoved) return { data: existingData ?? null, mergedRemote: false, wrote: false };

    const remoteElements = existingData?.elements ?? [];
    const remoteDeleted = existingData?.deletedIds ?? [];
    const next = remoteMoved ? mergePageElements(base.elements, elements, existingData ? remoteElements : null, remoteDeleted) : elements;
    const deletedIds = base ? mergeDeletedIds(base.elements, elements, remoteDeleted) : remoteDeleted;
    const mergedRemote = remoteMoved && !sameElements(next, elements);
    const anchoring = domAnchoringEnabled !== undefined ? domAnchoringEnabled : existingData?.domAnchoringEnabled;

    if (
      remoteMoved &&
      existingData &&
      sameElements(next, remoteElements) &&
      anchoring === existingData.domAnchoringEnabled &&
      deletedIds.length === remoteDeleted.length
    ) {
      return { data: existingData, mergedRemote, wrote: false };
    }

    if (next.length === 0) {
      if (!existingData) return { data: null, mergedRemote, wrote: false };
      await removePage(normalized);
      return { data: null, mergedRemote, wrote: true };
    }

    const data: PageAnchorData = {
      url: rawUrl,
      normalizedUrl: normalized,
      pageTitle: pageTitle || (typeof document !== 'undefined' ? document.title : '') || rawUrl,
      // Strictly increasing, so a tab can tell its own write from another tab's write in the same millisecond.
      updatedAt: Math.max(Date.now(), (existingData?.updatedAt ?? 0) + 1),
      elements: next,
      domAnchoringEnabled: anchoring,
      ...(deletedIds.length > 0 ? { deletedIds } : {}),
    };

    await storageSet({ [key]: data });
    await updateIndex((index) => {
      index[normalized] = summarize(data);
    });
    return { data, mergedRemote, wrote: true };
  });
}

function summarize(data: PageAnchorData): PageMetadataSummary {
  return {
    normalizedUrl: data.normalizedUrl,
    url: data.url,
    pageTitle: data.pageTitle,
    updatedAt: data.updatedAt,
    elementCount: data.elements.length,
    bytes: measureStoredBytes(data),
  };
}

/** Bytes of the JSON payload, matching how `storage.local` accounts for a value. */
function measureStoredBytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    if (typeof json !== 'string') return 0;
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length;
    return json.length;
  } catch {
    return 0;
  }
}

export async function clearPageData(rawUrl: string, knownNormalizedUrl?: string): Promise<void> {
  return enqueueWrite(async () => {
    let normalized = knownNormalizedUrl;
    if (!normalized) {
      const settings = await readSettings();
      normalized = normalizeUrl(rawUrl, settings.urlMatchMode);
    }
    await removePage(normalized);
  });
}

async function removePage(normalizedUrl: string): Promise<void> {
  await storageRemove(getStorageKey(normalizedUrl));
  await updateIndex((index) => {
    delete index[normalizedUrl];
  });
}

type PageIndex = Record<string, PageMetadataSummary>;

async function readIndex(): Promise<PageIndex> {
  const res = await storageGet(INDEX_KEY);
  const raw = res[INDEX_KEY];
  return isPlainObject(raw) ? (raw as PageIndex) : {};
}

/** Caller must already hold the write chain. Each mutation is idempotent so cross-tab races converge. */
async function updateIndex(mutate: (index: PageIndex) => void): Promise<void> {
  const index = await readIndex();
  const before = JSON.stringify(index);
  mutate(index);
  if (JSON.stringify(index) !== before) {
    await storageSet({ [INDEX_KEY]: index });
  }
}

function isPageData(value: unknown): value is PageAnchorData {
  return isPlainObject(value) && Array.isArray(value.elements);
}

/** Index entries for every stored page, reusing valid existing entries and dropping orphans. */
function reconcileIndex(index: PageIndex, all: StoredItems): PageIndex {
  const out: PageIndex = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(DATA_KEY_PREFIX) || !isPageData(value)) continue;
    const normalizedUrl = key.slice(DATA_KEY_PREFIX.length);
    const existing = index[normalizedUrl];
    if (existing && isPlainObject(existing)) {
      out[normalizedUrl] = {
        ...existing,
        normalizedUrl,
        bytes: typeof existing.bytes === 'number' ? existing.bytes : measureStoredBytes(value),
      };
    } else {
      out[normalizedUrl] = summarize({ ...value, normalizedUrl });
    }
  }
  return out;
}

export async function getAllSavedPagesSummary(): Promise<PageMetadataSummary[]> {
  const all = await storageGet(null);
  const stored = isPlainObject(all[INDEX_KEY]) ? (all[INDEX_KEY] as PageIndex) : {};
  const index = reconcileIndex(stored, all);

  if (JSON.stringify(index) !== JSON.stringify(stored)) {
    enqueueWrite(async () => {
      const fresh = await storageGet(null);
      const freshIndex = isPlainObject(fresh[INDEX_KEY]) ? (fresh[INDEX_KEY] as PageIndex) : {};
      await storageSet({ [INDEX_KEY]: reconcileIndex(freshIndex, fresh) });
    }).catch(() => {});
  }

  const list = Object.values(index);
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  return list;
}

function mergePages(pages: PageAnchorData[], normalizedUrl: string): PageAnchorData {
  const ordered = [...pages].sort((a, b) => (a.updatedAt || 0) - (b.updatedAt || 0));
  const byId = new Map<string, AnchorElement>();
  for (const page of ordered) {
    for (const el of page.elements) byId.set(el.id, el);
  }
  const newest = ordered[ordered.length - 1];
  return { ...newest, normalizedUrl, elements: [...byId.values()] };
}

/** Re-keys every saved page under `mode`, merging pages that now share a key. Caller must already hold the write chain. */
async function rekeyPages(mode: UrlMatchMode): Promise<void> {
  const all = await storageGet(null);
  const groups = new Map<string, { pages: PageAnchorData[]; keys: string[] }>();

  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(DATA_KEY_PREFIX) || !isPageData(value)) continue;
    const source = isSafeHttpUrl(value.url) ? value.url : key.slice(DATA_KEY_PREFIX.length);
    const target = normalizeUrl(source, mode);
    const group = groups.get(target) ?? { pages: [], keys: [] };
    group.pages.push(value);
    group.keys.push(key);
    groups.set(target, group);
  }

  const writes: StoredItems = {};
  const removals = new Set<string>();
  for (const [target, { pages, keys }] of groups) {
    const targetKey = getStorageKey(target);
    if (keys.length === 1 && keys[0] === targetKey) continue;
    writes[targetKey] = mergePages(pages, target);
    keys.forEach((k) => {
      if (k !== targetKey) removals.add(k);
    });
  }

  if (Object.keys(writes).length === 0) return;

  const nextAll: StoredItems = { ...all, ...writes };
  removals.forEach((k) => delete nextAll[k]);
  const previousIndex = isPlainObject(all[INDEX_KEY]) ? (all[INDEX_KEY] as PageIndex) : {};
  const index = reconcileIndex(previousIndex, nextAll);
  for (const target of Object.keys(writes)) {
    index[target.slice(DATA_KEY_PREFIX.length)] = summarize(writes[target] as PageAnchorData);
  }

  await storageSet({ ...writes, [INDEX_KEY]: index });
  if (removals.size > 0) await storageRemove([...removals]);
}

/** Re-keys saved pages under the stored match mode, e.g. after the keying rules changed in an update. */
export async function rekeySavedPages(): Promise<void> {
  return enqueueWrite(async () => {
    const settings = await readSettings();
    await rekeyPages(settings.urlMatchMode);
  });
}

/** Upper bound on an imported backup, to bound parsing cost and storage writes. */
const MAX_BACKUP_CHARS = 5_000_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Serializes only the extension's own namespaced keys, so backups round-trip. */
export async function exportAllDataAsJson(): Promise<string> {
  const allData = await storageGet(null);
  const owned: StoredItems = {};
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
  const textQuote = raw.textQuote;
  return {
    selector: raw.selector,
    fallbackSelectors: Array.isArray(raw.fallbackSelectors)
      ? raw.fallbackSelectors.filter((s): s is string => typeof s === 'string')
      : undefined,
    textQuote:
      isPlainObject(textQuote) && typeof textQuote.exact === 'string'
        ? { exact: textQuote.exact }
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
  if (typeof type === 'string' && isShapeType(type as ToolType)) {
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

function sanitizePageData(raw: Record<string, unknown>): PageAnchorData {
  return {
    url: typeof raw.url === 'string' ? raw.url : '',
    normalizedUrl: typeof raw.normalizedUrl === 'string' ? raw.normalizedUrl : '',
    pageTitle: typeof raw.pageTitle === 'string' ? raw.pageTitle : '',
    updatedAt: num(raw.updatedAt),
    elements: Array.isArray(raw.elements)
      ? raw.elements.map(sanitizeElement).filter((e): e is AnchorElement => e !== null)
      : [],
    domAnchoringEnabled: typeof raw.domAnchoringEnabled === 'boolean' ? raw.domAnchoringEnabled : undefined,
    ...(Array.isArray(raw.deletedIds)
      ? { deletedIds: raw.deletedIds.filter((id): id is string => typeof id === 'string').slice(-MAX_DELETED_IDS) }
      : {}),
  };
}

function sanitizeSettings(raw: Record<string, unknown>): StoredItems {
  const shortcuts: Record<string, string> = {};
  if (isPlainObject(raw.shortcuts)) {
    for (const [action, key] of Object.entries(raw.shortcuts)) {
      if (typeof key === 'string') shortcuts[action] = canonicalizeShortcut(key);
    }
  }
  return { ...migrateSettings(raw), shortcuts };
}

function sanitizeIndex(raw: Record<string, unknown>): PageIndex {
  const index: PageIndex = {};
  for (const [normalizedUrl, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry)) continue;
    index[normalizedUrl] = {
      normalizedUrl: typeof entry.normalizedUrl === 'string' ? entry.normalizedUrl : normalizedUrl,
      url: typeof entry.url === 'string' ? entry.url : '',
      pageTitle: typeof entry.pageTitle === 'string' ? entry.pageTitle : '',
      updatedAt: num(entry.updatedAt),
      elementCount: num(entry.elementCount),
      bytes: isFiniteNumber(entry.bytes) ? entry.bytes : undefined,
    };
  }
  return index;
}

/**
 * Restores a backup from `exportAllDataAsJson`. The file is untrusted, so it is
 * validated before anything is written; `false` means "invalid backup format".
 * Imported pages and index entries are merged over the current ones.
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

  const sanitized: StoredItems = {};
  let importedIndex: PageIndex | null = null;
  for (const [key, value] of Object.entries(parsed)) {
    if (!isPlainObject(value)) continue;
    if (key === SETTINGS_KEY) sanitized[key] = sanitizeSettings(value);
    else if (key === INDEX_KEY) importedIndex = sanitizeIndex(value);
    else if (key.startsWith(DATA_KEY_PREFIX)) sanitized[key] = sanitizePageData(value);
  }

  if (Object.keys(sanitized).length === 0 && importedIndex === null) return false;

  try {
    await enqueueWrite(async () => {
      const current = await storageGet(null);
      const currentIndex = isPlainObject(current[INDEX_KEY]) ? (current[INDEX_KEY] as PageIndex) : {};
      const merged: StoredItems = { ...current, ...sanitized };
      const index = reconcileIndex({ ...currentIndex, ...(importedIndex ?? {}) }, merged);
      await storageSet({ ...sanitized, [INDEX_KEY]: index });

      const importedSettings = sanitized[SETTINGS_KEY];
      const mode = settingsFromStored(importedSettings ?? current[SETTINGS_KEY]).urlMatchMode;
      await rekeyPages(mode);
    });
  } catch {
    return false;
  }
  return true;
}

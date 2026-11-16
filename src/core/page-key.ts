import type { UrlMatchMode } from '../types/storage.types';

// Kept free of heavy imports: the boot script that runs on every page uses this module.

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
]);

/** Hash routers (`#/path`, `#!path`) put the page identity in the fragment. */
function isRouteHash(hash: string): boolean {
  return hash.startsWith('#/') || hash.startsWith('#!');
}

export function normalizeUrl(rawUrl: string, mode: UrlMatchMode = 'clean'): string {
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
    if (!isRouteHash(parsed.hash)) parsed.hash = '';
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    }

    return parsed.href;
  } catch {
    return rawUrl;
  }
}

/** Namespace owning every key; also the backup export/import allowlist. */
export const STORAGE_NAMESPACE = 'page_anchor_';
export const INDEX_KEY = `${STORAGE_NAMESPACE}index`;
export const SETTINGS_STORAGE_KEY = `${STORAGE_NAMESPACE}settings`;
export const DATA_KEY_PREFIX = `${STORAGE_NAMESPACE}data:`;

export function getStorageKey(normalizedUrl: string): string {
  return `${DATA_KEY_PREFIX}${normalizedUrl}`;
}

/** Storage key holding the drawings for `rawUrl` under `mode`. */
export function getPageStorageKey(rawUrl: string, mode: UrlMatchMode): string {
  return getStorageKey(normalizeUrl(rawUrl, mode));
}

/** Sent after every write and relayed by the background to the other tabs, which re-read only keys they display. */
export const STORAGE_CHANGED_MESSAGE = 'PAGE_ANCHOR_STORAGE_CHANGED';

export interface StorageChangedMessage {
  type: typeof STORAGE_CHANGED_MESSAGE;
  keys: string[];
}

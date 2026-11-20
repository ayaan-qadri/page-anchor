import type { ExtensionApi } from './inject';

/** Without it the boot script never runs, so saved drawings stop reappearing on their own; users can withhold it in Firefox, Safari and Chrome. */
export const ALL_SITES = { origins: ['<all_urls>'] };

/** Asked by the page app, which cannot read permissions itself. */
export const SITE_ACCESS_MESSAGE = 'PAGE_ANCHOR_SITE_ACCESS';

/** Kept outside the backup namespace: it records a choice about this browser, not drawings. */
export const SITE_ACCESS_CHOICE_KEY = 'site_access_choice';

/** Left by the background for the settings page when the toolbar sends the user there for one site. */
export const SITE_ACCESS_REQUEST_KEY = 'site_access_request';

export interface SiteAccessResponse {
  granted: boolean;
}

export interface SiteAccessRequest {
  url: string;
}

/** The match pattern for one site's pages; host permissions ignore ports. */
export function siteOrigins(url: string | undefined): { origins: string[] } | null {
  try {
    const { protocol, hostname } = new URL(url ?? '');
    return protocol === 'http:' || protocol === 'https:' ? { origins: [`${protocol}//${hostname}/*`] } : null;
  } catch {
    return null;
  }
}

export function siteName(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/** Errs towards granted, so a browser without the permissions API never nags. */
export async function hasSiteAccess(ext: ExtensionApi, url?: string): Promise<boolean> {
  const permissions = url === undefined ? ALL_SITES : siteOrigins(url);
  if (!permissions) return true;
  try {
    return (await ext.permissions?.contains(permissions)) ?? true;
  } catch {
    return true;
  }
}

/** The user chose to keep access to websites limited, so only the site they are on is worth mentioning. */
export async function keptLimited(ext: ExtensionApi): Promise<boolean> {
  try {
    return (await ext.storage.local.get(SITE_ACCESS_CHOICE_KEY))[SITE_ACCESS_CHOICE_KEY] === 'limited';
  } catch {
    return false;
  }
}

export async function setKeptLimited(ext: ExtensionApi, limited: boolean): Promise<void> {
  if (limited) await ext.storage.local.set({ [SITE_ACCESS_CHOICE_KEY]: 'limited' });
  else await ext.storage.local.remove(SITE_ACCESS_CHOICE_KEY);
}

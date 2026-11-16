import type { PageAnchorData } from '../types/storage.types';

/** What the boot script found and why it is loading the app; both scripts share the extension's isolated world, which pages cannot see. */
export interface BootHandoff {
  openToolbar: boolean;
  data?: PageAnchorData | null;
}

const HANDOFF_KEY = '__pageAnchorBootHandoff';

type HandoffScope = typeof globalThis & { [HANDOFF_KEY]?: BootHandoff };

export function setBootHandoff(handoff: BootHandoff): void {
  (globalThis as HandoffScope)[HANDOFF_KEY] = handoff;
}

export function takeBootHandoff(): BootHandoff | null {
  const scope = globalThis as HandoffScope;
  const handoff = scope[HANDOFF_KEY] ?? null;
  delete scope[HANDOFF_KEY];
  return handoff;
}

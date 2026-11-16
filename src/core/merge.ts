import { AnchorElement } from '../types/engine.types';

/** Deletions are remembered by id so a drawing missing only because two tabs saved at once is restored rather than lost. */
export const MAX_DELETED_IDS = 500;

/**
 * Three-way merge of one page's drawings. `base` is the stored version this tab last synced, `local` is this tab's state, `remote` is what storage holds now (null when the page was removed).
 * Elements are immutable, so `local[i] !== base[i]` means this tab changed it. Local changes and deletions win; other tabs' additions, changes and recorded deletions are kept.
 */
export function mergePageElements(
  base: readonly AnchorElement[],
  local: readonly AnchorElement[],
  remote: readonly AnchorElement[] | null,
  remoteDeletedIds: readonly string[] = []
): AnchorElement[] {
  const baseById = new Map(base.map((el) => [el.id, el]));
  const changedHere = (el: AnchorElement) => el !== baseById.get(el.id);

  // A removed page was cleared or deleted on purpose; only work this tab did since keeps it alive.
  if (remote === null) return local.filter(changedHere);

  const localById = new Map(local.map((el) => [el.id, el]));
  const remoteDeleted = new Set(remoteDeletedIds);
  const remoteIds = new Set<string>();
  const merged: AnchorElement[] = [];

  for (const r of remote) {
    remoteIds.add(r.id);
    const l = localById.get(r.id);
    if (l) merged.push(changedHere(l) ? l : r);
    else if (!baseById.has(r.id)) merged.push(r);
  }

  for (const l of local) {
    if (remoteIds.has(l.id)) continue;
    if (changedHere(l) || !remoteDeleted.has(l.id)) merged.push(l);
  }

  return merged;
}

/** Ids this tab deleted since `base`, appended to what storage already records, newest kept. */
export function mergeDeletedIds(
  base: readonly AnchorElement[],
  local: readonly AnchorElement[],
  remoteDeletedIds: readonly string[] = []
): string[] {
  const localIds = new Set(local.map((el) => el.id));
  const all = new Set(remoteDeletedIds);
  for (const el of base) if (!localIds.has(el.id)) all.add(el.id);
  return [...all].slice(-MAX_DELETED_IDS);
}

export function sameElements(a: readonly AnchorElement[], b: readonly AnchorElement[]): boolean {
  return a.length === b.length && a.every((el, i) => el === b[i]);
}

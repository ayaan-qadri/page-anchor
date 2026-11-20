import { AnchorElement } from './engine.types';
import { ShortcutAction } from './shortcuts.types';

export type UrlMatchMode = 'clean' | 'exact' | 'domain';
export type OrphanedAnchorMode = 'hide' | 'dimmed';

export interface PageAnchorData {
  url: string;
  normalizedUrl: string;
  pageTitle: string;
  updatedAt: number;
  elements: AnchorElement[];
  domAnchoringEnabled?: boolean;
  /** Recently deleted element ids, so concurrent saves from several tabs cannot resurrect or lose drawings. */
  deletedIds?: string[];
}

export interface PageMetadataSummary {
  normalizedUrl: string;
  url: string;
  pageTitle: string;
  updatedAt: number;
  elementCount: number;
  /** Serialized size of the stored page data, in bytes. */
  bytes?: number;
}

export interface ExtensionSettings {
  shortcuts: Record<ShortcutAction, string>;
  defaultStrokeColor: string;
  defaultStrokeWidth: number;
  defaultHighlighterColor: string;
  defaultHighlighterWidth: number;
  defaultFontSize: number;
  urlMatchMode: UrlMatchMode;
  strokeSimplification: boolean;
  toolbarPosition: { x: number; y: number } | null;
  areAnnotationsVisible: boolean;
  domAnchoringEnabled: boolean;
  orphanedAnchorMode: OrphanedAnchorMode;
  /** Set once the user asks to stop seeing the two-finger scroll hint on touch screens. */
  scrollHintDismissed: boolean;
}

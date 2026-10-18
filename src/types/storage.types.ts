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
  isToolbarOpen: boolean;
  isToolbarHidden: boolean;
  areAnnotationsVisible: boolean;
  domAnchoringEnabled: boolean;
  orphanedAnchorMode: OrphanedAnchorMode;
}

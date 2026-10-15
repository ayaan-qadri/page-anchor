import { AnchorElement } from './engine.types';
import { ShortcutAction } from './shortcuts.types';

export type UrlMatchMode = 'clean' | 'exact' | 'domain';

export interface PageAnchorData {
  url: string;
  normalizedUrl: string;
  pageTitle: string;
  updatedAt: number;
  elements: AnchorElement[];
}

export interface PageMetadataSummary {
  normalizedUrl: string;
  url: string;
  pageTitle: string;
  updatedAt: number;
  elementCount: number;
}

export interface ExtensionSettings {
  shortcuts: Record<ShortcutAction, string>;
  defaultStrokeColor: string;
  defaultStrokeWidth: number;
  defaultHighlighterColor: string;
  defaultHighlighterWidth: number;
  defaultFontSize: number;
  urlMatchMode: UrlMatchMode;
  performanceMode: boolean;
  toolbarPosition: { x: number; y: number } | null;
  isToolbarOpen: boolean;
  showFloatingPill: boolean;
  areAnnotationsVisible: boolean;
}

export type ToolType =
  | 'select'
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'circle'
  | 'line'
  | 'arrow'
  | 'double-arrow'
  | 'text'
  | 'eraser';

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface BaseElement {
  id: string;
  type: ToolType;
  bbox: BoundingBox;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  createdAt: number;
}

export interface StrokeElement extends BaseElement {
  type: 'pen' | 'highlighter';
  points: Point[];
  smoothed?: boolean;
}

export interface ShapeElement extends BaseElement {
  type: 'rect' | 'circle' | 'line' | 'arrow' | 'double-arrow';
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  fillColor?: string;
}

export interface TextElement extends BaseElement {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  fontColor: string;
  bgColor?: string;
  width?: number;
  height?: number;
}

export type AnchorElement = StrokeElement | ShapeElement | TextElement;

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

export type ShortcutAction =
  | 'toggle-active'
  | 'tool-select'
  | 'tool-pen'
  | 'tool-highlighter'
  | 'tool-rect'
  | 'tool-circle'
  | 'tool-line'
  | 'tool-arrow'
  | 'tool-text'
  | 'tool-eraser'
  | 'action-undo'
  | 'action-redo'
  | 'action-clear'
  | 'action-export'
  | 'action-toggle-toolbar'
  | 'action-select-all';

export interface ShortcutDefinition {
  id: ShortcutAction;
  name: string;
  description: string;
  defaultKey: string;
}

export interface ExtensionSettings {
  shortcuts: Record<ShortcutAction, string>;
  defaultStrokeColor: string;
  defaultStrokeWidth: number;
  defaultHighlighterColor: string;
  defaultHighlighterWidth: number;
  defaultFontSize: number;
  urlMatchMode: 'clean' | 'exact' | 'domain';
  performanceMode: boolean; // Enables spatial indexing & viewport clipping
  toolbarPosition: { x: number; y: number } | null;
  isToolbarOpen: boolean; // Whether toolbar is open or minimized (persists across reloads)
  showFloatingPill: boolean; // Whether floating anchor pill is shown
  areAnnotationsVisible: boolean; // Whether drawings on page are visible
}

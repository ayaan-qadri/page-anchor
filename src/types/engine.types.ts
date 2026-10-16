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

export interface DOMAnchor {
  selector: string;
  fallbackSelectors?: string[];
  textQuote?: {
    exact: string;
    prefix?: string;
    suffix?: string;
  };
  initialRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface BaseElement {
  id: string;
  type: ToolType;
  bbox: BoundingBox;
  strokeColor: string;
  strokeWidth: number;
  opacity: number;
  createdAt: number;
  anchor?: DOMAnchor;
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

export interface EngineCallbacks {
  onElementsChange?: (elements: AnchorElement[]) => void;
  onSelectionChange?: (selected: AnchorElement | null, selectedList?: AnchorElement[]) => void;
  onTextCreateRequested?: (pt: Point) => void;
  onDomAnchoringToggle?: (enabled: boolean) => void;
}

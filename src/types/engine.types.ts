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
  pressure?: number;
}

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TextQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

/** The word under a small drawing, so the drawing follows that word when its paragraph reflows. */
export interface RangeAnchor extends TextQuote {
  left: number;
  top: number;
}

export interface DOMAnchor {
  selector: string;
  fallbackSelectors?: string[];
  textQuote?: TextQuote;
  initialRect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  /** Lowercase tag name of the anchored element. */
  tag?: string;
  /** Identifying attributes (href, src, aria-label...) used to tell look-alike elements apart. */
  attrs?: Record<string, string>;
  /** Words that set the element apart from its siblings (the "3" in "Comment 3"); an edited look-alike without them is not this element. */
  keywords?: string[];
  range?: RangeAnchor;
  /** The drawing sat inside a scrolling pane, so it is clipped to that pane like the content it marks. */
  scrollClip?: boolean;
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
  onTextCreateRequested?: (pt: Point) => void;
  onDomAnchoringToggle?: (enabled: boolean) => void;
  onSelectionChange?: () => void;
}

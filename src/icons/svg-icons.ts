import {
  Anchor,
  Pencil,
  Highlighter,
  MousePointer2,
  Square,
  Circle,
  Minus,
  ArrowUpRight,
  MoveHorizontal,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  Download,
  Settings,
  Minimize2,
  Maximize2,
  X,
  Check,
  GripVertical,
  Eye,
  EyeOff,
  BoxSelect,
  Pin,
  PinOff,
  type IconNode,
} from 'lucide';

/**
 * Converts a Lucide IconNode (array of [tag, attrs] tuples) into an SVG
 * HTML string. This lets us keep using `innerHTML` throughout the UI while
 * pulling icons from the canonical Lucide package.
 */
function toSvg(
  node: IconNode,
  size: number = 18,
  extraAttrs: Record<string, string> = {},
): string {
  const attrs: Record<string, string | number> = {
    xmlns: 'http://www.w3.org/2000/svg',
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    ...extraAttrs,
  };

  const attrStr = Object.entries(attrs)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');

  const children = node
    .map(([tag, props]) => {
      const propStr = Object.entries(props)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}="${v}"`)
        .join(' ');
      return `<${tag} ${propStr}/>`;
    })
    .join('');

  return `<svg ${attrStr}>${children}</svg>`;
}

/** Drag-handle uses a custom 8×18 viewBox, so we build it with overrides. */
function dragHandleSvg(): string {
  return toSvg(GripVertical, 12, { viewBox: '0 0 24 24', width: '12', height: '18' });
}

export const ICONS: Record<string, string> = {
  // Brand
  anchor: toSvg(Anchor),

  // Drawing tools
  pen: toSvg(Pencil),
  highlighter: toSvg(Highlighter),
  select: toSvg(MousePointer2),
  rect: toSvg(Square),
  circle: toSvg(Circle),
  line: toSvg(Minus),
  arrow: toSvg(ArrowUpRight),
  doubleArrow: toSvg(MoveHorizontal),
  text: toSvg(Type),
  eraser: toSvg(Eraser),

  // Actions
  undo: toSvg(Undo2),
  redo: toSvg(Redo2),
  trash: toSvg(Trash2),
  download: toSvg(Download),
  settings: toSvg(Settings),

  // Visibility / UI
  eye: toSvg(Eye),
  eyeOff: toSvg(EyeOff),
  minimize: toSvg(Minimize2),
  maximize: toSvg(Maximize2),
  close: toSvg(X),
  check: toSvg(Check),
  dragHandle: dragHandleSvg(),
  selectAll: toSvg(BoxSelect),
  pin: toSvg(Pin),
  pinOff: toSvg(PinOff),
};

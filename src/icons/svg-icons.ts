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
  GripVertical,
  Eye,
  EyeOff,
  BoxSelect,
  X,
  Shapes,
  Settings,
  Ellipsis,
  ImageDown,
  FileDown,
  Crop,
  Copy,
  Printer,
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

export const ICONS = {
  anchor: toSvg(Anchor),

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

  undo: toSvg(Undo2),
  redo: toSvg(Redo2),
  trash: toSvg(Trash2),

  eye: toSvg(Eye),
  eyeOff: toSvg(EyeOff),
  close: toSvg(X, 16),
  dragHandle: dragHandleSvg(),
  selectAll: toSvg(BoxSelect),
  shapes: toSvg(Shapes),
  settings: toSvg(Settings),
  more: toSvg(Ellipsis),
  saveImage: toSvg(ImageDown),
  savePdf: toSvg(FileDown),
  captureArea: toSvg(Crop),
  print: toSvg(Printer),
  copy: toSvg(Copy),
} as const satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

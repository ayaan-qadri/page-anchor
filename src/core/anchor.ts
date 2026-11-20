import { BoundingBox, DOMAnchor, Point, RangeAnchor, TextQuote } from '../types/engine.types';

const HOST_ID = 'page-anchor-host';
const QUOTE_LENGTH = 120;
const CONTEXT_LENGTH = 32;
const RANGE_CONTEXT_LENGTH = 24;
/** Drawings up to this size mark a word or two, so they follow that word through reflow; bigger ones follow their element. */
const RANGE_MAX_WIDTH = 400;
const RANGE_MAX_HEIGHT = 120;
/** How far from the drawing's centre a word may be and still count as the one it marks. */
const WORD_SNAP_PX = 12;
const SEARCH_MAX_OCCURRENCES = 200;
const TAG_SCAN_LIMIT = 1500;
const SKIPPED_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE']);
const STABLE_DATA_ATTRS = ['data-id', 'data-testid', 'data-item-id'];
const IDENTITY_ATTRS = ['href', 'src', 'alt', 'aria-label', 'title', 'name', 'role', 'data-id', 'data-testid', 'data-item-id', 'data-key', 'datetime'];
const REPLACED_TAGS = new Set(['img', 'svg', 'video', 'audio', 'iframe', 'picture', 'input', 'select', 'textarea', 'button', 'object', 'embed', 'meter', 'progress']);
/** Side probes for a drawing in an empty margin, nearest first, so a note beside a paragraph still follows it. */
const MARGIN_PROBES = [24, 48, 96, 160, 240, 320, 480, 640];

/**
 * Safely escapes CSS selector identifiers across standard browsers and JSDOM test environments.
 */
export function safeCssEscape(str: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(str);
  }
  return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function viewportSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1920, height: 1080 };
  return { width: window.innerWidth, height: window.innerHeight };
}

function scrollOffset(): Point {
  if (typeof window === 'undefined') return { x: 0, y: 0 };
  return { x: window.scrollX, y: window.scrollY };
}

// Text extraction. Every reader collapses whitespace the same way and skips script/style text and the extension's own UI, so text read at capture and at resolve time compares equal.

function textWalker(root: Node): TreeWalker {
  return document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
      const el = node as Element;
      return SKIPPED_TAGS.has(el.tagName) || el.id === HOST_ID ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
    },
  });
}

function appendText(buffer: string, raw: string): string {
  let chunk = raw.replace(/\s+/g, ' ');
  if (chunk.startsWith(' ') && (buffer === '' || buffer.endsWith(' '))) chunk = chunk.slice(1);
  return buffer + chunk;
}

function prependText(buffer: string, raw: string): string {
  let chunk = raw.replace(/\s+/g, ' ');
  if (chunk.endsWith(' ') && (buffer === '' || buffer.startsWith(' '))) chunk = chunk.slice(0, -1);
  return chunk + buffer;
}

/** The element's visible-text start, whitespace-collapsed, read only as far as `max` characters. */
export function elementText(el: Element, max = QUOTE_LENGTH): string {
  let out = '';
  // An open shadow root holds what a web component actually shows.
  for (const root of el.shadowRoot ? [el.shadowRoot, el] : [el]) {
    const walker = textWalker(root);
    for (let node = walker.nextNode(); node && out.length <= max; node = walker.nextNode()) {
      out = appendText(out, (node as Text).data);
    }
  }
  return out.trim().slice(0, max).trimEnd();
}

function textBefore(el: Element, max = CONTEXT_LENGTH): string {
  const root = document.body ?? document.documentElement;
  if (!root || !root.contains(el)) return '';
  const walker = textWalker(root);
  walker.currentNode = el;
  let out = '';
  for (let node = walker.previousNode(); node && out.trim().length < max; node = walker.previousNode()) {
    if (node.nodeType === Node.TEXT_NODE) out = prependText(out, (node as Text).data);
  }
  return out.trim().slice(-max).trimStart();
}

function textAfter(el: Element, max = CONTEXT_LENGTH): string {
  const root = document.body ?? document.documentElement;
  if (!root || !root.contains(el)) return '';
  let last: Node = el;
  while (last.lastChild) last = last.lastChild;
  const walker = textWalker(root);
  walker.currentNode = last;
  let out = '';
  for (let node = walker.nextNode(); node && out.trim().length < max; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) out = appendText(out, (node as Text).data);
  }
  return out.trim().slice(0, max).trimEnd();
}

/** Whitespace-collapsed text of a subtree with a map back to its text nodes, for searching quotes and turning matches into DOM ranges. */
class TextIndex {
  text = '';
  readonly nodes: Text[] = [];
  readonly starts: number[] = [];
  /** Whether the node's leading whitespace was folded into the previous node's trailing space. */
  private readonly dropped: boolean[] = [];
  private readonly position = new Map<Text, number>();

  constructor(root: Node) {
    const walker = textWalker(root);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      let chunk = text.data.replace(/\s+/g, ' ');
      const drop = chunk.startsWith(' ') && (this.text === '' || this.text.endsWith(' '));
      if (drop) chunk = chunk.slice(1);
      this.position.set(text, this.nodes.length);
      this.nodes.push(text);
      this.starts.push(this.text.length);
      this.dropped.push(drop);
      this.text += chunk;
    }
  }

  /** Index of the text node holding character `pos`. */
  nodeAt(pos: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  /** Where the first non-space character of `el` sits in the index, or -1 when it has no indexed text. */
  startOf(el: Element): number {
    const first = textWalker(el).nextNode() as Text | null;
    const index = first ? this.position.get(first) : undefined;
    if (index === undefined) return -1;
    let start = this.starts[index];
    while (this.text[start] === ' ') start++;
    return start;
  }

  /** Maps a collapsed-text position to a DOM boundary point. */
  boundary(pos: number): { node: Text; offset: number } | null {
    if (this.nodes.length === 0) return null;
    const index = this.nodeAt(pos);
    const node = this.nodes[index];
    const target = pos - this.starts[index];
    const data = node.data;
    let produced = 0;
    let inSpace = false;
    for (let i = 0; i < data.length; i++) {
      const space = /\s/.test(data[i]);
      if (space) {
        if (inSpace) continue;
        inSpace = true;
        if (i === 0 && this.dropped[index]) continue;
      } else {
        inSpace = false;
      }
      if (produced === target) return { node, offset: i };
      produced++;
    }
    return { node, offset: data.length };
  }

  rangeAt(start: number, length: number): Range | null {
    const from = this.boundary(start);
    const to = this.boundary(start + length - 1);
    if (!from || !to) return null;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, Math.min(to.offset + 1, to.node.data.length));
    return range;
  }
}

// Similarity measures, all in [0, 1].

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[\s.,;:!?()[\]{}"'`|/\\-]+/).filter(Boolean));
}

function textSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const wa = words(a);
  const wb = words(b);
  if (wa.size === 0 || wb.size === 0) return 0;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / (wa.size + wb.size - shared);
}

function leadingSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i / longest;
}

function trailingSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i / longest;
}

/** How closely the text around `el` matches the anchor's saved surroundings, or null when none were saved. */
function contextSimilarity(el: Element, quote: TextQuote | undefined): number | null {
  if (!quote || (!quote.prefix && !quote.suffix)) return null;
  let total = 0;
  let parts = 0;
  if (quote.prefix) {
    total += trailingSimilarity(textBefore(el), quote.prefix);
    parts++;
  }
  if (quote.suffix) {
    total += leadingSimilarity(textAfter(el), quote.suffix);
    parts++;
  }
  return total / parts;
}

// Choosing the element a new drawing anchors to.

function isFullPageWrapper(rect: DOMRect, viewportWidth: number, viewportHeight: number): boolean {
  return rect.width > viewportWidth * 0.9 && rect.height > viewportHeight * 0.9;
}

function isUsableHit(el: Element | null, hostElementId: string): el is Element {
  if (!el || el === document.documentElement || el === document.body) return false;
  if (el.id === hostElementId || el.closest?.(`#${hostElementId}`)) return false;
  if (el.tagName === 'CANVAS') return false;
  return !el.classList?.contains('page-anchor-base-canvas') && !el.classList?.contains('page-anchor-active-canvas');
}

function hitsAt(clientX: number, clientY: number, hostElementId: string): Element[] {
  let elements: Element[] = [];
  if (typeof document.elementsFromPoint === 'function') {
    elements = document.elementsFromPoint(clientX, clientY);
  } else if (typeof document.elementFromPoint === 'function') {
    const hit = document.elementFromPoint(clientX, clientY);
    if (hit) elements = [hit];
  }
  return (elements || []).filter((el) => isUsableHit(el, hostElementId));
}

function hasStableIdentity(el: Element): boolean {
  return (!!el.id && isStableId(el.id)) || STABLE_DATA_ATTRS.some((name) => el.hasAttribute(name));
}

function isIdentifiable(el: Element): boolean {
  if (hasStableIdentity(el)) return true;
  if (REPLACED_TAGS.has(el.tagName.toLowerCase())) return true;
  if (el.hasAttribute('aria-label') || el.hasAttribute('title')) return true;
  return elementText(el, 3).length >= 2;
}

function isInlineLevel(el: Element): boolean {
  if (typeof getComputedStyle !== 'function') return false;
  try {
    const display = getComputedStyle(el).display;
    return display === 'inline' || display === 'contents';
  } catch {
    return false;
  }
}

/** Share of the drawing's box (client coordinates) the element's box covers. */
function coverage(rect: DOMRect, box: BoundingBox): number {
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  if (width <= 0 || height <= 0) return 0;
  const overlapX = Math.max(0, Math.min(rect.right, box.maxX) - Math.max(rect.left, box.minX));
  const overlapY = Math.max(0, Math.min(rect.bottom, box.maxY) - Math.max(rect.top, box.minY));
  return (overlapX * overlapY) / (width * height);
}

/** Walks up from the deepest page element under a point and picks what the drawing should follow: the smallest block-level element with something to recognise it by that covers half the drawing. Inline elements give way to their block (the word inside is tracked separately), and full-page wrappers, page canvases and the extension's own UI are never chosen. */
function chooseAnchorElement(hits: Element[], clientBox: BoundingBox | undefined, hostElementId: string): Element | null {
  if (hits.length === 0) return null;
  const { width: vw, height: vh } = viewportSize();
  let firstIdentifiable: Element | null = null;
  let firstBlock: Element | null = null;
  let firstVisible: Element | null = null;

  for (let cur: Element | null = hits[0]; cur && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
    if (cur.id === hostElementId) return null;
    const rect = cur.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (isFullPageWrapper(rect, vw, vh)) break;
    firstVisible ??= cur;
    if (!isIdentifiable(cur)) continue;
    firstIdentifiable ??= cur;
    const keepInline = hasStableIdentity(cur) || REPLACED_TAGS.has(cur.tagName.toLowerCase());
    if (!keepInline && isInlineLevel(cur)) continue;
    firstBlock ??= cur;
    if (!clientBox || coverage(rect, clientBox) >= 0.5) return cur;
  }
  return firstBlock ?? firstIdentifiable ?? firstVisible;
}

/** Finds the most relevant page element at a document point. Avoids full-page wrappers (like body or screen-wide layout divs), page canvases, and extension-owned elements. */
export function findBestAnchorElement(docPoint: Point, hostElementId = HOST_ID, bbox?: BoundingBox): Element | null {
  if (typeof document === 'undefined') return null;
  const scroll = scrollOffset();
  const clientBox = bbox && {
    minX: bbox.minX - scroll.x - 4,
    minY: bbox.minY - scroll.y - 4,
    maxX: bbox.maxX - scroll.x + 4,
    maxY: bbox.maxY - scroll.y + 4,
  };
  return chooseAnchorElement(hitsAt(docPoint.x - scroll.x, docPoint.y - scroll.y, hostElementId), clientBox, hostElementId);
}

/** For a drawing over empty space, the nearest element level with it, looking sideways first (margin notes) and then up and down. */
function findNearbyAnchorElement(docPoint: Point, hostElementId = HOST_ID): Element | null {
  const scroll = scrollOffset();
  const { width, height } = viewportSize();
  const x = docPoint.x - scroll.x;
  const y = docPoint.y - scroll.y;
  for (const d of MARGIN_PROBES) {
    for (const [px, py] of [
      [x - d, y],
      [x + d, y],
      [x, y - d / 2],
      [x, y + d / 2],
    ]) {
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const el = chooseAnchorElement(hitsAt(px, py, hostElementId), undefined, hostElementId);
      if (el) return el;
    }
  }
  return null;
}

/** True for ids a framework or build step generated (ember123, :r1:, uuids, hashes); those change between page loads and would orphan the anchor. */
export function isStableId(id: string): boolean {
  if (!id || id.startsWith('page-anchor')) return false;
  if (/^\d/.test(id) || id.includes(':')) return false;
  if (/[a-z]\d{3,}/i.test(id)) return false;
  if (/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(id)) return false;
  const hexRun = id.match(/[0-9a-f]{8,}/gi) || [];
  return !hexRun.some((run) => /\d/.test(run) && /[a-f]/i.test(run));
}

// Selectors. They are only the first guess: every hit is checked against the element's text, neighbours and attributes before it is trusted.

function structuralPath(el: Element, skipOwnId: boolean): string {
  const pathParts: string[] = [];
  let curr: Element | null = el;

  while (curr && curr !== document.body && curr !== document.documentElement) {
    const tag = curr.tagName.toLowerCase();
    if (curr.id && isStableId(curr.id) && !(skipOwnId && curr === el)) {
      pathParts.unshift(`#${safeCssEscape(curr.id)}`);
      break;
    }

    const parent: Element | null = curr.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter((c: Element) => c.tagName === curr!.tagName);
      if (siblings.length > 1) {
        const index = siblings.indexOf(curr) + 1;
        pathParts.unshift(`${tag}:nth-of-type(${index})`);
      } else {
        pathParts.unshift(tag);
      }
    } else {
      pathParts.unshift(tag);
    }

    if (pathParts.length >= 32) break;
    curr = parent;
  }

  const rootedAtBody = curr === document.body || curr === document.documentElement;
  return pathParts.length
    ? `${rootedAtBody && document.body && document.body.contains(el) ? 'body > ' : ''}${pathParts.join(' > ')}`
    : el.tagName.toLowerCase();
}

function linkFallback(el: Element): string | null {
  const isLink = el.tagName.toLowerCase() === 'a';
  const linkEl = (isLink ? el : el.querySelector?.('a[href]')) as HTMLAnchorElement | null;
  if (!linkEl || !linkEl.href) return null;
  try {
    const parsed = new URL(linkEl.href, window?.location?.href || 'http://localhost');
    if (!parsed.pathname || parsed.pathname.length <= 1 || parsed.pathname.endsWith('/')) return null;
    const link = `a[href*="${safeCssEscape(parsed.pathname)}"]`;
    // `:has` makes the selector resolve to the container itself, so its rect matches `initialRect`.
    return isLink ? link : `${el.tagName.toLowerCase()}:has(${link})`;
  } catch {
    return null;
  }
}

function classFallback(el: Element): string | null {
  if (typeof el.className !== 'string' || !el.className.trim()) return null;
  const classList = el.className
    .trim()
    .split(/\s+/)
    .filter((c) => !c.startsWith('page-anchor') && !c.includes(':') && c.length > 2);
  return classList.length > 0 ? `${el.tagName.toLowerCase()}.${safeCssEscape(classList[0])}` : null;
}

/**
 * Generates primary and fallback CSS selectors for deterministic element identification.
 */
export function generateSelector(el: Element): { selector: string; fallbackSelectors: string[] } {
  const fallbacks: string[] = [];
  const add = (selector: string | null, primary: string) => {
    if (selector && selector !== primary && !fallbacks.includes(selector)) fallbacks.push(selector);
  };

  let primary: string | null = null;
  if (el.id && isStableId(el.id)) {
    primary = `#${safeCssEscape(el.id)}`;
  } else {
    const attrName = STABLE_DATA_ATTRS.find((name) => el.getAttribute(name));
    if (attrName) primary = `[${attrName}="${safeCssEscape(el.getAttribute(attrName) || '')}"]`;
  }

  if (primary) {
    add(structuralPath(el, true), primary);
    add(linkFallback(el), primary);
    return { selector: primary, fallbackSelectors: fallbacks };
  }

  const hierarchicalSelector = structuralPath(el, false);
  add(linkFallback(el), hierarchicalSelector);
  add(classFallback(el), hierarchicalSelector);

  return {
    selector: hierarchicalSelector,
    fallbackSelectors: fallbacks,
  };
}

/** Extracts a W3C TextQuote: the element's leading text plus the text just before and after it, which tells repeated look-alike elements apart. */
export function extractTextQuote(el: Element): TextQuote | undefined {
  const exact = elementText(el);
  if (exact.length < 3) return undefined;
  return { exact, prefix: textBefore(el), suffix: textAfter(el) };
}

function contextOnlyQuote(el: Element): TextQuote | undefined {
  const prefix = textBefore(el);
  const suffix = textAfter(el);
  return prefix || suffix ? { exact: '', prefix, suffix } : undefined;
}

const MAX_KEYWORDS = 8;

/** Words in the element's text that neither neighbouring sibling has. */
function distinctiveWords(el: Element, exact: string): string[] | undefined {
  const own = words(exact);
  for (const sibling of [el.previousElementSibling, el.nextElementSibling]) {
    if (!sibling) continue;
    for (const w of words(elementText(sibling))) own.delete(w);
  }
  if (own.size === 0 || !(el.previousElementSibling || el.nextElementSibling)) return undefined;
  return [...own].slice(0, MAX_KEYWORDS);
}

function keepsKeywords(anchor: DOMAnchor, el: Element): boolean {
  const keywords = anchor.keywords;
  if (!keywords || keywords.length === 0) return true;
  const present = words(elementText(el));
  const hits = keywords.filter((w) => present.has(w)).length;
  return hits >= (keywords.length <= 2 ? keywords.length : Math.ceil(keywords.length / 2));
}

function identityAttributes(el: Element): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};
  let found = false;
  for (const name of IDENTITY_ATTRS) {
    const value = el.getAttribute(name);
    if (value && value.length <= 300 && !value.startsWith('data:')) {
      attrs[name] = value;
      found = true;
    }
  }
  return found ? attrs : undefined;
}

function firstRect(range: Range): DOMRect | null {
  const rects = range.getClientRects?.();
  const rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect?.();
  return rect && (rect.width > 0 || rect.height > 0) ? rect : null;
}

function distanceToRect(rect: DOMRect, x: number, y: number): number {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

/** The word of `el` under (or within a few pixels of) a viewport point. Measured from text geometry rather than the browser's caret hit test, which would see the extension's drawing overlay on top of the page instead of the text. */
function wordAt(el: Element, x: number, y: number): { node: Text; start: number; end: number; rect: DOMRect } | null {
  const range = document.createRange();
  const walker = textWalker(el);
  let best: { node: Text; start: number; end: number; rect: DOMRect } | null = null;
  let bestDistance = WORD_SNAP_PX;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    range.selectNodeContents(node);
    const nodeRects = Array.from(range.getClientRects());
    if (!nodeRects.some((r) => distanceToRect(r, x, y) <= bestDistance)) continue;
    for (const match of node.data.matchAll(/\S+/g)) {
      const start = match.index ?? 0;
      range.setStart(node, start);
      range.setEnd(node, start + match[0].length);
      for (const rect of Array.from(range.getClientRects())) {
        const distance = distanceToRect(rect, x, y);
        if (distance < bestDistance || (distance === 0 && !best)) {
          best = { node, start, end: start + match[0].length, rect };
          bestDistance = distance;
        }
      }
      if (bestDistance === 0) return best;
    }
  }
  return best;
}

/** The word under the centre of a small drawing, quoted with its neighbours inside `el`. */
function captureRange(el: Element, bbox: BoundingBox): RangeAnchor | undefined {
  if (bbox.maxX - bbox.minX > RANGE_MAX_WIDTH || bbox.maxY - bbox.minY > RANGE_MAX_HEIGHT) return undefined;
  const scroll = scrollOffset();
  const word = wordAt(el, (bbox.minX + bbox.maxX) / 2 - scroll.x, (bbox.minY + bbox.maxY) / 2 - scroll.y);
  if (!word) return undefined;

  const index = new TextIndex(el);
  const nodeIndex = index.nodes.indexOf(word.node);
  if (nodeIndex < 0) return undefined;
  const exact = collapseWhitespace(word.node.data.slice(word.start, word.end));
  const approx = index.starts[nodeIndex] + appendText('', word.node.data.slice(0, word.start)).length;
  const pos = index.text.indexOf(exact, Math.max(0, approx - 2));
  if (pos < 0 || pos > approx + 2) return undefined;
  return {
    exact,
    prefix: index.text.slice(Math.max(0, pos - RANGE_CONTEXT_LENGTH), pos),
    suffix: index.text.slice(pos + exact.length, pos + exact.length + RANGE_CONTEXT_LENGTH),
    left: Math.round(word.rect.left + scroll.x),
    top: Math.round(word.rect.top + scroll.y),
  };
}

function overflowScrolls(value: string): boolean {
  return value === 'auto' || value === 'scroll' || value === 'overlay';
}

/** The nearest scrolling pane between `el` and the page, if any. */
function scrollPaneOf(el: Element): Element | null {
  if (typeof getComputedStyle !== 'function') return null;
  for (let cur = el.parentElement; cur && cur !== document.body && cur !== document.documentElement; cur = cur.parentElement) {
    try {
      const style = getComputedStyle(cur);
      if (overflowScrolls(style.overflowY) || overflowScrolls(style.overflowX)) return cur;
    } catch {
      return null;
    }
  }
  return null;
}

export function createDOMAnchor(targetEl: Element, bbox?: BoundingBox): DOMAnchor {
  const scroll = scrollOffset();
  const rect = targetEl.getBoundingClientRect();

  const { selector, fallbackSelectors } = generateSelector(targetEl);
  // Text-less elements (images, icons, empty boxes) still keep the text around them to be told apart.
  const textQuote = extractTextQuote(targetEl) ?? contextOnlyQuote(targetEl);
  const attrs = identityAttributes(targetEl);
  const keywords = textQuote?.exact ? distinctiveWords(targetEl, textQuote.exact) : undefined;
  const range = bbox ? captureRange(targetEl, bbox) : undefined;

  let scrollClip = false;
  if (bbox) {
    const pane = scrollPaneOf(targetEl);
    if (pane) {
      const paneRect = pane.getBoundingClientRect();
      const cx = (bbox.minX + bbox.maxX) / 2 - scroll.x;
      const cy = (bbox.minY + bbox.maxY) / 2 - scroll.y;
      scrollClip = cx >= paneRect.left && cx <= paneRect.right && cy >= paneRect.top && cy <= paneRect.bottom;
    }
  }

  return {
    selector,
    fallbackSelectors: fallbackSelectors.length > 0 ? fallbackSelectors : undefined,
    textQuote,
    initialRect: {
      left: Math.round(rect.left + scroll.x),
      top: Math.round(rect.top + scroll.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    tag: targetEl.tagName.toLowerCase(),
    ...(attrs ? { attrs } : {}),
    ...(keywords ? { keywords } : {}),
    ...(range ? { range } : {}),
    ...(scrollClip ? { scrollClip } : {}),
  };
}

// Resolution: find the anchored element again, then measure where it (or its word) is now.

export interface ResolvedAnchor {
  element: Element | null;
  deltaX: number;
  deltaY: number;
  /** `hidden`: the element exists but is not displayed (collapsed, inactive tab), so its drawings are not shown either. */
  status: 'found' | 'hidden' | 'orphaned';
  /** Visible box (document coordinates) of the scrolling pane the drawing lives in. */
  clip?: BoundingBox;
}

export interface ResolveOptions {
  /** Allow the whole-page search; callers throttle it because it reads every text node. */
  search?: boolean;
  /** The element this anchor resolved to last time, kept while it still matches. */
  previous?: Element | null;
  /** Shared page text index, so many anchors searching after one DOM change read the page once. */
  pageIndex?: () => TextIndex;
}

function legacyQuoteMatches(anchor: DOMAnchor, el: Element): boolean {
  const snippet = anchor.textQuote?.exact ? collapseWhitespace(anchor.textQuote.exact).slice(0, 30) : '';
  return !snippet || elementText(el, Math.max(QUOTE_LENGTH, snippet.length)).includes(snippet);
}

function quoteSimilarity(anchor: DOMAnchor, el: Element): number {
  const exact = anchor.textQuote?.exact;
  if (!exact) return 1;
  const text = elementText(el);
  if (text === exact) return 1;
  // Anchors saved before quotes were full-length kept only the first 80 characters.
  if (exact.length >= 80 && text.startsWith(exact)) return 1;
  return textSimilarity(text, exact);
}

function attributeScore(anchor: DOMAnchor, el: Element): { matched: number; total: number } {
  const attrs = anchor.attrs;
  if (!attrs) return { matched: 0, total: 0 };
  let matched = 0;
  let total = 0;
  for (const [name, value] of Object.entries(attrs)) {
    total++;
    if (el.getAttribute(name) === value) matched++;
  }
  return { matched, total };
}

function tagMatches(anchor: DOMAnchor, el: Element): boolean {
  return !anchor.tag || el.tagName.toLowerCase() === anchor.tag;
}

/** Cheap check that a remembered or selector-found element is still the anchored one: same tag, text, attributes and neighbours. */
function isSameElement(anchor: DOMAnchor, el: Element, minTextSimilarity = 1): boolean {
  if (!el.isConnected || !tagMatches(anchor, el)) return false;
  if (anchor.textQuote?.exact && quoteSimilarity(anchor, el) < minTextSimilarity) return false;
  if (minTextSimilarity < 1 && !keepsKeywords(anchor, el)) return false;
  const { matched, total } = attributeScore(anchor, el);
  if (matched < total) return false;
  if (!anchor.tag) return true;
  return (contextSimilarity(el, anchor.textQuote) ?? 1) >= 0.75;
}

function isIdSelector(selector: string): boolean {
  return /^#[^\s>+~,]+$/.test(selector) || /^\[[\w-]+="[^"]*"\]$/.test(selector);
}

function querySafe(selector: string): Element | null {
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

function queryAllSafe(selector: string, limit: number): Element[] {
  try {
    return Array.from(document.querySelectorAll(selector)).slice(0, limit);
  } catch {
    return [];
  }
}

/** Primary selector variants, including repairs for selectors saved by older versions. */
function primarySelectors(anchor: DOMAnchor): string[] {
  const list: string[] = [];
  const legacyPath = anchor.selector.includes(' > ') && !anchor.selector.startsWith('body > ') && !anchor.selector.startsWith('#');
  if (legacyPath) list.push(`body > ${anchor.selector}`);
  list.push(anchor.selector);
  if (anchor.selector.startsWith('body > ')) list.push(anchor.selector.slice('body > '.length));
  return list;
}

/** Adds every element whose text starts at `pos` in the page index. */
function elementsStartingAt(anchor: DOMAnchor, index: TextIndex, pos: number, out: Set<Element>): void {
  const node = index.nodes[index.nodeAt(pos)];
  for (let el = node?.parentElement ?? null; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (el.id === HOST_ID) break;
    // Text that starts before `pos` belongs to a bigger container; every ancestor above has it too.
    if (index.startOf(el) < pos) break;
    if (tagMatches(anchor, el)) out.add(el);
  }
}

function forEachOccurrence(text: string, needle: string, visit: (pos: number) => void): void {
  let found = 0;
  for (let pos = text.indexOf(needle); pos !== -1 && found < SEARCH_MAX_OCCURRENCES; pos = text.indexOf(needle, pos + 1)) {
    found++;
    visit(pos);
  }
}

/** Elements that may be the anchored one, found through the page text index: those whose text starts like the quote (its full start, or just its first two words when the rest was edited), and those that follow the quote's prefix. */
function textCandidates(anchor: DOMAnchor, index: TextIndex, out: Set<Element>): void {
  const quote = anchor.textQuote;
  const exact = quote?.exact ? collapseWhitespace(quote.exact) : '';
  if (!exact) return;
  const needles = new Set([exact.slice(0, 48)]);
  const head = exact.split(' ').slice(0, 2).join(' ');
  if (head.length >= 3) needles.add(head);
  for (const needle of needles) forEachOccurrence(index.text, needle, (pos) => elementsStartingAt(anchor, index, pos, out));

  const prefix = quote?.prefix ? collapseWhitespace(quote.prefix).slice(-20) : '';
  if (prefix.length >= 6) {
    forEachOccurrence(index.text, prefix, (pos) => {
      let start = pos + prefix.length;
      while (index.text[start] === ' ') start++;
      if (start < index.text.length) elementsStartingAt(anchor, index, start, out);
    });
  }
}

/** Elements with the anchor's tag, for anchors with no text to search by (images, icons, empty boxes). */
function tagCandidates(anchor: DOMAnchor, out: Set<Element>): void {
  if (!anchor.tag) return;
  const all = document.getElementsByTagName(anchor.tag);
  const attrs = anchor.attrs ? Object.entries(anchor.attrs) : [];
  for (let i = 0; i < all.length && i < TAG_SCAN_LIMIT; i++) {
    const el = all[i];
    if (attrs.length === 0 || attrs.some(([name, value]) => el.getAttribute(name) === value)) out.add(el);
  }
}

interface Scored {
  element: Element;
  score: number;
  /** Same text and same neighbours: nothing else on the page can be a better match. */
  exact: boolean;
}

/** Ranks a candidate by text, neighbouring text, attributes, selector hits and size. Returns null for elements too different to be the anchored one. */
function scoreCandidate(anchor: DOMAnchor, el: Element, hits: { primary: Element | null; fallbacks: Set<Element> }): Scored | null {
  if (!el.isConnected || !tagMatches(anchor, el) || el.closest?.(`#${HOST_ID}`)) return null;
  const isPrimary = el === hits.primary;
  const trustedPrimary = isPrimary && isIdSelector(anchor.selector);
  const hasQuote = !!anchor.textQuote?.exact;

  const textSim = quoteSimilarity(anchor, el);
  const knownContext = contextSimilarity(el, anchor.textQuote);
  const context = knownContext ?? 0;
  // Identical text is enough (look-alikes are settled by the ambiguity check). Edited text must keep what set the element apart and mostly match, counting familiar surroundings when known.
  if (hasQuote && !trustedPrimary && textSim < 1) {
    const support = knownContext === null ? textSim : (textSim + knownContext) / 2;
    if (textSim < 0.5 || support < 0.8 || !keepsKeywords(anchor, el)) return null;
  }
  const { matched, total } = attributeScore(anchor, el);
  if (!hasQuote && !isPrimary && !hits.fallbacks.has(el) && matched === 0 && context < 0.5) return null;

  let score = hasQuote ? 4 * textSim : 0;
  score += 3 * context;
  if (total > 0) score += (2 * matched) / total - (matched === 0 ? 1 : 0);
  if (isPrimary) score += trustedPrimary ? 3 : 0.5;
  if (hits.fallbacks.has(el)) score += 0.5;

  const initial = anchor.initialRect;
  const rect = el.getBoundingClientRect();
  if (initial.width > 0 && initial.height > 0 && rect.width > 0 && rect.height > 0) {
    const widthRatio = Math.min(rect.width, initial.width) / Math.max(rect.width, initial.width);
    const heightRatio = Math.min(rect.height, initial.height) / Math.max(rect.height, initial.height);
    score += widthRatio * heightRatio;
  }
  const scroll = scrollOffset();
  const distance = Math.hypot(rect.left + scroll.x - initial.left, rect.top + scroll.y - initial.top);
  score += 0.5 / (1 + distance / 400);
  return { element: el, score, exact: textSim === 1 && (knownContext === null || knownContext >= 0.95) && (total === 0 || matched === total) };
}

/** Finds the anchored element: the remembered element, then a verified selector hit, then (when allowed) a scored search of the page. */
function locateElement(anchor: DOMAnchor, options: ResolveOptions): Element | null {
  const previous = options.previous;
  // The very node matched last time only needs to still look like it; its own text may have been edited in place.
  if (previous && previous.isConnected && isSameElement(anchor, previous, 0.8)) return previous;

  const selectors = primarySelectors(anchor);
  let primary: Element | null = null;
  for (const [i, selector] of selectors.entries()) {
    const el = querySafe(selector);
    if (!el || !el.isConnected) continue;
    primary ??= el;
    if (selector === anchor.selector && isIdSelector(selector) && tagMatches(anchor, el)) return el;
    if (anchor.tag ? isSameElement(anchor, el) : anchor.textQuote?.exact ? legacyQuoteMatches(anchor, el) : i === 0) return el;
  }

  const fallbacks = new Set<Element>();
  for (const fb of anchor.fallbackSelectors ?? []) {
    for (const el of queryAllSafe(fb, 50)) fallbacks.add(el);
  }

  const candidates = new Set<Element>();
  if (primary) candidates.add(primary);
  for (const el of fallbacks) candidates.add(el);

  if (options.search !== false && document.body) {
    if (anchor.textQuote?.exact) {
      textCandidates(anchor, options.pageIndex ? options.pageIndex() : new TextIndex(document.body), candidates);
    }
    // Custom elements usually keep their text in a shadow root, which the page text index cannot see.
    if (!anchor.textQuote?.exact || anchor.tag?.includes('-')) tagCandidates(anchor, candidates);
  }

  // Without a text quote and without searching, only an unambiguous fallback is trustworthy.
  if (!anchor.textQuote?.exact && !anchor.tag && options.search === false) {
    if (primary && primary === querySafe(anchor.selector)) return primary;
    for (const fb of anchor.fallbackSelectors ?? []) {
      const all = queryAllSafe(fb, 2);
      if (all.length === 1) return all[0];
    }
    return null;
  }

  let best: Scored | null = null;
  let runnerUp = -Infinity;
  for (const el of candidates) {
    const scored = scoreCandidate(anchor, el, { primary, fallbacks });
    if (!scored) continue;
    if (!best || scored.score > best.score) {
      if (best) runnerUp = best.score;
      best = scored;
    } else if (scored.score > runnerUp) {
      runnerUp = scored.score;
    }
  }
  // Two near-equal look-alikes and neither is a perfect match: guessing could put the drawing on the wrong one.
  if (best && !best.exact && best.score - runnerUp < 0.3) return null;
  // Without the page search the real element may simply not have been looked at yet; wait for the search rather than settle for a near miss.
  if (best && !best.exact && options.search === false) return null;
  return best?.element ?? null;
}

function isElementHidden(el: Element, rect: DOMRect): boolean {
  const check = (el as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  if (typeof check === 'function') {
    try {
      if (!check.call(el, { visibilityProperty: true })) return true;
    } catch {}
  }
  if (rect.width === 0 && rect.height === 0) {
    const rects = el.getClientRects?.();
    return !rects || rects.length === 0 || Array.from(rects).every((r) => r.width === 0 && r.height === 0);
  }
  return false;
}

/** Where the anchored word sits now, if it can still be found inside the element. */
function locateRange(el: Element, range: RangeAnchor): DOMRect | null {
  const index = new TextIndex(el);
  let best = -1;
  let bestScore = -1;
  let found = 0;
  for (let pos = index.text.indexOf(range.exact); pos !== -1 && found < SEARCH_MAX_OCCURRENCES; pos = index.text.indexOf(range.exact, pos + 1)) {
    found++;
    const prefix = index.text.slice(Math.max(0, pos - RANGE_CONTEXT_LENGTH), pos);
    const suffix = index.text.slice(pos + range.exact.length, pos + range.exact.length + RANGE_CONTEXT_LENGTH);
    const score = trailingSimilarity(prefix, range.prefix ?? '') + leadingSimilarity(suffix, range.suffix ?? '');
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
  }
  if (best < 0) return null;
  const domRange = index.rangeAt(best, range.exact.length);
  return domRange ? firstRect(domRange) : null;
}

interface Layout {
  /** Any fixed or sticky element on the way up moves this anchor when the page scrolls. */
  scrollSensitive: boolean;
  clip?: BoundingBox;
}

function measureLayout(anchor: DOMAnchor, el: Element): Layout {
  let scrollSensitive = false;
  let clip: BoundingBox | undefined;
  if (typeof getComputedStyle !== 'function') return { scrollSensitive };
  const scroll = scrollOffset();
  for (let cur: Element | null = el; cur && cur !== document.documentElement; cur = cur.parentElement) {
    let style: CSSStyleDeclaration;
    try {
      style = getComputedStyle(cur);
    } catch {
      break;
    }
    if (style.position === 'fixed' || style.position === 'sticky') scrollSensitive = true;
    if (anchor.scrollClip && !clip && cur !== el && cur !== document.body && (overflowScrolls(style.overflowY) || overflowScrolls(style.overflowX))) {
      const rect = cur.getBoundingClientRect();
      const html = cur as HTMLElement;
      const left = rect.left + (html.clientLeft || 0);
      const top = rect.top + (html.clientTop || 0);
      clip = {
        minX: left + scroll.x,
        minY: top + scroll.y,
        maxX: left + (html.clientWidth || rect.width) + scroll.x,
        maxY: top + (html.clientHeight || rect.height) + scroll.y,
      };
    }
    if (scrollSensitive && (clip || !anchor.scrollClip)) break;
  }
  return { scrollSensitive, clip };
}

function measure(anchor: DOMAnchor, el: Element): { resolved: ResolvedAnchor; scrollSensitive: boolean } {
  const rect = el.getBoundingClientRect();
  const { scrollSensitive, clip } = measureLayout(anchor, el);
  const withClip = clip ? { clip } : {};
  if (isElementHidden(el, rect)) {
    return { resolved: { element: el, deltaX: 0, deltaY: 0, status: 'hidden', ...withClip }, scrollSensitive };
  }
  const scroll = scrollOffset();
  let deltaX = Math.round(rect.left + scroll.x) - anchor.initialRect.left;
  let deltaY = Math.round(rect.top + scroll.y) - anchor.initialRect.top;
  if (anchor.range) {
    const word = locateRange(el, anchor.range);
    if (word) {
      deltaX = Math.round(word.left + scroll.x) - anchor.range.left;
      deltaY = Math.round(word.top + scroll.y) - anchor.range.top;
    }
  }
  return { resolved: { element: el, deltaX, deltaY, status: 'found', ...withClip }, scrollSensitive };
}

const ORPHANED: ResolvedAnchor = { element: null, deltaX: 0, deltaY: 0, status: 'orphaned' };

/** Resolves the live location of an anchored DOM element. `options` may be a boolean for older callers: whether the whole-page search may run. */
export function resolveAnchor(anchor: DOMAnchor, options: ResolveOptions | boolean = {}): ResolvedAnchor {
  if (typeof document === 'undefined') return { ...ORPHANED };
  const opts = typeof options === 'boolean' ? { search: options } : options;
  const element = locateElement(anchor, opts);
  if (!element) return { ...ORPHANED };
  return measure(anchor, element).resolved;
}

// Manager: caching, change tracking and the per-frame resolve used by the engine.

interface CachedResolution {
  resolved: ResolvedAnchor;
  scrollX: number;
  scrollY: number;
  /** A fixed/sticky element's offset is only valid at the sampled scroll position. */
  scrollSensitive: boolean;
  /** A miss computed without the page search may still be recoverable once the search is allowed again. */
  searched: boolean;
  /** Layout generation the geometry was measured in. */
  layoutGen: number;
  /** Element's document position when measured, so the layout watchdog can spot moves no event reported. */
  docLeft: number;
  docTop: number;
  width: number;
  height: number;
}

const SEARCH_INTERVAL_MS = 1000;
const INVALIDATE_THROTTLE_MS = 100;
/** Catches layout changes no event reports (CSS transitions, animations, hover growth). */
const LAYOUT_WATCH_MS = 500;
const LAYOUT_WATCH_LIMIT = 400;
const LAYOUT_ATTRIBUTES = ['class', 'style', 'open', 'hidden', 'src', 'width', 'height'];

export class DOMAnchorManager {
  private cache = new Map<string, CachedResolution>();
  private keyByAnchor = new WeakMap<DOMAnchor, string>();
  /** Last element each anchor resolved to; survives invalidation so a still-matching element is reused without searching. */
  private lastElement = new Map<string, Element>();
  private scrollX = 0;
  private scrollY = 0;
  /** Set by any DOM mutation until the next invalidation, so cache hits only pay for `isConnected` when nodes may have gone. */
  private domChanged = false;
  /** Bumped when positions may have changed but the DOM did not (pane scroll, resize), so only geometry is re-measured. */
  private layoutGen = 0;
  private searchAt = new Map<string, number>();
  private pageIndex: TextIndex | null = null;
  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private listeners = typeof AbortController !== 'undefined' ? new AbortController() : null;
  private onPositionsChanged?: () => void;
  private invalidateTimer: number | null = null;
  private layoutWatchTimer: number | null = null;
  private destroyed = false;

  constructor(onPositionsChanged?: () => void) {
    this.onPositionsChanged = onPositionsChanged;
    this.initListeners();
  }

  private initListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const signal = this.listeners?.signal;

    this.syncScroll();
    window.addEventListener('scroll', () => this.syncScroll(), { passive: true, signal });
    // Scrolling panes move their content without any DOM change; `scroll` does not bubble, so capture it.
    document.addEventListener(
      'scroll',
      (event) => {
        if (event.target === document || event.target === document.documentElement || event.target === document.body) return;
        this.invalidateLayout();
      },
      { capture: true, passive: true, signal }
    );

    const scheduleInvalidate = () => this.scheduleInvalidate();
    // Shares the throttle with the root ResizeObserver, which fires for the same resize, so layout is re-resolved once.
    window.addEventListener('resize', scheduleInvalidate, { passive: true, signal });
    window.addEventListener('load', scheduleInvalidate, { signal });
    // Images and iframes finishing their load shift layout; `load` does not bubble, so capture it.
    document.addEventListener('load', scheduleInvalidate, { capture: true, passive: true, signal });
    document.addEventListener('toggle', scheduleInvalidate, { capture: true, passive: true, signal });
    document.addEventListener('transitionend', () => this.invalidateLayout(), { capture: true, passive: true, signal });
    document.fonts?.ready?.then(scheduleInvalidate).catch(() => {});

    const root = document.documentElement;
    if (!root) return;

    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver((records) => {
        if (records.every((r) => this.isOwnNode(r.target))) return;
        this.domChanged = true;
        this.scheduleInvalidate();
      });
      // Observing the root (not body) keeps working when a page swaps out <body>.
      this.mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: LAYOUT_ATTRIBUTES,
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(scheduleInvalidate);
      this.resizeObserver.observe(root);
      this.observeBodyResize();
    }

    this.layoutWatchTimer = window.setInterval(() => this.watchLayout(), LAYOUT_WATCH_MS);
  }

  private isOwnNode(node: Node): boolean {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return !!el && (el.id === HOST_ID || !!el.closest?.(`#${HOST_ID}`));
  }

  /** Throttled rather than debounced so a continuously animating page still gets periodic updates. */
  private scheduleInvalidate(): void {
    if (this.destroyed || this.invalidateTimer !== null) return;
    this.invalidateTimer = window.setTimeout(() => {
      this.invalidateTimer = null;
      if (this.destroyed) return;
      this.observeBodyResize();
      this.invalidateCache();
      this.onPositionsChanged?.();
    }, INVALIDATE_THROTTLE_MS);
  }

  /** Positions moved without DOM changes: keep each anchor's element, re-measure its geometry on the next resolve. */
  public invalidateLayout(): void {
    this.layoutGen++;
    this.onPositionsChanged?.();
  }

  /** Re-measures found anchors to spot moves no event reported, and re-renders once a throttled search is due again for anchors still missing. */
  private watchLayout(): void {
    if (this.destroyed || this.cache.size === 0 || (typeof document !== 'undefined' && document.hidden)) return;
    let checked = 0;
    let retry = false;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      const el = entry.resolved.element;
      if (!el) {
        if (!entry.searched && this.isSearchDue(key, now)) retry = true;
        continue;
      }
      if (entry.resolved.status !== 'found' || ++checked > LAYOUT_WATCH_LIMIT) continue;
      const rect = el.getBoundingClientRect();
      const left = rect.left + (entry.scrollSensitive ? entry.scrollX : window.scrollX);
      const top = rect.top + (entry.scrollSensitive ? entry.scrollY : window.scrollY);
      if (Math.abs(left - entry.docLeft) > 0.5 || Math.abs(top - entry.docTop) > 0.5 || Math.abs(rect.width - entry.width) > 0.5 || Math.abs(rect.height - entry.height) > 0.5) {
        this.invalidateLayout();
        return;
      }
    }
    if (retry) this.onPositionsChanged?.();
  }

  private observedBody: HTMLElement | null = null;

  private observeBodyResize(): void {
    const body = document.body;
    if (!this.resizeObserver || !body || body === this.observedBody) return;
    if (this.observedBody) this.resizeObserver.unobserve(this.observedBody);
    this.resizeObserver.observe(body);
    this.observedBody = body;
  }

  public captureAnchor(bbox: BoundingBox, startPt?: Point): DOMAnchor | undefined {
    const centerPt: Point = {
      x: (bbox.minX + bbox.maxX) / 2,
      y: (bbox.minY + bbox.maxY) / 2,
    };

    let targetEl = findBestAnchorElement(centerPt, HOST_ID, bbox);
    if (!targetEl && startPt) targetEl = findBestAnchorElement(startPt, HOST_ID, bbox);
    if (!targetEl) targetEl = findNearbyAnchorElement(centerPt);
    if (!targetEl) return undefined;

    const anchor = createDOMAnchor(targetEl, bbox);
    // An anchor that cannot find its own element right now would orphan (and hide) the drawing; stay unanchored.
    const check = resolveAnchor(anchor, { search: true });
    if (check.element !== targetEl) return undefined;
    return anchor;
  }

  /** Scroll position used for fixed/sticky anchors; the engine refreshes it once per render. */
  public syncScroll(): void {
    if (typeof window === 'undefined') return;
    this.scrollX = window.scrollX;
    this.scrollY = window.scrollY;
  }

  private keyOf(anchor: DOMAnchor): string {
    let key = this.keyByAnchor.get(anchor);
    if (key === undefined) {
      key = `${anchor.selector}::${anchor.initialRect.left}::${anchor.initialRect.top}::${anchor.range?.left ?? ''}::${anchor.range?.top ?? ''}`;
      this.keyByAnchor.set(anchor, key);
    }
    return key;
  }

  /** Called for every drawing on every frame, so cache hits avoid string building, clock reads and DOM property reads. */
  public resolve(anchor: DOMAnchor): ResolvedAnchor {
    const key = this.keyOf(anchor);
    const cached = this.cache.get(key);
    if (cached) {
      const element = cached.resolved.element;
      if (element) {
        const scrollValid = !cached.scrollSensitive || (cached.scrollX === this.scrollX && cached.scrollY === this.scrollY);
        const connected = !this.domChanged || element.isConnected;
        if (connected && scrollValid && cached.layoutGen === this.layoutGen) return cached.resolved;
        if (connected) return this.store(key, anchor, element, cached.searched);
      } else if (cached.searched || !this.isSearchDue(key, Date.now())) {
        return cached.resolved;
      }
    }

    const now = Date.now();
    const searchDue = this.isSearchDue(key, now);
    const element = locateElement(anchor, {
      search: searchDue,
      previous: this.lastElement.get(key),
      pageIndex: () => (this.pageIndex ??= new TextIndex(document.body)),
    });
    if (searchDue) this.searchAt.set(key, now);
    if (!element) {
      const miss: CachedResolution = {
        resolved: { ...ORPHANED },
        scrollX: this.scrollX,
        scrollY: this.scrollY,
        scrollSensitive: false,
        searched: searchDue,
        layoutGen: this.layoutGen,
        docLeft: 0,
        docTop: 0,
        width: 0,
        height: 0,
      };
      // Misses are cached too; the next DOM change invalidates them, so reattached nodes still recover.
      this.cache.set(key, miss);
      return miss.resolved;
    }
    this.lastElement.set(key, element);
    return this.store(key, anchor, element, searchDue);
  }

  private store(key: string, anchor: DOMAnchor, element: Element, searched: boolean): ResolvedAnchor {
    const { resolved, scrollSensitive } = measure(anchor, element);
    const rect = element.getBoundingClientRect();
    this.cache.set(key, {
      resolved,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      scrollSensitive,
      searched,
      layoutGen: this.layoutGen,
      docLeft: rect.left + (scrollSensitive ? this.scrollX : window.scrollX),
      docTop: rect.top + (scrollSensitive ? this.scrollY : window.scrollY),
      width: rect.width,
      height: rect.height,
    });
    return resolved;
  }

  private isSearchDue(key: string, now: number): boolean {
    return now - (this.searchAt.get(key) ?? 0) >= SEARCH_INTERVAL_MS;
  }

  public invalidateCache(): void {
    this.cache.clear();
    this.pageIndex = null;
    this.domChanged = false;
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.invalidateTimer !== null) {
      clearTimeout(this.invalidateTimer);
      this.invalidateTimer = null;
    }
    if (this.layoutWatchTimer !== null) {
      clearInterval(this.layoutWatchTimer);
      this.layoutWatchTimer = null;
    }
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.listeners?.abort();
    this.cache.clear();
    this.lastElement.clear();
    this.searchAt.clear();
    this.pageIndex = null;
  }
}

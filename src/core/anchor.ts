import { BoundingBox, DOMAnchor, Point } from '../types/engine.types';

/**
 * Safely escapes CSS selector identifiers across standard browsers and JSDOM test environments.
 */
export function safeCssEscape(str: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(str);
  }
  return str.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function isFullPageWrapper(
  el: Element,
  viewportWidth: number,
  viewportHeight: number
): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > viewportWidth * 0.9 && rect.height > viewportHeight * 0.9;
}

/**
 * Finds the most relevant and specific semantic container element at a document point.
 * Avoids full-page wrappers (like body or screen-wide layout divs), page
 * canvases, and extension-owned elements.
 */
export function findBestAnchorElement(
  docPoint: Point,
  hostElementId = 'page-anchor-host'
): Element | null {
  if (typeof document === 'undefined') return null;

  const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
  const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  const clientX = docPoint.x - scrollX;
  const clientY = docPoint.y - scrollY;

  const winW = typeof window !== 'undefined' ? window.innerWidth : 1920;
  const winH = typeof window !== 'undefined' ? window.innerHeight : 1080;

  if (clientX < 0 || clientY < 0 || clientX > winW || clientY > winH) {
    return null;
  }

  const elements =
    typeof document.elementsFromPoint === 'function'
      ? document.elementsFromPoint(clientX, clientY)
      : typeof document.elementFromPoint === 'function'
        ? [document.elementFromPoint(clientX, clientY)].filter(Boolean) as Element[]
        : [];

  if (!elements || elements.length === 0) return null;

  const validElements = elements.filter((el) => {
    if (!el || el === document.documentElement || el === document.body) return false;
    if (el.id === hostElementId || el.closest?.(`#${hostElementId}`)) return false;
    if (el.tagName === 'CANVAS') return false;
    if (
      el.classList?.contains('page-anchor-base-canvas') ||
      el.classList?.contains('page-anchor-active-canvas')
    ) {
      return false;
    }
    return true;
  });

  if (validElements.length === 0) return null;

  const deepest = validElements[0];

  let current: Element | null = deepest;
  let bestContainer: Element | null = null;

  while (current && current !== document.body && current !== document.documentElement) {
    if (current.id === hostElementId) break;

    const rect = current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      current = current.parentElement;
      continue;
    }

    const id = current.id;
    if (id && isStableId(id)) {
      if (!isFullPageWrapper(current, winW, winH)) return current;
    }

    if (
      current.hasAttribute('data-id') ||
      current.hasAttribute('data-testid') ||
      current.hasAttribute('data-item-id')
    ) {
      if (!isFullPageWrapper(current, winW, winH)) return current;
    }

    const tagName = current.tagName.toLowerCase();
    if (
      tagName === 'article' ||
      tagName === 'li' ||
      tagName === 'tr' ||
      tagName === 'section' ||
      tagName === 'details'
    ) {
      if (!isFullPageWrapper(current, winW, winH)) {
        bestContainer = current;
        break;
      }
    }

    const classStr = typeof current.className === 'string' ? current.className : '';
    if (
      classStr.includes('Box-row') ||
      classStr.includes('issue-row') ||
      classStr.includes('list-item') ||
      classStr.includes('card') ||
      classStr.includes('comment')
    ) {
      if (!isFullPageWrapper(current, winW, winH)) {
        bestContainer = current;
        break;
      }
    }

    current = current.parentElement;
  }

  if (bestContainer) return bestContainer;

  if (isFullPageWrapper(deepest, winW, winH)) {
    return null;
  }

  return deepest;
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

const STABLE_DATA_ATTRS = ['data-id', 'data-testid', 'data-item-id'];

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

/**
 * Extracts a W3C-compliant TextQuote snippet for resilient text matching.
 */
export function extractTextQuote(
  el: Element
): { exact: string; prefix?: string; suffix?: string } | undefined {
  const rawText = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (rawText.length < 3) return undefined;

  const exact = rawText.slice(0, 80);
  return { exact };
}

export function createDOMAnchor(targetEl: Element): DOMAnchor {
  const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
  const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  const rect = targetEl.getBoundingClientRect();

  const { selector, fallbackSelectors } = generateSelector(targetEl);
  const textQuote = extractTextQuote(targetEl);

  return {
    selector,
    fallbackSelectors: fallbackSelectors.length > 0 ? fallbackSelectors : undefined,
    textQuote,
    initialRect: {
      left: Math.round(rect.left + scrollX),
      top: Math.round(rect.top + scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  };
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Descends into whichever child still contains `snippet` in its collapsed text, so quotes split across inline elements or indented markup still match. */
function findDeepestContainingText(root: Element, snippet: string): Element | null {
  if (!collapseWhitespace(root.textContent || '').includes(snippet)) return null;
  let current: Element = root;
  for (;;) {
    let next: Element | null = null;
    for (const child of Array.from(current.children)) {
      if (child.id === 'page-anchor-host') continue;
      const tag = child.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue;
      if (collapseWhitespace(child.textContent || '').includes(snippet)) {
        next = child;
        break;
      }
    }
    if (!next) return current === root ? null : current;
    current = next;
  }
}

export interface ResolvedAnchor {
  element: Element | null;
  deltaX: number;
  deltaY: number;
  status: 'found' | 'orphaned';
}

/**
 * Resolves the live location of an anchored DOM element.
 */
export function resolveAnchor(anchor: DOMAnchor, allowTextWalk = true): ResolvedAnchor {
  if (typeof document === 'undefined') {
    return { element: null, deltaX: 0, deltaY: 0, status: 'orphaned' };
  }

  let matchedElement: Element | null = null;

  // Root legacy unbounded paths at <body> to repair stored anchors.
  const legacyPath =
    anchor.selector.includes(' > ') &&
    !anchor.selector.startsWith('body > ') &&
    !anchor.selector.startsWith('#');
  const primarySelectors: Array<{ selector: string; verifyText: boolean }> = [];
  if (legacyPath) {
    primarySelectors.push({ selector: `body > ${anchor.selector}`, verifyText: false });
  }
  primarySelectors.push({ selector: anchor.selector, verifyText: legacyPath });
  if (anchor.selector.startsWith('body > ')) {
    // Retry selectors from the version that truncated deep paths.
    primarySelectors.push({
      selector: anchor.selector.slice('body > '.length),
      verifyText: true,
    });
  }

  const snippet = anchor.textQuote?.exact ? collapseWhitespace(anchor.textQuote.exact).slice(0, 30) : '';
  const hasSnippet = (el: Element) => collapseWhitespace(el.textContent || '').includes(snippet);

  for (const { selector, verifyText } of primarySelectors) {
    try {
      const el = document.querySelector(selector);
      if (el && el.isConnected && (!verifyText || !snippet || hasSnippet(el))) {
        matchedElement = el;
        break;
      }
    } catch {}
  }

  if (!matchedElement && anchor.fallbackSelectors) {
    for (const fb of anchor.fallbackSelectors) {
      try {
        if (snippet) {
          const el = Array.from(document.querySelectorAll(fb)).find((c) => c.isConnected && hasSnippet(c));
          if (el) {
            matchedElement = el;
            break;
          }
        } else {
          // Without a text quote only an unambiguous match is trustworthy.
          const all = document.querySelectorAll(fb);
          if (all.length === 1 && all[0].isConnected) {
            matchedElement = all[0];
            break;
          }
        }
      } catch {}
    }
  }

  // Last resort: text-quote search, which survives DOM structure changes.
  if (allowTextWalk && !matchedElement && snippet && document.body) {
    const deepest = findDeepestContainingText(document.body, snippet);
    if (deepest) {
      matchedElement = deepest.closest('li, tr, article, section, details, .Box-row, [data-id]') || deepest;
    }
  }

  if (matchedElement) {
    const rect = matchedElement.getBoundingClientRect();
    const scrollX = typeof window !== 'undefined' ? window.scrollX : 0;
    const scrollY = typeof window !== 'undefined' ? window.scrollY : 0;

    const currentLeft = Math.round(rect.left + scrollX);
    const currentTop = Math.round(rect.top + scrollY);

    return {
      element: matchedElement,
      deltaX: currentLeft - anchor.initialRect.left,
      deltaY: currentTop - anchor.initialRect.top,
      status: 'found',
    };
  }

  return {
    element: null,
    deltaX: 0,
    deltaY: 0,
    status: 'orphaned',
  };
}

interface CachedResolution {
  resolved: ResolvedAnchor;
  scrollX: number;
  scrollY: number;
  /** A fixed/sticky element's offset is only valid at the sampled scroll position. */
  scrollSensitive: boolean;
  /** A miss computed without the text walk may still be recoverable once the walk is allowed again. */
  textWalked: boolean;
}

const TEXT_WALK_INTERVAL_MS = 1000;
const INVALIDATE_THROTTLE_MS = 100;
const LAYOUT_ATTRIBUTES = ['class', 'style', 'open', 'hidden'];

export class DOMAnchorManager {
  private cache = new Map<string, CachedResolution>();
  private keyByAnchor = new WeakMap<DOMAnchor, string>();
  private scrollX = 0;
  private scrollY = 0;
  /** Set by any DOM mutation until the next invalidation, so cache hits only pay for `isConnected` when nodes may have gone. */
  private domChanged = false;
  private textWalkAt = new Map<string, number>();
  private mutationObserver: MutationObserver | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private listeners = typeof AbortController !== 'undefined' ? new AbortController() : null;
  private onPositionsChanged?: () => void;
  private invalidateTimer: number | null = null;
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

    const scheduleInvalidate = () => this.scheduleInvalidate();
    // Shares the throttle with the root ResizeObserver, which fires for the same resize, so layout is re-resolved once.
    window.addEventListener('resize', scheduleInvalidate, { passive: true, signal });
    window.addEventListener('load', scheduleInvalidate, { signal });
    // Images and iframes finishing their load shift layout; `load` does not bubble, so capture it.
    document.addEventListener('load', scheduleInvalidate, { capture: true, passive: true, signal });
    document.fonts?.ready?.then(scheduleInvalidate).catch(() => {});

    const root = document.documentElement;
    if (!root) return;

    if (typeof MutationObserver !== 'undefined') {
      this.mutationObserver = new MutationObserver(() => {
        this.domChanged = true;
        this.scheduleInvalidate();
      });
      // Observing the root (not body) keeps working when a page swaps out <body>.
      this.mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: LAYOUT_ATTRIBUTES,
      });
    }

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(scheduleInvalidate);
      this.resizeObserver.observe(root);
      this.observeBodyResize();
    }
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

    let targetEl = findBestAnchorElement(centerPt);
    if (!targetEl && startPt) {
      targetEl = findBestAnchorElement(startPt);
    }

    if (!targetEl) return undefined;

    const anchor = createDOMAnchor(targetEl);
    // A mismatched selector would orphan (and hide) the drawing; stay unanchored.
    try {
      if (document.querySelector(anchor.selector) !== targetEl) return undefined;
    } catch {
      return undefined;
    }
    return anchor;
  }

  /** Scroll position used for fixed/sticky anchors; the engine refreshes it once per render. */
  public syncScroll(): void {
    if (typeof window === 'undefined') return;
    this.scrollX = window.scrollX;
    this.scrollY = window.scrollY;
  }

  /** Called for every drawing on every frame, so cache hits avoid string building, clock reads and DOM property reads. */
  public resolve(anchor: DOMAnchor): ResolvedAnchor {
    let key = this.keyByAnchor.get(anchor);
    if (key === undefined) {
      key = `${anchor.selector}::${anchor.initialRect.left}::${anchor.initialRect.top}`;
      this.keyByAnchor.set(anchor, key);
    }

    const cached = this.cache.get(key);
    if (cached) {
      const element = cached.resolved.element;
      if (element) {
        const scrollValid = !cached.scrollSensitive || (cached.scrollX === this.scrollX && cached.scrollY === this.scrollY);
        if (scrollValid && (!this.domChanged || element.isConnected)) return cached.resolved;
      } else if (cached.textWalked || !anchor.textQuote?.exact || !this.isTextWalkDue(key, Date.now())) {
        return cached.resolved;
      }
    }

    const now = Date.now();
    const textWalkDue = this.isTextWalkDue(key, now);
    if (textWalkDue) this.textWalkAt.set(key, now);
    const resolved = resolveAnchor(anchor, textWalkDue);

    let scrollSensitive = false;
    if (resolved.element && typeof getComputedStyle === 'function') {
      try {
        const position = getComputedStyle(resolved.element).position;
        scrollSensitive = position === 'fixed' || position === 'sticky';
      } catch {}
    }

    // Misses are cached too; the next DOM change invalidates them, so reattached nodes still recover.
    this.cache.set(key, {
      resolved,
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      scrollSensitive,
      textWalked: textWalkDue,
    });
    return resolved;
  }

  private isTextWalkDue(key: string, now: number): boolean {
    return now - (this.textWalkAt.get(key) ?? 0) >= TEXT_WALK_INTERVAL_MS;
  }


  public invalidateCache(): void {
    this.cache.clear();
    this.domChanged = false;
  }

  public destroy(): void {
    this.destroyed = true;
    if (this.invalidateTimer !== null) {
      clearTimeout(this.invalidateTimer);
      this.invalidateTimer = null;
    }
    this.mutationObserver?.disconnect();
    this.mutationObserver = null;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.listeners?.abort();
    this.cache.clear();
    this.textWalkAt.clear();
  }
}

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

/**
 * Finds the most relevant and specific semantic container element at a document point.
 * Avoids full-page wrappers (like body or screen-wide layout divs) and extension-owned elements.
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

    const id = current.id;
    if (id && !id.startsWith('page-anchor') && !id.match(/^[0-9]+$/)) {
      return current;
    }

    if (
      current.hasAttribute('data-id') ||
      current.hasAttribute('data-testid') ||
      current.hasAttribute('data-item-id')
    ) {
      return current;
    }

    const tagName = current.tagName.toLowerCase();
    if (
      tagName === 'article' ||
      tagName === 'li' ||
      tagName === 'tr' ||
      tagName === 'section' ||
      tagName === 'details'
    ) {
      bestContainer = current;
      break;
    }

    const classStr = typeof current.className === 'string' ? current.className : '';
    if (
      classStr.includes('Box-row') ||
      classStr.includes('issue-row') ||
      classStr.includes('list-item') ||
      classStr.includes('card') ||
      classStr.includes('comment')
    ) {
      bestContainer = current;
      break;
    }

    current = current.parentElement;
  }

  if (bestContainer) return bestContainer;

  const rect = deepest.getBoundingClientRect();
  if (rect.width > winW * 0.9 && rect.height > winH * 0.9) {
    return null;
  }

  return deepest;
}

/**
 * Generates primary and fallback CSS selectors for deterministic element identification.
 */
export function generateSelector(el: Element): { selector: string; fallbackSelectors: string[] } {
  const fallbacks: string[] = [];

  if (el.id && !el.id.startsWith('page-anchor') && !el.id.match(/^[0-9]+$/)) {
    const directId = `#${safeCssEscape(el.id)}`;
    return { selector: directId, fallbackSelectors: [] };
  }

  const dataId = el.getAttribute('data-id') || el.getAttribute('data-testid') || el.getAttribute('data-item-id');
  if (dataId) {
    const attrName = el.hasAttribute('data-id')
      ? 'data-id'
      : el.hasAttribute('data-testid')
        ? 'data-testid'
        : 'data-item-id';
    return {
      selector: `[${attrName}="${safeCssEscape(dataId)}"]`,
      fallbackSelectors: [],
    };
  }

  const linkEl = (el.tagName.toLowerCase() === 'a' ? el : el.querySelector?.('a')) as HTMLAnchorElement | null;
  if (linkEl && linkEl.href) {
    try {
      const parsed = new URL(linkEl.href, window?.location?.href || 'http://localhost');
      if (parsed.pathname && parsed.pathname.length > 1 && !parsed.pathname.endsWith('/')) {
        fallbacks.push(`a[href*="${safeCssEscape(parsed.pathname)}"]`);
      }
    } catch {}
  }

  const pathParts: string[] = [];
  let curr: Element | null = el;

  while (curr && curr !== document.body && curr !== document.documentElement && pathParts.length < 5) {
    const tag = curr.tagName.toLowerCase();
    if (curr.id && !curr.id.startsWith('page-anchor') && !curr.id.match(/^[0-9]+$/)) {
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
    curr = parent;
  }

  const hierarchicalSelector = pathParts.join(' > ') || el.tagName.toLowerCase();

  if (typeof el.className === 'string' && el.className.trim()) {
    const classList = el.className
      .trim()
      .split(/\s+/)
      .filter((c) => !c.startsWith('page-anchor') && !c.includes(':') && c.length > 2);
    if (classList.length > 0) {
      fallbacks.push(`${el.tagName.toLowerCase()}.${safeCssEscape(classList[0])}`);
    }
  }

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

  try {
    const el = document.querySelector(anchor.selector);
    if (el && el.isConnected) {
      if (!anchor.textQuote?.exact || el.textContent?.includes(anchor.textQuote.exact.slice(0, 30))) {
        matchedElement = el;
      }
    }
  } catch {}

  if (!matchedElement && anchor.fallbackSelectors) {
    for (const fb of anchor.fallbackSelectors) {
      try {
        const el = document.querySelector(fb);
        if (el && el.isConnected) {
          if (!anchor.textQuote?.exact || el.textContent?.includes(anchor.textQuote.exact.slice(0, 30))) {
            matchedElement = el;
            break;
          }
        }
      } catch {}
    }
  }

  // Last resort: text-quote search, which survives DOM structure changes.
  if (allowTextWalk && !matchedElement && anchor.textQuote?.exact && document.body) {
    const snippet = anchor.textQuote.exact.slice(0, 30);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeValue && node.nodeValue.includes(snippet)) {
        const parent = node.parentElement;
        if (parent && parent.isConnected && !parent.closest('#page-anchor-host')) {
          matchedElement = parent.closest('li, tr, article, section, details, .Box-row, [data-id]') || parent;
          break;
        }
      }
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

export class DOMAnchorManager {
  private cache = new Map<string, ResolvedAnchor>();
  private textWalkAt = new Map<string, number>();
  private mutationObserver: MutationObserver | null = null;
  private resizeListener: (() => void) | null = null;
  private onPositionsChanged?: () => void;
  private debounceTimer: number | null = null;
  private resizeTimer: number | null = null;

  constructor(onPositionsChanged?: () => void) {
    this.onPositionsChanged = onPositionsChanged;
    this.initListeners();
  }

  private initListeners(): void {
    if (typeof window === 'undefined') return;

    this.resizeListener = () => {
      if (this.resizeTimer !== null) clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.resizeTimer = null;
        this.invalidateCache();
        this.onPositionsChanged?.();
      }, 120);
    };
    window.addEventListener('resize', this.resizeListener, { passive: true });

    if (typeof MutationObserver !== 'undefined' && document.body) {
      this.mutationObserver = new MutationObserver(() => {
        if (this.debounceTimer !== null) {
          clearTimeout(this.debounceTimer);
        }
        this.debounceTimer = window.setTimeout(() => {
          this.debounceTimer = null;
          this.invalidateCache();
          this.onPositionsChanged?.();
        }, 50);
      });

      this.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
      });
    }
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
    return createDOMAnchor(targetEl);
  }

  public resolve(anchor: DOMAnchor): ResolvedAnchor {
    const key = `${anchor.selector}::${anchor.initialRect.left}::${anchor.initialRect.top}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }

    const now = Date.now();
    const allowTextWalk = now - (this.textWalkAt.get(anchor.selector) ?? 0) >= 1000;
    if (allowTextWalk) {
      this.textWalkAt.set(anchor.selector, now);
    }

    const resolved = resolveAnchor(anchor, allowTextWalk);
    this.cache.set(key, resolved);
    return resolved;
  }

  public invalidateCache(): void {
    this.cache.clear();
  }

  public destroy(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.resizeTimer !== null) {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = null;
    }
    if (this.mutationObserver) {
      this.mutationObserver.disconnect();
      this.mutationObserver = null;
    }
    if (this.resizeListener && typeof window !== 'undefined') {
      window.removeEventListener('resize', this.resizeListener);
      this.resizeListener = null;
    }
    this.cache.clear();
    this.textWalkAt.clear();
  }
}

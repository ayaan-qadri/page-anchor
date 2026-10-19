/**
 * Helpers for placing bundled, trusted markup (icon SVGs and fixed templates)
 * into the DOM without assigning to `innerHTML`, which the Firefox add-ons
 * linter flags as an unsafe assignment and which reviewers treat as a
 * potential XSS sink.
 *
 * Never pass page-derived or user-derived strings here. Those must go through
 * `textContent` (or `setText`) so they are inserted as text, never parsed.
 */

/**
 * Parses a static markup string into detached nodes. The HTML parser is used
 * only as a converter: scripts inside the string never execute, and the result
 * is adopted into the live document on insertion.
 */
export function markupToNodes(markup: string): Node[] {
  const doc = new DOMParser().parseFromString(`<body>${markup}</body>`, 'text/html');
  return doc.body ? Array.from(doc.body.childNodes) : [];
}

/** Replaces an element's children with nodes parsed from trusted markup. */
export function setMarkup(target: Element, markup: string): void {
  target.replaceChildren(...markupToNodes(markup));
}

/** Appends nodes parsed from trusted markup to an element. */
export function appendMarkup(parent: Element, markup: string): void {
  parent.append(...markupToNodes(markup));
}

/**
 * Builds the `pa-tooltip` span used by toolbar buttons. The label and shortcut
 * are inserted as text, so a dynamic label can never be parsed as markup.
 */
export function buildTooltip(label: string, shortcut = ''): HTMLElement {
  const tip = document.createElement('span');
  tip.className = 'pa-tooltip';
  tip.setAttribute('aria-hidden', 'true');
  tip.appendChild(document.createTextNode(label));
  if (shortcut) {
    tip.appendChild(document.createTextNode(' '));
    const kbd = document.createElement('kbd');
    kbd.textContent = shortcut;
    tip.appendChild(kbd);
  }
  return tip;
}

/** Sets a button's content to a trusted icon followed by a text tooltip. */
export function setIconWithTooltip(
  target: Element,
  iconMarkup: string,
  label: string,
  shortcut = ''
): void {
  target.replaceChildren(...markupToNodes(iconMarkup), buildTooltip(label, shortcut));
}

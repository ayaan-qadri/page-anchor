import { describe, it, expect } from 'vitest';
import { appendMarkup, buildTooltip, markupToNodes, setIconWithTooltip, setMarkup } from '../src/ui/dom';

const SVG = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';

describe('DOM markup helpers', () => {
  it('parses trusted markup into element nodes', () => {
    const nodes = markupToNodes(`<span>one</span><span>two</span>`);
    expect(nodes).toHaveLength(2);
    expect((nodes[0] as Element).tagName).toBe('SPAN');
  });

  it('replaces and appends markup without executing scripts', () => {
    const target = document.createElement('div');
    setMarkup(target, `<span>first</span><script>window.__executed = true</script>`);
    expect(target.querySelector('span')?.textContent).toBe('first');
    expect((globalThis as any).window?.__executed).toBeUndefined();

    appendMarkup(target, '<b>second</b>');
    expect(target.querySelector('b')?.textContent).toBe('second');
  });

  it('builds a text-only tooltip, including an optional shortcut', () => {
    const plain = buildTooltip('Pen');
    expect(plain.textContent).toBe('Pen');
    expect(plain.querySelector('kbd')).toBeNull();

    const withShortcut = buildTooltip('Pen', 'P');
    expect(withShortcut.textContent).toBe('Pen P');
    expect(withShortcut.querySelector('kbd')?.textContent).toBe('P');
  });

  it('inserts a tooltip label as text even when it contains markup', () => {
    const btn = document.createElement('button');
    setIconWithTooltip(btn, SVG, '<img src=x onerror="window.__pwned = true">');

    expect(btn.querySelector('svg')).not.toBeNull();
    expect(btn.querySelector('img')).toBeNull();
    expect(btn.querySelector('.pa-tooltip')?.textContent).toBe(
      '<img src=x onerror="window.__pwned = true">'
    );
  });
});

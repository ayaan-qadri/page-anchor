import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FloatingToolbar } from '../src/ui/toolbar';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { DEFAULT_SETTINGS } from '../src/core/storage';

describe('Accessibility (a11y) & WCAG 2.2 Conformance Audit', () => {
  describe('Static Template Audits: options/index.html', () => {
    it('should have valid html lang attribute on all entrypoint pages', () => {
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');

      expect(optionsHtml).toMatch(/<html\s+lang="en">/);
    });

    it('should have a skip-link on the options settings page (WCAG 2.4.1)', () => {
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');
      expect(optionsHtml).toMatch(/class="pa-skip-link[^"]*"/);
      expect(optionsHtml).toContain('href="#main-settings-content"');
      expect(optionsHtml).toContain('id="main-settings-content"');
    });

    it('should implement the WAI-ARIA tablist pattern with roles and aria-controls on options page', () => {
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');
      expect(optionsHtml).toContain('role="tablist"');
      expect(optionsHtml).toContain('role="tab"');
      expect(optionsHtml).toContain('role="tabpanel"');
      expect(optionsHtml).toContain('aria-selected="true"');
      expect(optionsHtml).toContain('aria-controls="tab-shortcuts"');
      expect(optionsHtml).toContain('aria-labelledby="tab-btn-shortcuts"');
    });

    it('should ensure all form controls have explicitly associated labels or aria-labels', () => {
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');
      expect(optionsHtml).toContain('for="pref-url-match-mode"');
      expect(optionsHtml).toContain('id="pref-url-match-mode"');
      expect(optionsHtml).toContain('for="pref-stroke-simplification"');
      expect(optionsHtml).toContain('id="pref-stroke-simplification"');
    });

    it('should include aria-live regions for dynamic status announcements', () => {
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');

      expect(optionsHtml).toContain('id="options-announcer"');
      expect(optionsHtml).toContain('aria-live="polite"');
    });

    it('should hide decorative graphics from assistive technology', () => {
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');

      // Inline SVG action icons in the options page stay hidden from AT
      expect(optionsHtml).toMatch(/<svg[^>]*aria-hidden="true"/);

      // Brand marks are decorative logo images: aria-hidden container + empty alt
      expect(optionsHtml).toMatch(/class="pa-brand-icon[^"]*"\s+aria-hidden="true"/);
      expect(optionsHtml).toMatch(/<img[^>]*alt=""/);
    });
  });

  describe('CSS Accessibility Audits: focus-visible and reduced-motion', () => {
    it('should define :focus-visible indicators in options.css and shadow styles', () => {
      const optionsCss = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/options.css'), 'utf-8');
      const shadowStyles = fs.readFileSync(path.resolve(__dirname, '../src/ui/styles.ts'), 'utf-8');

      expect(optionsCss).toContain(':focus-visible');
      expect(shadowStyles).toContain(':focus-visible');
    });

    it('should pin the shadow host styles so page rules cannot hide or reposition the UI', async () => {
      const { SHADOW_STYLES } = await import('../src/ui/styles');
      const host = SHADOW_STYLES.match(/:host\s*\{([^}]*)\}/)?.[1] ?? '';
      for (const decl of ['display: block', 'position: absolute', 'visibility: visible', 'opacity: 1', 'transform: none', 'filter: none', 'contain: none']) {
        expect(host).toContain(`${decl} !important`);
      }
    });

    it('keeps every toolbar control on screen on narrow phones by wrapping instead of overflowing (WCAG 1.4.10)', async () => {
      const { SHADOW_STYLES } = await import('../src/ui/styles');
      const bar = SHADOW_STYLES.match(/@media \(max-width: 760px\)\s*\{\s*\.pa-toolbar\s*\{([^}]*)\}/)?.[1] ?? '';
      for (const decl of ['flex-wrap: wrap', 'width: max-content', 'max-width: calc(100vw - 16px)']) {
        expect(bar).toContain(decl);
      }
    });

    it('should respect prefers-reduced-motion media query across all styles (WCAG 2.3.3)', () => {
      const optionsCss = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/options.css'), 'utf-8');
      const shadowStyles = fs.readFileSync(path.resolve(__dirname, '../src/ui/styles.ts'), 'utf-8');

      expect(optionsCss).toContain('@media (prefers-reduced-motion: reduce)');
      expect(shadowStyles).toContain('@media (prefers-reduced-motion: reduce)');
    });
  });

  describe('Floating Toolbar Accessibility', () => {
    let container: HTMLElement;
    let engine: CanvasEngine;
    let history: HistoryManager;
    let textEditor: TextEditorOverlay;
    let toolbar: FloatingToolbar;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
      engine = new CanvasEngine(container);
      history = new HistoryManager([]);
      textEditor = new TextEditorOverlay(container);
      toolbar = new FloatingToolbar(container, engine, history, textEditor, DEFAULT_SETTINGS);
    });

    afterEach(() => {
      toolbar.destroy();
      engine.destroy();
      container.remove();
    });

    it('should establish role="region" and role="toolbar" with accessible labels', () => {
      const wrapper = container.querySelector('.pa-toolbar-wrapper');
      const bar = container.querySelector('.pa-toolbar');

      expect(wrapper?.getAttribute('role')).toBe('region');
      expect(wrapper?.getAttribute('aria-label')).toBe('Page Anchor drawing toolbar');
      expect(bar?.getAttribute('role')).toBe('toolbar');
      expect(bar?.getAttribute('aria-label')).toBe('Drawing tools');
    });

    it('should expose a labelled hide control on the toolbar', () => {
      const hideBtn = container.querySelector('[data-action="hide"]') as HTMLButtonElement;
      expect(hideBtn.tagName).toBe('BUTTON');
      expect(hideBtn.getAttribute('aria-label')).toContain('Hide Toolbar');
    });

    it('should not expose any dock controls, since the extension icon toggles the toolbar', () => {
      expect(container.querySelector('[data-action="dock"]')).toBeNull();
      expect(container.querySelector('.pa-dock-tab')).toBeNull();
      expect(container.querySelector('.pa-dock-close')).toBeNull();
      expect(container.querySelector('.pa-dock')).toBeNull();
    });

    it('should render tool buttons with aria-pressed state matching active tool', () => {
      const penBtn = container.querySelector('[data-tool="pen"]') as HTMLButtonElement;
      const highlighterBtn = container.querySelector('[data-tool="highlighter"]') as HTMLButtonElement;

      expect(penBtn.getAttribute('aria-pressed')).toBe('true');
      expect(highlighterBtn.getAttribute('aria-pressed')).toBe('false');
      expect(penBtn.getAttribute('aria-label')).toContain('Pen');

      highlighterBtn.click();
      expect(penBtn.getAttribute('aria-pressed')).toBe('false');
      expect(highlighterBtn.getAttribute('aria-pressed')).toBe('true');
    });

    it('should render color preview button as a native button with aria-haspopup and aria-expanded', () => {
      const colorBtn = container.querySelector('.pa-color-preview-btn') as HTMLButtonElement;
      expect(colorBtn.tagName).toBe('BUTTON');
      expect(colorBtn.getAttribute('aria-haspopup')).toBe('dialog');
      expect(colorBtn.getAttribute('aria-expanded')).toBe('false');

      colorBtn.click();
      expect(colorBtn.getAttribute('aria-expanded')).toBe('true');
    });

    it('should render color swatches as accessible buttons with aria-pressed', () => {
      const swatches = container.querySelectorAll('button.pa-color-swatch');
      expect(swatches.length).toBeGreaterThan(0);
      swatches.forEach((s) => {
        expect(s.getAttribute('aria-label')).toMatch(/^Color /);
        expect(['true', 'false']).toContain(s.getAttribute('aria-pressed'));
      });
    });

    it('should label the custom colour swatch through its colour input', () => {
      const custom = container.querySelectorAll<HTMLElement>('.pa-color-custom');
      expect(custom.length).toBeGreaterThan(0);
      custom.forEach((swatch) => {
        expect(swatch.tagName).toBe('LABEL');
        expect(swatch.querySelector('input[type="color"]')?.getAttribute('aria-label')).toBeTruthy();
      });
    });

    it('should name menu items from their visible text and expose toggle state with aria-checked', () => {
      container.querySelectorAll('.pa-menu-item').forEach((item) => {
        expect(item.hasAttribute('aria-label')).toBe(false);
        expect(item.querySelector('.pa-menu-item-label')?.textContent).toBeTruthy();
      });
      for (const action of ['visibility', 'dom-anchor']) {
        const item = container.querySelector(`[data-action="${action}"]`) as HTMLElement;
        expect(item.getAttribute('role')).toBe('menuitemcheckbox');
        expect(['true', 'false']).toContain(item.getAttribute('aria-checked'));
        expect(item.querySelector('.pa-menu-item-hint')?.getAttribute('aria-hidden')).toBe('true');
      }
    });

    it('should keep a persistent polite live region for toolbar announcements', () => {
      const region = container.querySelector('.pa-live-region') as HTMLElement;
      expect(region.getAttribute('role')).toBe('status');
      expect(region.getAttribute('aria-live')).toBe('polite');
      expect(region.closest('.pa-toolbar-wrapper')).toBeNull();
    });

    it('should support keyboard arrow navigation on the drag handle (WCAG 2.5.7)', () => {
      const handle = container.querySelector('.pa-drag-handle') as HTMLElement;
      expect(handle.getAttribute('role')).toBe('button');
      expect(handle.getAttribute('tabindex')).toBe('0');
      expect(handle.getAttribute('aria-label')).toContain('arrow keys');

      const wrapper = container.querySelector('.pa-toolbar-wrapper') as HTMLElement;
      wrapper.style.left = '100px';
      wrapper.style.top = '100px';

      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
  });

  describe('Canvas Engine Accessibility', () => {
    it('should mark base and active canvas overlays with aria-hidden="true"', () => {
      const div = document.createElement('div');
      document.body.appendChild(div);
      const engine = new CanvasEngine(div);

      const canvases = div.querySelectorAll('canvas');
      expect(canvases.length).toBe(2);
      canvases.forEach((c) => {
        expect(c.getAttribute('aria-hidden')).toBe('true');
      });
      engine.destroy();
      div.remove();

      div.remove();
    });
  });
});

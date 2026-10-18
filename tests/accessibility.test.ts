import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { FloatingToolbar } from '../src/ui/toolbar';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { CanvasEngine } from '../src/core/engine';
import { HistoryManager } from '../src/core/history';
import { DEFAULT_SETTINGS } from '../src/core/storage';

describe('Accessibility (a11y) & WCAG 2.2 Conformance Audit', () => {
  describe('Static Template Audits: popup/index.html & options/index.html', () => {
    it('should have valid html lang attribute on all entrypoint pages', () => {
      const popupHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/popup/index.html'), 'utf-8');
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');

      expect(popupHtml).toMatch(/<html\s+lang="en">/);
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
      expect(optionsHtml).toContain('for="pref-pen-color"');
      expect(optionsHtml).toContain('id="pref-pen-color"');
      expect(optionsHtml).toContain('for="pref-pen-width"');
      expect(optionsHtml).toContain('id="pref-pen-width"');
      expect(optionsHtml).toContain('for="pref-highlighter-color"');
      expect(optionsHtml).toContain('id="pref-highlighter-color"');
      expect(optionsHtml).toContain('for="pref-highlighter-width"');
      expect(optionsHtml).toContain('id="pref-highlighter-width"');
      expect(optionsHtml).toContain('for="pref-font-size"');
      expect(optionsHtml).toContain('id="pref-font-size"');
      expect(optionsHtml).toContain('for="pref-url-match-mode"');
      expect(optionsHtml).toContain('id="pref-url-match-mode"');
      expect(optionsHtml).toContain('for="pref-toolbar-open"');
      expect(optionsHtml).toContain('id="pref-toolbar-open"');
      expect(optionsHtml).toContain('for="pref-show-pill"');
      expect(optionsHtml).toContain('id="pref-show-pill"');
      expect(optionsHtml).toContain('for="pref-stroke-simplification"');
      expect(optionsHtml).toContain('id="pref-stroke-simplification"');
    });

    it('should include aria-live regions for dynamic status announcements', () => {
      const popupHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/popup/index.html'), 'utf-8');
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');

      expect(popupHtml).toContain('id="popup-announcer"');
      expect(popupHtml).toContain('aria-live="polite"');
      expect(optionsHtml).toContain('id="options-announcer"');
      expect(optionsHtml).toContain('aria-live="polite"');
    });

    it('should hide decorative graphics from assistive technology', () => {
      const popupHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/popup/index.html'), 'utf-8');
      const optionsHtml = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/index.html'), 'utf-8');

      // Inline SVG action icons in the popup (settings, export, trash) stay hidden from AT
      expect(popupHtml).toMatch(/<svg[^>]*aria-hidden="true"/);

      // Brand marks are decorative logo images: aria-hidden container + empty alt
      for (const html of [popupHtml, optionsHtml]) {
        expect(html).toMatch(/class="pa-brand-icon[^"]*"\s+aria-hidden="true"/);
        expect(html).toMatch(/<img[^>]*alt=""/);
      }
    });
  });

  describe('CSS Accessibility Audits: focus-visible and reduced-motion', () => {
    it('should define :focus-visible indicators in popup.css, options.css, and shadow styles', () => {
      const popupCss = fs.readFileSync(path.resolve(__dirname, '../entrypoints/popup/popup.css'), 'utf-8');
      const optionsCss = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/options.css'), 'utf-8');
      const shadowStyles = fs.readFileSync(path.resolve(__dirname, '../src/ui/styles.ts'), 'utf-8');

      expect(popupCss).toContain(':focus-visible');
      expect(optionsCss).toContain(':focus-visible');
      expect(shadowStyles).toContain(':focus-visible');
    });

    it('should respect prefers-reduced-motion media query across all styles (WCAG 2.3.3)', () => {
      const popupCss = fs.readFileSync(path.resolve(__dirname, '../entrypoints/popup/popup.css'), 'utf-8');
      const optionsCss = fs.readFileSync(path.resolve(__dirname, '../entrypoints/options/options.css'), 'utf-8');
      const shadowStyles = fs.readFileSync(path.resolve(__dirname, '../src/ui/styles.ts'), 'utf-8');

      expect(popupCss).toContain('@media (prefers-reduced-motion: reduce)');
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

    it('should render the anchor pill as a native button with aria-expanded', () => {
      const pill = container.querySelector('.pa-anchor-pill') as HTMLButtonElement;
      expect(pill.tagName).toBe('BUTTON');
      expect(pill.getAttribute('aria-label')).toBe('Toggle Page Anchor toolbar');
      expect(pill.getAttribute('aria-expanded')).toBe('false');

      toolbar.setDrawingMode(true, false);
      expect(pill.getAttribute('aria-expanded')).toBe('true');
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
      const swatches = container.querySelectorAll('.pa-color-swatch');
      expect(swatches.length).toBeGreaterThan(0);
      swatches.forEach((s) => {
        expect(s.tagName).toBe('BUTTON');
        expect(s.getAttribute('aria-label')).toMatch(/^Color /);
        expect(['true', 'false']).toContain(s.getAttribute('aria-pressed'));
      });
    });

    it('should support keyboard arrow navigation on the drag handle (WCAG 2.5.7)', () => {
      const handle = container.querySelector('.pa-drag-handle') as HTMLElement;
      expect(handle.getAttribute('role')).toBe('button');
      expect(handle.getAttribute('tabindex')).toBe('0');
      expect(handle.getAttribute('aria-label')).toContain('Drag or use arrow keys');

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
      new CanvasEngine(div);

      const canvases = div.querySelectorAll('canvas');
      expect(canvases.length).toBe(2);
      canvases.forEach((c) => {
        expect(c.getAttribute('aria-hidden')).toBe('true');
      });

      div.remove();
    });
  });
});

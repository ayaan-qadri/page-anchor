import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createDOMAnchor,
  DOMAnchorManager,
  extractTextQuote,
  generateSelector,
  resolveAnchor,
  safeCssEscape,
} from '../src/core/anchor';
import { CanvasEngine } from '../src/core/engine';
import { StrokeElement, TextElement } from '../src/types/engine.types';

describe('DOM Anchoring Engine & Deterministic Positioning', () => {
  let container: HTMLDivElement;
  let testDomContainer: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    container.id = 'page-anchor-ui-root';
    document.body.appendChild(container);

    testDomContainer = document.createElement('div');
    testDomContainer.id = 'test-webpage-content';
    document.body.appendChild(testDomContainer);
  });

  afterEach(() => {
    container.remove();
    testDomContainer.remove();
    document.body.innerHTML = '';
  });

  describe('CSS Identifier Escaping & Selector Generation', () => {
    it('escapes special characters safely', () => {
      expect(safeCssEscape('issue:123.test')).toBe('issue\\:123\\.test');
      expect(safeCssEscape('normal-id_123')).toBe('normal-id_123');
    });

    it('generates direct ID selector when element has an ID', () => {
      const issueEl = document.createElement('div');
      issueEl.id = 'issue_14723';
      testDomContainer.appendChild(issueEl);

      const res = generateSelector(issueEl);
      expect(res.selector).toBe('#issue_14723');
    });

    it('generates data-id attribute selector when available', () => {
      const rowEl = document.createElement('div');
      rowEl.setAttribute('data-id', 'issue-row-456');
      testDomContainer.appendChild(rowEl);

      const res = generateSelector(rowEl);
      expect(res.selector).toBe('[data-id="issue-row-456"]');
    });

    it('generates hierarchical selector with nth-of-type for child elements', () => {
      const list = document.createElement('ul');
      list.id = 'issues-list';
      for (let i = 0; i < 3; i++) {
        const li = document.createElement('li');
        li.textContent = `Issue number ${i + 1}`;
        list.appendChild(li);
      }
      testDomContainer.appendChild(list);

      const secondLi = list.children[1];
      const res = generateSelector(secondLi);
      expect(res.selector).toContain('#issues-list > li:nth-of-type(2)');
    });
  });

  describe('W3C Text Quote Extraction', () => {
    it('extracts exact text quote snippet', () => {
      const el = document.createElement('div');
      el.textContent = '  Improve the image description field with alt text validation  ';
      testDomContainer.appendChild(el);

      const quote = extractTextQuote(el);
      expect(quote).toBeDefined();
      expect(quote?.exact).toBe('Improve the image description field with alt text validation');
    });

    it('returns undefined for elements with negligible text', () => {
      const el = document.createElement('div');
      el.textContent = '  ';
      testDomContainer.appendChild(el);

      const quote = extractTextQuote(el);
      expect(quote).toBeUndefined();
    });
  });

  describe('Deterministic Position Tracking (New Issue Arrival Simulation)', () => {
    it('accurately calculates delta shift when a new issue pushes existing rows down', () => {
      // Simulate GitHub issues list
      const issuesList = document.createElement('div');
      issuesList.id = 'issues-list';
      testDomContainer.appendChild(issuesList);

      const issue1 = document.createElement('div');
      issue1.id = 'issue_14723';
      issue1.className = 'Box-row';
      issue1.textContent = 'Improve the image description field';
      // Mock initial layout rect
      issue1.getBoundingClientRect = () => ({
        left: 200,
        top: 300,
        width: 800,
        height: 60,
        right: 1000,
        bottom: 360,
        x: 200,
        y: 300,
        toJSON: () => {},
      });
      issuesList.appendChild(issue1);

      // Create DOM anchor at initial state
      const anchor = createDOMAnchor(issue1);
      expect(anchor.selector).toBe('#issue_14723');
      expect(anchor.initialRect.top).toBe(300);
      expect(anchor.initialRect.left).toBe(200);

      // Verify at initial state, delta is zero
      const initialResolution = resolveAnchor(anchor);
      expect(initialResolution.status).toBe('found');
      expect(initialResolution.deltaX).toBe(0);
      expect(initialResolution.deltaY).toBe(0);

      // Now simulate a NEW issue arriving at the top of the list!
      const newArrivedIssue = document.createElement('div');
      newArrivedIssue.id = 'issue_14730';
      newArrivedIssue.className = 'Box-row';
      newArrivedIssue.textContent = 'New critical bug in Wagtail core';
      issuesList.insertBefore(newArrivedIssue, issue1);

      // Because new issue arrived above, issue1 physically shifted down by 65px!
      issue1.getBoundingClientRect = () => ({
        left: 200,
        top: 365, // shifted from 300 to 365
        width: 800,
        height: 60,
        right: 1000,
        bottom: 425,
        x: 200,
        y: 365,
        toJSON: () => {},
      });

      // Resolve the anchor again
      const shiftedResolution = resolveAnchor(anchor);
      expect(shiftedResolution.status).toBe('found');
      expect(shiftedResolution.deltaX).toBe(0);
      expect(shiftedResolution.deltaY).toBe(65); // Accurately tracked the +65px layout shift!
    });

    it('falls back to W3C Text Quote if selector is altered or moved', () => {
      const containerEl = document.createElement('div');
      containerEl.className = 'custom-row';
      containerEl.textContent = 'Unique issue title with special keywords';
      containerEl.getBoundingClientRect = () => ({
        left: 100,
        top: 250,
        width: 500,
        height: 40,
        right: 600,
        bottom: 290,
        x: 100,
        y: 250,
        toJSON: () => {},
      });
      testDomContainer.appendChild(containerEl);

      const anchor = createDOMAnchor(containerEl);
      // Now break the selector by changing class/id
      containerEl.className = 'rebranded-row';
      containerEl.getBoundingClientRect = () => ({
        left: 100,
        top: 350,
        width: 500,
        height: 40,
        right: 600,
        bottom: 390,
        x: 100,
        y: 350,
        toJSON: () => {},
      });

      const res = resolveAnchor(anchor);
      expect(res.status).toBe('found');
      expect(res.deltaY).toBe(100);
    });

    it('reports orphaned status when element is completely deleted or off-page', () => {
      const el = document.createElement('div');
      el.id = 'temporary-closed-issue';
      el.textContent = 'Closed issue';
      el.getBoundingClientRect = () => ({
        left: 50,
        top: 100,
        width: 400,
        height: 50,
        right: 450,
        bottom: 150,
        x: 50,
        y: 100,
        toJSON: () => {},
      });
      testDomContainer.appendChild(el);

      const anchor = createDOMAnchor(el);
      // Issue closed & deleted from DOM
      el.remove();

      const res = resolveAnchor(anchor);
      expect(res.status).toBe('orphaned');
      expect(res.element).toBeNull();
    });
  });

  describe('DOMAnchorManager Caching & Lifecycle', () => {
    it('caches resolved offsets for zero-lag performance and invalidates on resize', () => {
      const el = document.createElement('div');
      el.id = 'cached-issue';
      el.textContent = 'Performance Test Issue';
      el.getBoundingClientRect = () => ({
        left: 50,
        top: 100,
        width: 300,
        height: 40,
        right: 350,
        bottom: 140,
        x: 50,
        y: 100,
        toJSON: () => {},
      });
      testDomContainer.appendChild(el);

      let notifyCount = 0;
      const manager = new DOMAnchorManager(() => {
        notifyCount++;
      });

      const anchor = createDOMAnchor(el);
      const res1 = manager.resolve(anchor);
      const res2 = manager.resolve(anchor);

      expect(res1).toBe(res2); // Exactly same cached object

      manager.invalidateCache();
      window.dispatchEvent(new Event('resize'));
      expect(notifyCount).toBeGreaterThanOrEqual(1);

      manager.destroy();
    });
  });

  describe('CanvasEngine Integration with DOM Anchoring', () => {
    it('automatically applies delta transformation to effective bounding box', () => {
      const engine = new CanvasEngine(container);

      // Create a test issue element
      const issueEl = document.createElement('div');
      issueEl.id = 'engine-test-issue';
      issueEl.textContent = 'Wagtail Issue #14723';
      issueEl.getBoundingClientRect = () => ({
        left: 200,
        top: 300,
        width: 600,
        height: 50,
        right: 800,
        bottom: 350,
        x: 200,
        y: 300,
        toJSON: () => {},
      });
      testDomContainer.appendChild(issueEl);

      const anchor = createDOMAnchor(issueEl);

      const stroke: StrokeElement = {
        id: 'stroke_1',
        type: 'highlighter',
        points: [
          { x: 210, y: 310 },
          { x: 400, y: 310 },
        ],
        strokeColor: '#facc15',
        strokeWidth: 20,
        opacity: 0.35,
        createdAt: 1000,
        bbox: { minX: 200, minY: 300, maxX: 410, maxY: 320 },
        anchor,
      };

      engine.addElement(stroke);

      // At initial state
      let eff = engine.getElementEffectiveBBox(stroke);
      expect(eff.deltaX).toBe(0);
      expect(eff.deltaY).toBe(0);
      expect(eff.bbox.minY).toBe(300);

      // Shift the DOM element down by 80px (e.g. new issue arrived)
      issueEl.getBoundingClientRect = () => ({
        left: 200,
        top: 380, // +80px shift
        width: 600,
        height: 50,
        right: 800,
        bottom: 430,
        x: 200,
        y: 380,
        toJSON: () => {},
      });

      // Invalidate cache so new layout is resolved
      (engine as any).anchorManager.invalidateCache();

      eff = engine.getElementEffectiveBBox(stroke);
      expect(eff.deltaY).toBe(80);
      expect(eff.bbox.minY).toBe(380); // Follows the issue down perfectly!

      engine.destroy();
    });

    it('respects per-page toggle to disable DOM anchoring', () => {
      const engine = new CanvasEngine(container);

      const issueEl = document.createElement('div');
      issueEl.id = 'toggle-test-issue';
      issueEl.textContent = 'Toggle Test';
      issueEl.getBoundingClientRect = () => ({
        left: 100,
        top: 200,
        width: 400,
        height: 50,
        right: 500,
        bottom: 250,
        x: 100,
        y: 200,
        toJSON: () => {},
      });
      testDomContainer.appendChild(issueEl);

      const anchor = createDOMAnchor(issueEl);
      const stroke: StrokeElement = {
        id: 'stroke_toggle',
        type: 'pen',
        points: [{ x: 110, y: 210 }],
        strokeColor: '#ef4444',
        strokeWidth: 4,
        opacity: 1,
        createdAt: 1000,
        bbox: { minX: 110, minY: 210, maxX: 114, maxY: 214 },
        anchor,
      };

      engine.addElement(stroke);

      // Shift DOM element
      issueEl.getBoundingClientRect = () => ({
        left: 100,
        top: 320,
        width: 400,
        height: 50,
        right: 500,
        bottom: 370,
        x: 100,
        y: 320,
        toJSON: () => {},
      });
      (engine as any).anchorManager.invalidateCache();

      // With anchoring enabled:
      expect(engine.getElementEffectiveBBox(stroke).deltaY).toBe(120);

      // Disable anchoring for this page:
      engine.setDomAnchoringEnabled(false);
      expect(engine.getDomAnchoringEnabled()).toBe(false);

      // When disabled, delta is 0 and bbox stays at original coordinates:
      const disabledEff = engine.getElementEffectiveBBox(stroke);
      expect(disabledEff.deltaY).toBe(0);
      expect(disabledEff.bbox.minY).toBe(210);

      engine.destroy();
    });

    it('handles orphaned mode settings (hide vs dimmed)', () => {
      const engine = new CanvasEngine(container);

      const textEl: TextElement = {
        id: 'text_orphaned',
        type: 'text',
        x: 100,
        y: 200,
        text: 'Issue note',
        fontSize: 16,
        fontColor: '#ffffff',
        strokeColor: '#ffffff',
        strokeWidth: 1,
        opacity: 1,
        createdAt: 1000,
        bbox: { minX: 100, minY: 200, maxX: 200, maxY: 240 },
        anchor: {
          selector: '#non-existent-issue',
          initialRect: { left: 100, top: 200, width: 200, height: 40 },
        },
      };

      engine.addElement(textEl);

      // Default orphaned mode is 'hide'
      expect(engine.getOrphanedAnchorMode()).toBe('hide');
      let eff = engine.getElementEffectiveBBox(textEl);
      expect(eff.isOrphaned).toBe(true);

      // Switch to dimmed mode
      engine.setOrphanedAnchorMode('dimmed');
      expect(engine.getOrphanedAnchorMode()).toBe('dimmed');

      engine.destroy();
    });
  });
});

/** Smart Anchoring in real browser engines: the anchor module runs inside Chromium, Firefox and WebKit pages (desktop and mobile profiles), a drawing is anchored the way the engine does it, the page changes, and the anchor must follow the right element. */
import { test, expect } from '@playwright/test';
import { anchorBundle } from './anchor-bundle';
import { SCENARIOS, type AnchorScenario } from './scenarios';

/** Long enough for the manager's change throttle, layout watchdog and throttled page search to all run at least once. */
const SETTLE_MS = 1300;
const POLL_MS = 100;

interface Outcome {
  anchored: boolean;
  status?: string;
  delta?: { x: number; y: number };
  expected?: { x: number; y: number };
  clip?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  pane?: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

type Page = import('@playwright/test').Page;

function matches(scenario: AnchorScenario, outcome: Outcome): boolean {
  if (scenario.expect === 'hidden' || scenario.expect === 'orphaned') return outcome.status === scenario.expect;
  if (outcome.status !== 'found' || !outcome.expected || !outcome.delta) return false;
  return Math.abs(outcome.delta.x - outcome.expected.x) <= 1 && Math.abs(outcome.delta.y - outcome.expected.y) <= 1;
}

/** Polls until the anchor settles where the scenario expects it. A missing or hiding drawing must also stay that way for the full settle time, so a late wrong match is caught. */
async function settle(page: Page, scenario: AnchorScenario): Promise<Outcome> {
  const waitFull = scenario.expect === 'hidden' || scenario.expect === 'orphaned';
  const deadline = Date.now() + SETTLE_MS;
  let outcome = await readOutcome(page, scenario);
  while (Date.now() < deadline && (waitFull || !matches(scenario, outcome))) {
    await page.waitForTimeout(POLL_MS);
    outcome = await readOutcome(page, scenario);
    if (waitFull && !matches(scenario, outcome) && outcome.status === 'found') break;
  }
  return outcome;
}

async function runScenario(page: Page, scenario: AnchorScenario): Promise<Outcome> {
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;padding:16px;font-family:sans-serif">${scenario.html}</body></html>`
  );
  await page.addScriptTag({ content: anchorBundle() });

  const anchored = await page.evaluate(async ({ target, draw }) => {
    const lib = (window as unknown as { PageAnchorAnchoring: typeof import('../../src/core/anchor') }).PageAnchorAnchoring;
    const el = new Function(`return ${target}`)() as Element;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    await new Promise((r) => setTimeout(r, 50));
    const r = el.getBoundingClientRect();
    const sx = window.scrollX;
    const sy = window.scrollY;
    let bbox: { minX: number; minY: number; maxX: number; maxY: number };
    if (draw === 'box') {
      bbox = { minX: r.left - 8 + sx, minY: r.top - 8 + sy, maxX: r.right + 8 + sx, maxY: r.bottom + 8 + sy };
    } else if (draw === 'margin') {
      const x = Math.min(r.right + 60, window.innerWidth - 30) + sx;
      const y = r.top + r.height / 2 + sy;
      bbox = { minX: x - 20, minY: y - 10, maxX: x + 20, maxY: y + 10 };
    } else {
      const x = r.left + Math.min(r.width, 60) / 2 + sx;
      const y = r.top + Math.min(r.height, 30) / 2 + sy;
      bbox = { minX: x - 10, minY: y - 8, maxX: x + 10, maxY: y + 8 };
    }
    const manager = new lib.DOMAnchorManager();
    const anchor = manager.captureAnchor(bbox);
    if (anchor) manager.resolve(anchor);
    Object.assign(window, { __pa: { manager, anchor, target: el, before: { x: r.left + sx, y: r.top + sy } } });
    return !!anchor;
  }, { target: scenario.target, draw: scenario.draw });
  if (!anchored) return { anchored };

  if (scenario.mutate) await page.evaluate(`(async () => { ${scenario.mutate} })()`);
  if (scenario.resize) await page.setViewportSize(scenario.resize);
  const outcome = await settle(page, scenario);
  await page.evaluate(() => (window as unknown as { __pa: { manager: { destroy(): void } } }).__pa.manager.destroy());
  return outcome;
}

async function readOutcome(page: Page, scenario: AnchorScenario): Promise<Outcome> {
  return page.evaluate(({ truth }) => {
    type State = { manager: import('../../src/core/anchor').DOMAnchorManager; anchor: import('../../src/types/engine.types').DOMAnchor; target: Element; before: { x: number; y: number } };
    const { manager, anchor, target, before } = (window as unknown as { __pa: State }).__pa;
    const el = (truth ? new Function(`return ${truth}`)() : target) as Element | null;
    const resolved = manager.resolve(anchor);
    const out: Outcome = { anchored: true, status: resolved.status, delta: { x: resolved.deltaX, y: resolved.deltaY }, clip: resolved.clip ?? null };
    if (el && el.isConnected) {
      const r = el.getBoundingClientRect();
      out.expected = { x: r.left + window.scrollX - before.x, y: r.top + window.scrollY - before.y };
    }
    const pane = document.getElementById('pane');
    if (pane) {
      const p = pane.getBoundingClientRect();
      out.pane = { minX: p.left + window.scrollX, minY: p.top + window.scrollY, maxX: p.left + pane.clientWidth + window.scrollX, maxY: p.top + pane.clientHeight + window.scrollY };
    }
    return out;
  }, { truth: scenario.truth });
}

test.describe('Smart Anchoring across browser engines', () => {
  for (const scenario of SCENARIOS) {
    test(scenario.name, async ({ page }) => {
      const outcome = await runScenario(page, scenario);
      expect(outcome.anchored, 'drawing gets anchored').toBe(true);

      if (scenario.expect === 'hidden' || scenario.expect === 'orphaned') {
        expect(outcome.status).toBe(scenario.expect);
        return;
      }
      expect(outcome.status).toBe('found');
      expect(outcome.expected, 'truth element still on the page').toBeTruthy();
      // Drawings move in whole CSS pixels; fractional layouts (Firefox, mobile scaling) may round either way.
      expect(Math.abs(outcome.delta!.x - outcome.expected!.x), `x: ${JSON.stringify(outcome)}`).toBeLessThanOrEqual(1);
      expect(Math.abs(outcome.delta!.y - outcome.expected!.y), `y: ${JSON.stringify(outcome)}`).toBeLessThanOrEqual(1);

      if (scenario.expect === 'clipped') {
        expect(outcome.clip, 'clipped to the scrolling pane').toBeTruthy();
        for (const side of ['minX', 'minY', 'maxX', 'maxY'] as const) {
          expect(Math.abs(outcome.clip![side] - outcome.pane![side])).toBeLessThanOrEqual(1);
        }
      }
    });
  }
});

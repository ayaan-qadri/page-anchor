/** Smart Anchoring user flows run against the built extension in each browser: draw with the mouse, change the page (live, on reload, on resize), and check the overlay's actual pixels show the drawing where its content now is. */
import { expect } from '@playwright/test';
import { startServer, type TestServer } from '../helpers';

/** What a flow needs from a browser; Chrome implements it with Playwright, Firefox over WebDriver BiDi. */
export interface ExtensionDriver {
  readonly name: string;
  goto(url: string): Promise<void>;
  reload(): Promise<void>;
  /** Evaluates a JavaScript expression in the page and returns its (JSON) value; promises are awaited. */
  evaluate<T>(expression: string): Promise<T>;
  openToolbar(): Promise<void>;
  press(key: string): Promise<void>;
  drag(from: Point, to: Point): Promise<void>;
  setViewport(width: number, height: number): Promise<void>;
  /** Waits until edits made so far are saved to extension storage. */
  waitForSave(): Promise<void>;
  screenshot(file: string): Promise<void>;
}

type Point = [number, number];
type Box = { x: number; y: number; width: number; height: number };

const repeat = (n: number, f: (i: number) => string) => Array.from({ length: n }, (_, i) => f(i)).join('');
const LOREM = 'The quick brown fox jumps over the lazy dog while the committee reviews every proposal in detail before the vote';
const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Anchoring</title></head><body style="margin:0;padding:24px;font:16px/1.5 sans-serif">${body}</body></html>`;

/** Strongest overlay alpha within `radius` CSS pixels of a viewport point; drawings are opaque there, empty overlay is 0. */
function inkAt(driver: ExtensionDriver, x: number, y: number, radius = 4): Promise<number> {
  return driver.evaluate<number>(`(() => {
    const canvas = document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.page-anchor-base-canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || canvas.style.display === 'none') return 0;
    const scale = canvas.width / canvas.getBoundingClientRect().width;
    const r = Math.ceil(${radius} * scale);
    const cx = Math.round(${x} * scale), cy = Math.round(${y} * scale);
    const data = ctx.getImageData(Math.max(0, cx - r), Math.max(0, cy - r), 2 * r + 1, 2 * r + 1).data;
    let max = 0;
    for (let i = 3; i < data.length; i += 4) max = Math.max(max, data[i]);
    return max;
  })()`);
}

function boxOf(driver: ExtensionDriver, expression: string): Promise<Box | null> {
  return driver.evaluate<Box | null>(`(() => {
    const el = ${expression};
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`);
}

/** Browsers restore the scroll position on reload; measurements compare against the unscrolled first load. */
async function scrollToTop(driver: ExtensionDriver): Promise<void> {
  await driver.evaluate(`(window.scrollTo(0, 0), new Promise((r) => setTimeout(r, 150)))`);
}

async function expectInk(driver: ExtensionDriver, at: Point, label: string): Promise<void> {
  await expect.poll(() => inkAt(driver, at[0], at[1]), { message: `${driver.name}: ink ${label} at ${at}`, timeout: 6000 }).toBeGreaterThan(100);
}

async function expectNoInk(driver: ExtensionDriver, at: Point, label: string): Promise<void> {
  await expect.poll(() => inkAt(driver, at[0], at[1], 3), { message: `${driver.name}: no ink ${label} at ${at}`, timeout: 6000 }).toBe(0);
}

/** Draws a horizontal pen stroke across the start of the element's text and returns the stroke's midpoint. */
async function strokeAcross(driver: ExtensionDriver, box: Box, length = 60): Promise<Point> {
  const y = Math.round(box.y + Math.min(box.height, 24) / 2);
  const x1 = Math.round(box.x + 4);
  const x2 = Math.round(box.x + 4 + Math.min(length, box.width - 8));
  await driver.press('p');
  await driver.drag([x1, y], [x2, y]);
  return [Math.round((x1 + x2) / 2), y];
}

function shifted(point: Point, from: Box, to: Box): Point {
  return [Math.round(point[0] + to.x - from.x), Math.round(point[1] + to.y - from.y)];
}

export interface FlowContext {
  driver: ExtensionDriver;
  /** Directory for screenshots of the checked states, so a run can be reviewed by eye. */
  shots: string;
}

async function withServer(routes: Record<string, string | (() => string)>, run: (server: TestServer) => Promise<void>): Promise<void> {
  const server = await startServer(routes);
  try {
    await run(server);
  } finally {
    await server.close();
  }
}

export const SMART_ANCHORING_FLOWS: Array<{ name: string; run: (ctx: FlowContext) => Promise<void> }> = [
  {
    name: 'a drawing follows its list item when items are inserted above it',
    run: ({ driver, shots }) =>
      withServer({ '/live': page(`<ul id="list">${repeat(10, (i) => `<li style="padding:6px 0">Story headline number ${i} for today</li>`)}</ul>`) }, async (server) => {
        await driver.goto(`${server.origin}/live`);
        await driver.openToolbar();
        const target = `document.querySelectorAll('li')[4]`;
        const before = (await boxOf(driver, target))!;
        const mark = await strokeAcross(driver, before);
        await expectInk(driver, mark, 'after drawing');

        await driver.evaluate(`(() => { for (const t of ['Breaking one', 'Breaking two', 'Breaking three']) { const li = document.createElement('li'); li.style.padding = '6px 0'; li.textContent = t; document.getElementById('list').prepend(li); } })()`);
        const after = (await boxOf(driver, `[...document.querySelectorAll('li')].find((li) => li.textContent.includes('number 4'))`))!;
        expect(after.y - before.y).toBeGreaterThan(60);
        await expectInk(driver, shifted(mark, before, after), 'on the moved item');
        await expectNoInk(driver, mark, 'where the item used to be');
        await driver.screenshot(`${shots}/live-insert.png`);
      }),
  },
  {
    name: 'a drawing finds its item again after reload when the page changed meanwhile',
    run: async ({ driver, shots }) => {
      let version = 0;
      const stories = (order: number[], extra: string[]) =>
        page(`<h1>Feed</h1><div id="feed">${extra.map((t) => `<article style="padding:10px;border-bottom:1px solid #ddd"><h2 style="margin:0;font-size:18px">${t}</h2></article>`).join('')}${order
          .map((i) => `<article style="padding:10px;border-bottom:1px solid #ddd"><h2 style="margin:0;font-size:18px">Story ${i}: city council approves budget item ${i}</h2><p style="margin:4px 0">Posted ${i} hours ago</p></article>`)
          .join('')}</div>`);
      await withServer(
        {
          '/feed': () => {
            version++;
            if (version === 1) return stories([0, 1, 2, 3, 4, 5, 6, 7], []);
            if (version === 2) return stories([7, 6, 5, 4, 3, 2, 1, 0], ['New: weather alert issued', 'New: road closures downtown', 'New: school schedule update', 'New: transit fares change']);
            return stories([0, 1, 2, 3, 5, 6, 7], []);
          },
        },
        async (server) => {
          await driver.goto(`${server.origin}/feed`);
          await driver.openToolbar();
          const story = `[...document.querySelectorAll('h2')].find((h) => h.textContent.startsWith('Story 4:'))`;
          const before = (await boxOf(driver, story))!;
          const mark = await strokeAcross(driver, before, 120);
          await expectInk(driver, mark, 'after drawing');
          await driver.waitForSave();

          // Reordered with new stories on top: the mark must land on "Story 4" again.
          await driver.reload();
          await scrollToTop(driver);
          const after = (await boxOf(driver, story))!;
          expect(Math.abs(after.y - before.y)).toBeGreaterThan(50);
          await expectInk(driver, shifted(mark, before, after), 'on Story 4 after reload');
          await expectNoInk(driver, mark, 'on whatever story now sits at the old spot');
          await driver.screenshot(`${shots}/reload-reordered.png`);

          // Story 4 removed: the mark must not jump onto a look-alike story.
          await driver.reload();
          await scrollToTop(driver);
          await driver.evaluate(`new Promise((r) => setTimeout(r, 1500))`);
          for (const i of [3, 5]) {
            const other = (await boxOf(driver, `[...document.querySelectorAll('h2')].find((h) => h.textContent.startsWith('Story ${i}:'))`))!;
            const spot: Point = [Math.round(other.x + (mark[0] - before.x)), Math.round(other.y + (mark[1] - before.y))];
            expect(await inkAt(driver, spot[0], spot[1], 3), `${driver.name}: no mark on Story ${i}`).toBe(0);
          }
          await driver.screenshot(`${shots}/reload-deleted.png`);
        }
      );
    },
  },
  {
    name: 'a mark on a word stays on that word when the window narrows and text reflows',
    run: ({ driver, shots }) =>
      withServer({ '/article': page(`<article style="max-width:900px"><p>${LOREM} ${LOREM} <mark>keyword</mark> ${LOREM} ${LOREM}</p></article>`) }, async (server) => {
        await driver.setViewport(1200, 800);
        await driver.goto(`${server.origin}/article`);
        await driver.openToolbar();
        const word = `document.querySelector('mark')`;
        const before = (await boxOf(driver, word))!;
        await driver.press('p');
        const y = Math.round(before.y + before.height / 2);
        await driver.drag([Math.round(before.x + 2), y], [Math.round(before.x + before.width - 2), y]);
        const mark: Point = [Math.round(before.x + before.width / 2), y];
        await expectInk(driver, mark, 'on the word');

        await driver.setViewport(520, 800);
        const after = (await boxOf(driver, word))!;
        expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeGreaterThan(40);
        await expectInk(driver, shifted(mark, before, after), 'on the reflowed word');
        await driver.screenshot(`${shots}/reflow.png`);
        await driver.setViewport(1280, 800);
      }),
  },
  {
    name: 'a drawing inside a scrolling pane moves with the pane and is cut off at its edge',
    run: ({ driver, shots }) =>
      withServer(
        { '/pane': page(`<div style="height:60px">Inbox</div><div id="pane" style="height:320px;width:520px;overflow:auto;border:1px solid #999">${repeat(30, (i) => `<div class="msg" style="height:48px;border-bottom:1px solid #eee">Message ${i} from the team</div>`)}</div><div style="height:600px"></div>`) },
        async (server) => {
          await driver.goto(`${server.origin}/pane`);
          await driver.openToolbar();
          const msg = `document.querySelectorAll('.msg')[2]`;
          const before = (await boxOf(driver, msg))!;
          const mark = await strokeAcross(driver, before);
          await expectInk(driver, mark, 'after drawing');

          await driver.evaluate(`document.getElementById('pane').scrollTop = 60`);
          const after = (await boxOf(driver, msg))!;
          await expectInk(driver, shifted(mark, before, after), 'after the pane scrolled');

          // Scrolled out of the pane: the mark would sit above the pane, over the page header, unless it is clipped.
          await driver.evaluate(`document.getElementById('pane').scrollTop = 400`);
          const gone = (await boxOf(driver, msg))!;
          const outside = shifted(mark, before, gone);
          const pane = (await boxOf(driver, `document.getElementById('pane')`))!;
          expect(outside[1]).toBeLessThan(pane.y);
          if (outside[1] > 0) await expectNoInk(driver, outside, 'outside the pane');
          await driver.screenshot(`${shots}/pane.png`);
        }
      ),
  },
  {
    name: 'a drawing hides with its collapsed section and comes back when it opens',
    run: ({ driver, shots }) =>
      withServer({ '/faq': page(`<details id="faq" open><summary>How does billing work?</summary><p>Billing runs monthly on the first business day.</p></details><p>Contact support for anything else.</p>`) }, async (server) => {
        await driver.goto(`${server.origin}/faq`);
        await driver.openToolbar();
        const answer = `document.querySelector('#faq p')`;
        const box = (await boxOf(driver, answer))!;
        const mark = await strokeAcross(driver, box);
        await expectInk(driver, mark, 'after drawing');

        await driver.evaluate(`document.getElementById('faq').open = false`);
        await expectNoInk(driver, mark, 'while the section is collapsed');
        await driver.screenshot(`${shots}/collapsed.png`);

        await driver.evaluate(`document.getElementById('faq').open = true`);
        await expectInk(driver, mark, 'once the section is open again');
      }),
  },
];

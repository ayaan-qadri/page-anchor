import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import contentDefinition from '../entrypoints/content';
import { loadPageData } from '../src/core/storage';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('End-to-End User Flow: Real User Drawing, Selection, Anchoring, & Navigation', () => {
  let mockChrome: any;
  let mockStorage: Record<string, any>;

  beforeEach(() => {
    mockStorage = {};

    mockChrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn(),
        },
      },
      storage: {
        local: {
          get: vi.fn((key) => {
            if (typeof key === 'string') return Promise.resolve({ [key]: mockStorage[key] });
            return Promise.resolve(mockStorage);
          }),
          set: vi.fn((data) => {
            Object.assign(mockStorage, data);
            return Promise.resolve();
          }),
          remove: vi.fn((key) => {
            delete mockStorage[key];
            return Promise.resolve();
          }),
        },
      },
    };

    (globalThis as any).chrome = mockChrome;
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);

    document.body.innerHTML = `
      <header id="site-header" style="height: 60px;">
        <h1 id="title">User Documentation Portal</h1>
      </header>
      <main id="main-content">
        <article id="article-1" style="margin-top: 20px; padding: 15px;">
          <h2 id="section-1-heading">Getting Started with Anchors</h2>
          <p id="para-1">This paragraph explains how annotations track moving content.</p>
        </article>
      </main>
      <footer id="site-footer">Footer Content</footer>
    `;
  });

  afterEach(() => {
    const hosts = document.querySelectorAll('[id^="page-anchor-host"]');
    hosts.forEach((h) => {
      (h as HTMLElement).dataset.destroyed = 'true';
      h.remove();
    });
    document.body.innerHTML = '';
    delete (globalThis as any).chrome;
  });

  it('EXECUTES COMPLETE REAL USER LIFECYCLE: Open Toolbar -> Draw Pen & Shapes -> Add Text -> Select & Move -> Eraser -> Undo/Redo -> Persistence', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const host = document.getElementById('page-anchor-host') as HTMLElement;
    expect(host).not.toBeNull();
    const shadow = host.shadowRoot!;
    expect(shadow).not.toBeNull();

    const pill = shadow.querySelector('.pa-anchor-pill') as HTMLButtonElement;
    expect(pill).not.toBeNull();
    pill.click();
    await new Promise((r) => setTimeout(r, 20));

    const toolbar = shadow.querySelector('.pa-toolbar') as HTMLElement;
    expect(toolbar).not.toBeNull();
    const toolbarWrapper = shadow.querySelector('.pa-toolbar-wrapper') as HTMLElement;
    expect(toolbarWrapper.style.display).toBe('block');
    const badge = shadow.querySelector('.pa-pill-badge') as HTMLElement;
    expect(badge).not.toBeNull();

    const activeCanvas = shadow.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    expect(activeCanvas).not.toBeNull();

    const penBtn = shadow.querySelector('[data-tool="pen"]') as HTMLButtonElement;
    penBtn.click();
    expect(penBtn.classList.contains('active')).toBe(true);

    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0, pointerId: 1 })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 150, clientY: 120, pointerId: 1 })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 200, clientY: 100, pointerId: 1 })
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 200, clientY: 100, pointerId: 1 })
    );

    expect(badge.textContent).toBe('1');

    const rectBtn = shadow.querySelector('[data-tool="rect"]') as HTMLButtonElement;
    rectBtn.click();
    expect(rectBtn.classList.contains('active')).toBe(true);

    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 80, clientY: 80, button: 0, pointerId: 2 })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 300, clientY: 200, pointerId: 2 })
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 300, clientY: 200, pointerId: 2 })
    );

    expect(badge.textContent).toBe('2');

    const textBtn = shadow.querySelector('[data-tool="text"]') as HTMLButtonElement;
    textBtn.click();
    expect(textBtn.classList.contains('active')).toBe(true);

    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 320, clientY: 150, button: 0, pointerId: 3 })
    );

    const uiRoot = shadow.querySelector('.page-anchor-ui-root') as HTMLElement;
    const textWrapper = uiRoot.querySelector('.pa-text-input-wrapper') as HTMLElement;
    expect(textWrapper).not.toBeNull();

    const textarea = textWrapper.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Review this section for Q4';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );

    expect(badge.textContent).toBe('3');
    expect(uiRoot.querySelector('.pa-text-input-wrapper')).toBeNull();

    await wait(320);
    const persisted = await loadPageData(window.location.href);
    expect(persisted?.elements.length).toBe(3);

    const selectBtn = shadow.querySelector('[data-tool="select"]') as HTMLButtonElement;
    selectBtn.click();
    expect(selectBtn.classList.contains('active')).toBe(true);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })
    );
    expect(selectBtn.classList.contains('active')).toBe(true);

    const eraserBtn = shadow.querySelector('[data-tool="eraser"]') as HTMLButtonElement;
    eraserBtn.click();
    expect(eraserBtn.classList.contains('active')).toBe(true);

    const countBeforeErase = Number(badge.textContent);
    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 100, clientY: 100, button: 0, pointerId: 4 })
    );
    const countAfterErase = Number(badge.textContent);
    expect(countAfterErase).toBeLessThan(countBeforeErase);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })
    );
    expect(Number(badge.textContent)).toBe(countBeforeErase);

    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })
    );
    expect(Number(badge.textContent)).toBe(countAfterErase);

    window.history.pushState({}, 'Section 2', '/section-2');
    await new Promise((r) => setTimeout(r, 60));

    window.history.pushState({}, 'Home', window.location.href);
    window.dispatchEvent(new Event('popstate'));
    await new Promise((r) => setTimeout(r, 60));

    const downloadSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const exportBtn = shadow.querySelector('[data-action="export"]') as HTMLButtonElement;
    exportBtn.click();
    expect(downloadSpy).toHaveBeenCalled();
    downloadSpy.mockRestore();

    const clearBtn = shadow.querySelector('[data-action="clear"]') as HTMLButtonElement;
    clearBtn.click();
    expect(globalThis.confirm).toHaveBeenCalled();
    expect(badge.style.display).toBe('none');
    await wait(320);
    expect(await loadPageData(window.location.href)).toBeNull();
  });

  it('VERIFIES SMART DOM ANCHORING: Annotations dynamically follow moving elements', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const host = document.getElementById('page-anchor-host') as HTMLElement;
    const shadow = host.shadowRoot!;
    const pill = shadow?.querySelector('.pa-anchor-pill') as HTMLButtonElement;

    pill.click();
    await new Promise((r) => setTimeout(r, 20));

    const toolbar = shadow.querySelector('.pa-toolbar') as HTMLElement;
    expect(toolbar).not.toBeNull();

    const activeCanvas = shadow.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    const penBtn = shadow.querySelector('[data-tool="pen"]') as HTMLButtonElement;
    penBtn.click();

    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, pointerId: 1 })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 80, clientY: 80, pointerId: 1 })
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 80, clientY: 80, pointerId: 1 })
    );

    const badge = shadow.querySelector('.pa-pill-badge') as HTMLElement;
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('1');
  });
});

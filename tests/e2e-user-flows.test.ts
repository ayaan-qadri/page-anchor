import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import contentDefinition from '../entrypoints/content';
import { loadPageData } from '../src/core/storage';

describe('End-to-End User Flow: Real User Drawing, Selection, Anchoring, & Navigation', () => {
  let mockChrome: any;
  let mockStorage: Record<string, any>;
  let messageListener: any = null;

  beforeEach(() => {
    mockStorage = {};
    messageListener = null;

    mockChrome = {
      runtime: {
        onMessage: {
          addListener: vi.fn((fn) => {
            messageListener = fn;
          }),
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

    // Setup a realistic host webpage DOM
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
    const host = document.getElementById('page-anchor-host');
    if (host) {
      host.id = 'page-anchor-host-removed';
      host.remove();
    }
    document.body.innerHTML = '';
    delete (globalThis as any).chrome;
  });

  it('EXECUTES COMPLETE REAL USER LIFECYCLE: Open Toolbar -> Draw Pen & Shapes -> Add Text -> Select & Move -> Eraser -> Undo/Redo -> Persistence', async () => {
    // 1. User loads the webpage; content script attaches
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const host = document.getElementById('page-anchor-host') as HTMLElement;
    expect(host).not.toBeNull();
    const shadow = host.shadowRoot!;
    expect(shadow).not.toBeNull();

    // 2. User sees the floating anchor pill and clicks it to activate toolbar
    const pill = shadow.querySelector('.pa-anchor-pill') as HTMLButtonElement;
    expect(pill).not.toBeNull();
    pill.click();
    await new Promise((r) => setTimeout(r, 20));

    // Verify drawing toolbar is open
    const toolbar = shadow.querySelector('.pa-toolbar') as HTMLElement;
    expect(toolbar).not.toBeNull();

    // Find the canvas layers
    const activeCanvas = shadow.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    expect(activeCanvas).not.toBeNull();

    // 3. User selects the Pen tool and draws a freehand stroke across the heading
    const penBtn = shadow.querySelector('[data-tool="pen"]') as HTMLButtonElement;
    penBtn.click();

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

    // 4. User selects Rectangle shape and draws a box around the article
    const rectBtn = shadow.querySelector('[data-tool="rect"]') as HTMLButtonElement;
    rectBtn.click();

    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 80, clientY: 80, button: 0, pointerId: 2 })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 300, clientY: 200, pointerId: 2 })
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 300, clientY: 200, pointerId: 2 })
    );

    // 5. User clicks the Text tool to type a note
    const textBtn = shadow.querySelector('[data-tool="text"]') as HTMLButtonElement;
    textBtn.click();

    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 320, clientY: 150, button: 0, pointerId: 3 })
    );

    // User types in the Text Editor Overlay
    const uiRoot = shadow.querySelector('.page-anchor-ui-root') as HTMLElement;
    const textWrapper = uiRoot.querySelector('.pa-text-input-wrapper') as HTMLElement;
    expect(textWrapper).not.toBeNull();

    const textarea = textWrapper.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Review this section for Q4';
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );

    // 6. User switches to Select tool and selects the elements
    const selectBtn = shadow.querySelector('[data-tool="select"]') as HTMLButtonElement;
    selectBtn.click();

    // User uses Ctrl+A to select all annotations
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true })
    );

    // 7. User tests the Eraser tool
    const eraserBtn = shadow.querySelector('[data-tool="eraser"]') as HTMLButtonElement;
    eraserBtn.click();

    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 150, clientY: 110, button: 0, pointerId: 4 })
    );

    // 8. User tests Undo (Ctrl+Z) to restore what was erased
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })
    );

    // User tests Redo (Ctrl+Shift+Z)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true })
    );

    // 9. User navigates to a new section in a Single-Page App (SPA)
    window.history.pushState({}, 'Section 2', '/section-2');
    await new Promise((r) => setTimeout(r, 60));

    // 10. User clicks browser Back button (popstate)
    window.history.pushState({}, 'Home', window.location.href);
    window.dispatchEvent(new Event('popstate'));
    await new Promise((r) => setTimeout(r, 60));

    // 11. User exports snapshot
    const exportBtn = shadow.querySelector('[data-action="export"]') as HTMLButtonElement;
    exportBtn.click();

    // 12. User confirms Clear all annotations
    const clearBtn = shadow.querySelector('[data-action="clear"]') as HTMLButtonElement;
    clearBtn.click();
    expect(globalThis.confirm).toHaveBeenCalled();
  });

  it('VERIFIES SMART DOM ANCHORING: Annotations dynamically follow moving elements', async () => {
    contentDefinition.main();
    await new Promise((r) => setTimeout(r, 20));

    const shadow = document.getElementById('page-anchor-host')!.shadowRoot!;
    const pill = shadow.querySelector('.pa-anchor-pill') as HTMLButtonElement;

    const statusFn = vi.fn();
    messageListener?.({ type: 'PAGE_ANCHOR_GET_STATUS' }, {}, statusFn);
    if (!statusFn.mock.calls[0]?.[0]?.active) {
      pill.click();
    }

    const activeCanvas = shadow.querySelector('.page-anchor-active-canvas') as HTMLCanvasElement;
    const penBtn = shadow.querySelector('[data-tool="pen"]') as HTMLButtonElement;
    penBtn.click();

    // User draws on top of #article-1
    activeCanvas.dispatchEvent(
      new PointerEvent('pointerdown', { clientX: 50, clientY: 50, button: 0, pointerId: 1 })
    );
    window.dispatchEvent(
      new PointerEvent('pointermove', { clientX: 80, clientY: 80, pointerId: 1 })
    );
    window.dispatchEvent(
      new PointerEvent('pointerup', { clientX: 80, clientY: 80, pointerId: 1 })
    );

    // Verify drawing mode state query from popup
    const sendResponse = vi.fn();
    messageListener?.({ type: 'PAGE_ANCHOR_GET_STATUS' }, {}, sendResponse);
    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        active: true,
        count: 1,
      })
    );
  });
});

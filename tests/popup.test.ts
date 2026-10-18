import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initPopup } from '../entrypoints/popup/popup';

describe('Popup UI: Status, Toggles, Actions, & Screen Reader Announcements', () => {
  let mockChrome: any;

  beforeEach(() => {
    // Load popup HTML template without external script/link tags
    let html = fs.readFileSync(
      path.resolve(__dirname, '../entrypoints/popup/index.html'),
      'utf-8'
    );
    html = html.replace(/<link[^>]*>/gi, '').replace(/<script[^>]*>.*?<\/script>/gi, '');
    document.body.innerHTML = html;

    mockChrome = {
      runtime: {
        openOptionsPage: vi.fn(),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 10, title: 'My Work Doc', url: 'https://docs.google.com' }]),
        sendMessage: vi.fn().mockResolvedValue({ active: true, count: 5 }),
      },
      storage: {
        sync: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue({}),
        },
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn().mockResolvedValue({}),
        },
      },
    };

    (globalThis as any).chrome = mockChrome;
    (globalThis as any).confirm = vi.fn().mockReturnValue(true);
    (globalThis as any).window.close = vi.fn();
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
    document.body.innerHTML = '';
  });

  it('populates page title, annotation count, and initial active status from tab', async () => {
    await initPopup();

    const pageTitle = document.getElementById('page-title') as HTMLElement;
    const countEl = document.getElementById('annotation-count') as HTMLElement;
    const toggle = document.getElementById('toggle-draw-mode') as HTMLInputElement;

    expect(pageTitle.textContent).toBe('My Work Doc');
    expect(countEl.textContent).toBe('5 annotations on page');
    expect(toggle.checked).toBe(true);
  });

  it('toggles drawing mode and announces state via aria-live announcer', async () => {
    await initPopup();

    const toggle = document.getElementById('toggle-draw-mode') as HTMLInputElement;
    mockChrome.tabs.sendMessage.mockResolvedValueOnce({ active: false, count: 5 });

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(10, { type: 'PAGE_ANCHOR_TOGGLE' });
    expect(toggle.checked).toBe(false);
  });

  it('clears drawings when user confirms via clear button', async () => {
    await initPopup();

    const clearBtn = document.getElementById('btn-clear') as HTMLButtonElement;
    const countEl = document.getElementById('annotation-count') as HTMLElement;

    clearBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(globalThis.confirm).toHaveBeenCalled();
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(10, { type: 'PAGE_ANCHOR_CLEAR' });
    expect(countEl.textContent).toBe('0 annotations on page');
  });

  it('opens settings inside the popup instead of navigating to a new tab', async () => {
    await initPopup();

    const optionsBtn = document.getElementById('btn-options') as HTMLButtonElement;
    const homeView = document.getElementById('view-home') as HTMLElement;
    const settingsView = document.getElementById('view-settings') as HTMLElement;
    const settingsRoot = document.getElementById('popup-settings-root') as HTMLElement;

    expect(settingsView.classList.contains('hidden')).toBe(true);

    optionsBtn.click();
    await new Promise((r) => setTimeout(r, 20));

    expect(homeView.classList.contains('hidden')).toBe(true);
    expect(settingsView.classList.contains('hidden')).toBe(false);
    expect(settingsRoot.children.length).toBeGreaterThan(0);
    expect(mockChrome.runtime.openOptionsPage).not.toHaveBeenCalled();
  });

  it('returns to the dashboard from settings and can open the full page in a tab', async () => {
    await initPopup();

    (document.getElementById('btn-options') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    (document.getElementById('btn-settings-back') as HTMLButtonElement).click();

    const homeView = document.getElementById('view-home') as HTMLElement;
    const settingsView = document.getElementById('view-settings') as HTMLElement;
    expect(homeView.classList.contains('hidden')).toBe(false);
    expect(settingsView.classList.contains('hidden')).toBe(true);

    (document.getElementById('btn-open-full-settings') as HTMLButtonElement).click();
    expect(mockChrome.runtime.openOptionsPage).toHaveBeenCalled();
  });
});

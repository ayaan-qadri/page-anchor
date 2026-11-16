import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import bootDefinition from '../entrypoints/content';
import { takeBootHandoff } from '../src/core/boot-handoff';
import { getPageStorageKey } from '../src/core/page-key';

type Listener = (msg: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => boolean;

const ctx = {} as import('wxt/utils/content-script-context').ContentScriptContext;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOAD_APP = { type: 'PAGE_ANCHOR_LOAD_APP' };

describe('Boot content script: stays out of the way until it is needed', () => {
  let store: Record<string, unknown>;
  let listeners: Set<Listener>;
  let sendMessage: ReturnType<typeof vi.fn>;
  let loadAppResult: boolean;

  const deliver = (msg: unknown) => {
    const responses: unknown[] = [];
    for (const fn of [...listeners]) fn(msg, {}, (r) => responses.push(r));
    return responses;
  };
  const pageKey = () => getPageStorageKey(window.location.href, 'clean');
  const appLoads = () => sendMessage.mock.calls.filter(([m]) => (m as { type?: string }).type === LOAD_APP.type).length;
  const press = (init: KeyboardEventInit) => {
    const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    window.dispatchEvent(e);
    return e;
  };

  beforeEach(() => {
    store = {};
    listeners = new Set();
    loadAppResult = true;
    sendMessage = vi.fn(async (msg: { type?: string }) => (msg.type === LOAD_APP.type ? { ok: loadAppResult } : undefined));
    (globalThis as any).chrome = {
      runtime: {
        id: 'test',
        sendMessage,
        onMessage: {
          addListener: (fn: Listener) => listeners.add(fn),
          removeListener: (fn: Listener) => listeners.delete(fn),
        },
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        },
      },
    };
  });

  afterEach(() => {
    document.dispatchEvent(new CustomEvent('page-anchor:takeover'));
    takeBootHandoff();
    delete (globalThis as { __pageAnchorBooted?: boolean }).__pageAnchorBooted;
    delete (globalThis as any).chrome;
  });

  it('adds nothing to a page without drawings and does not load the app', async () => {
    const before = document.documentElement.outerHTML;
    bootDefinition.main(ctx);
    await wait(20);
    expect(document.documentElement.outerHTML).toBe(before);
    expect(appLoads()).toBe(0);
  });

  it('loads the app and hands over the drawings when the page has some', async () => {
    const data = { url: window.location.href, elements: [{ id: 'a' }], updatedAt: 1 };
    store[pageKey()] = data;
    bootDefinition.main(ctx);
    await wait(20);
    expect(appLoads()).toBe(1);
    expect(takeBootHandoff()).toEqual({ openToolbar: false, data });
  });

  it('loads the app with the toolbar open when the extension icon is clicked', async () => {
    bootDefinition.main(ctx);
    await wait(20);
    expect(deliver({ type: 'PAGE_ANCHOR_TOGGLE' })).toEqual([{ active: true, count: 0 }]);
    await wait(0);
    expect(appLoads()).toBe(1);
    expect(takeBootHandoff()?.openToolbar).toBe(true);
  });

  it('opens on the toggle shortcut, but leaves every other key to the page', async () => {
    bootDefinition.main(ctx);
    await wait(20);
    expect(press({ key: 'p' }).defaultPrevented).toBe(false);
    expect(appLoads()).toBe(0);
    expect(press({ key: 'd', code: 'KeyD', altKey: true, shiftKey: true }).defaultPrevented).toBe(true);
    await wait(0);
    expect(appLoads()).toBe(1);
  });

  it('uses a toggle shortcut the user rebound', async () => {
    store['page_anchor_settings'] = { shortcuts: { 'toggle-active': 'Alt+Shift+K' } };
    bootDefinition.main(ctx);
    await wait(20);
    press({ key: 'd', code: 'KeyD', altKey: true, shiftKey: true });
    press({ key: 'k', code: 'KeyK', altKey: true, shiftKey: true });
    await wait(0);
    expect(appLoads()).toBe(1);
  });

  it('stops listening once the app takes over', async () => {
    bootDefinition.main(ctx);
    await wait(20);
    deliver({ type: 'PAGE_ANCHOR_TOGGLE' });
    await wait(0);
    expect(listeners.size).toBe(0);
    press({ key: 'd', code: 'KeyD', altKey: true, shiftKey: true });
    await wait(0);
    expect(appLoads()).toBe(1);
  });

  it('keeps listening if the app could not be loaded, so the user can try again', async () => {
    loadAppResult = false;
    bootDefinition.main(ctx);
    await wait(20);
    deliver({ type: 'PAGE_ANCHOR_TOGGLE' });
    await wait(0);
    loadAppResult = true;
    deliver({ type: 'PAGE_ANCHOR_TOGGLE' });
    await wait(0);
    expect(appLoads()).toBe(2);
  });

  it('loads the app when another tab saves drawings for this page', async () => {
    bootDefinition.main(ctx);
    await wait(20);
    store[pageKey()] = { elements: [{ id: 'x' }], updatedAt: 2 };
    deliver({ type: 'PAGE_ANCHOR_STORAGE_CHANGED', keys: ['page_anchor_index', pageKey()] });
    await wait(20);
    expect(appLoads()).toBe(1);
  });

  it('ignores notices about other pages', async () => {
    bootDefinition.main(ctx);
    await wait(20);
    deliver({ type: 'PAGE_ANCHOR_STORAGE_CHANGED', keys: ['page_anchor_data:https://elsewhere.example/'] });
    await wait(20);
    expect(appLoads()).toBe(0);
  });

  it('does nothing when a copy already started in this context, so an open toolbar is never torn down', async () => {
    bootDefinition.main(ctx);
    await wait(20);
    deliver({ type: 'PAGE_ANCHOR_TOGGLE' });
    await wait(0);
    const takeover = vi.fn();
    document.addEventListener('page-anchor:takeover', takeover);
    bootDefinition.main(ctx);
    await wait(20);
    document.removeEventListener('page-anchor:takeover', takeover);
    expect(takeover).not.toHaveBeenCalled();
    expect(appLoads()).toBe(1);
  });

  it('answers status requests without loading anything', async () => {
    bootDefinition.main(ctx);
    await wait(20);
    expect(deliver({ type: 'PAGE_ANCHOR_GET_STATUS' })).toEqual([
      { active: false, count: 0, url: window.location.href, title: document.title },
    ]);
    expect(appLoads()).toBe(0);
  });
});

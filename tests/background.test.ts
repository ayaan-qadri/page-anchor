import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import backgroundDefinition from '../entrypoints/background';

describe('Background Service Worker: Message Routing, Tab Management, & Script Injection', () => {
  let mockChrome: any;
  let listeners: {
    command?: (cmd: string) => Promise<void>;
    onInstalled?: (details?: { reason?: string }) => Promise<void>;
    tabUpdated?: (tabId: number, changeInfo: { url?: string; status?: string }) => void;
    actionClick?: (tab?: any) => Promise<void>;
  };

  beforeEach(() => {
    listeners = {};

    mockChrome = {
      action: {
        onClicked: {
          addListener: vi.fn((fn) => {
            listeners.actionClick = fn;
          }),
        },
      },
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: true }]),
      },
      tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
        onUpdated: {
          addListener: vi.fn((fn) => {
            listeners.tabUpdated = fn;
          }),
        },
      },
      commands: {
        onCommand: {
          addListener: vi.fn((fn) => {
            listeners.command = fn;
          }),
        },
      },
      runtime: {
        onInstalled: {
          addListener: vi.fn((fn) => {
            listeners.onInstalled = fn;
          }),
        },
      },
    };

    (globalThis as any).chrome = mockChrome;
  });

  afterEach(() => {
    delete (globalThis as any).chrome;
  });

  it('registers all required extension event listeners on background boot', () => {
    backgroundDefinition.main();

    expect(mockChrome.action.onClicked.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
  });

  it('toggles drawing mode directly when extension action icon is clicked', async () => {
    backgroundDefinition.main();

    mockChrome.tabs.query.mockResolvedValue([{ id: 77, active: true }]);
    mockChrome.tabs.sendMessage.mockResolvedValue({ active: true });

    await listeners.actionClick?.({ id: 77 });

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(77, { type: 'PAGE_ANCHOR_TOGGLE' });
  });

  it('toggles drawing mode on active tab when extension action click receives tab without id', async () => {
    backgroundDefinition.main();

    mockChrome.tabs.query.mockResolvedValue([{ id: 88, active: true }]);
    mockChrome.tabs.sendMessage.mockResolvedValue({ active: true });

    await listeners.actionClick?.();

    expect(mockChrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(88, { type: 'PAGE_ANCHOR_TOGGLE' });
  });

  it('toggles drawing mode via keyboard command on active tab', async () => {
    backgroundDefinition.main();

    mockChrome.tabs.query.mockResolvedValue([{ id: 42, active: true }]);
    mockChrome.tabs.sendMessage.mockResolvedValue({ active: true });

    await listeners.command?.('toggle-drawing-mode');

    expect(mockChrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'PAGE_ANCHOR_TOGGLE' });
  });

  it('falls back to dynamic content script injection when content script is not yet injected', async () => {
    vi.useFakeTimers();
    backgroundDefinition.main();

    mockChrome.tabs.query.mockResolvedValue([{ id: 99, active: true }]);
    // First sendMessage fails because tab is fresh and content script is not mounted yet
    mockChrome.tabs.sendMessage.mockRejectedValueOnce(new Error('Could not establish connection'));

    await listeners.command?.('toggle-drawing-mode');

    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 99 },
      files: ['content-scripts/content.js'],
    });

    // Advance timer for delayed retry message
    vi.advanceTimersByTime(150);

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('injects content script into all eligible open web tabs upon extension install', async () => {
    backgroundDefinition.main();

    mockChrome.tabs.query.mockResolvedValue([
      { id: 1, url: 'https://developer.mozilla.org' },
      { id: 2, url: 'https://github.com' },
      { id: 3, url: 'chrome://settings' }, // ineligible without id or standard http
    ]);

    await listeners.onInstalled?.({ reason: 'install' });

    expect(mockChrome.tabs.query).toHaveBeenCalledWith({
      url: ['http://*/*', 'https://*/*'],
    });
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ['content-scripts/content.js'],
    });
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 2 },
      files: ['content-scripts/content.js'],
    });
  });

  it('does not re-inject content scripts on a browser update', async () => {
    backgroundDefinition.main();
    mockChrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com' }]);

    await listeners.onInstalled?.({ reason: 'chrome_update' });

    expect(mockChrome.scripting.executeScript).not.toHaveBeenCalled();
  });

  it('tells a tab to reload its drawings when its URL changes without a page load', () => {
    backgroundDefinition.main();
    mockChrome.tabs.sendMessage.mockReturnValue(Promise.reject(new Error('no receiver')));

    listeners.tabUpdated?.(5, { status: 'loading' });
    expect(mockChrome.tabs.sendMessage).not.toHaveBeenCalled();

    listeners.tabUpdated?.(5, { url: 'https://example.com/app/route-2' });
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(5, { type: 'PAGE_ANCHOR_URL_CHANGED' });
  });
});

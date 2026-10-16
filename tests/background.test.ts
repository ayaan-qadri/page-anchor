import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import backgroundDefinition from '../entrypoints/background';

describe('Background Service Worker: Message Routing, Tab Management, & Script Injection', () => {
  let mockChrome: any;
  let listeners: {
    command?: (cmd: string) => Promise<void>;
    actionClick?: (tab: any) => Promise<void>;
    onInstalled?: () => Promise<void>;
    onUpdated?: (tabId: number, changeInfo: any) => void;
  };

  beforeEach(() => {
    listeners = {};

    mockChrome = {
      scripting: {
        executeScript: vi.fn().mockResolvedValue([{ result: true }]),
      },
      tabs: {
        query: vi.fn(),
        sendMessage: vi.fn(),
        onUpdated: {
          addListener: vi.fn((fn) => {
            listeners.onUpdated = fn;
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
      action: {
        onClicked: {
          addListener: vi.fn((fn) => {
            listeners.actionClick = fn;
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

    expect(mockChrome.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.action.onClicked.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.tabs.onUpdated.addListener).toHaveBeenCalledTimes(1);
  });

  it('toggles drawing mode via keyboard command on active tab', async () => {
    backgroundDefinition.main();

    mockChrome.tabs.query.mockResolvedValue([{ id: 42, active: true }]);
    mockChrome.tabs.sendMessage.mockResolvedValue({ active: true });

    await listeners.command?.('toggle-drawing-mode');

    expect(mockChrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'PAGE_ANCHOR_TOGGLE' });
  });

  it('toggles drawing mode via extension toolbar icon click', async () => {
    backgroundDefinition.main();

    mockChrome.tabs.sendMessage.mockResolvedValue({ active: true });

    await listeners.actionClick?.({ id: 101 });

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(101, { type: 'PAGE_ANCHOR_TOGGLE' });
  });

  it('falls back to dynamic content script injection when content script is not yet injected', async () => {
    vi.useFakeTimers();
    backgroundDefinition.main();

    // First sendMessage fails because tab is fresh and content script is not mounted yet
    mockChrome.tabs.sendMessage.mockRejectedValueOnce(new Error('Could not establish connection'));

    await listeners.actionClick?.({ id: 99 });

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

    await listeners.onInstalled?.();

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

  it('broadcasts PAGE_ANCHOR_URL_CHANGED on tab navigation', () => {
    backgroundDefinition.main();

    mockChrome.tabs.sendMessage.mockResolvedValue({});

    listeners.onUpdated?.(55, { url: 'https://example.com/new-path' });

    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(55, {
      type: 'PAGE_ANCHOR_URL_CHANGED',
      url: 'https://example.com/new-path',
    });
  });
});

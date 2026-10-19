import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import backgroundDefinition from '../entrypoints/background';

describe('Background Service Worker: Message Routing, Tab Management, & Script Injection', () => {
  let mockChrome: any;
  let listeners: {
    command?: (cmd: string) => Promise<void>;
    onInstalled?: () => Promise<void>;
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

    expect(mockChrome.commands.onCommand.addListener).toHaveBeenCalledTimes(1);
    expect(mockChrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
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
});

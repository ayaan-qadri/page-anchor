import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import backgroundDefinition from '../entrypoints/background';

describe('Background Service Worker: Message Routing, Tab Management, & Script Injection', () => {
  let mockChrome: any;
  let listeners: {
    command?: (cmd: string) => Promise<void>;
    onInstalled?: (details?: { reason?: string }) => Promise<void>;
    tabUpdated?: (tabId: number, changeInfo: { url?: string; status?: string }) => void;
    actionClick?: (tab?: any) => Promise<void>;
    message?: (msg: unknown, sender: { tab?: { id?: number } }, sendResponse?: (r?: unknown) => void) => boolean;
    permissionAdded?: () => void;
    permissionRemoved?: () => void;
    storageChanged?: (changes: Record<string, unknown>) => void;
  };
  let stored: Record<string, unknown>;

  beforeEach(() => {
    listeners = {};
    stored = {};

    mockChrome = {
      action: {
        setBadgeText: vi.fn().mockResolvedValue(undefined),
        setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
        setTitle: vi.fn().mockResolvedValue(undefined),
        onClicked: {
          addListener: vi.fn((fn) => {
            listeners.actionClick = fn;
          }),
        },
      },
      storage: {
        local: {
          get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})),
          set: vi.fn(async (items: Record<string, unknown>) => void Object.assign(stored, items)),
          remove: vi.fn(async (key: string) => void delete stored[key]),
        },
        onChanged: { addListener: vi.fn((fn) => (listeners.storageChanged = fn)) },
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        onAdded: { addListener: vi.fn((fn) => (listeners.permissionAdded = fn)) },
        onRemoved: { addListener: vi.fn((fn) => (listeners.permissionRemoved = fn)) },
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
        getManifest: vi.fn(() => ({ action: { default_title: 'Page Anchor: toggle drawing toolbar' } })),
        openOptionsPage: vi.fn(),
        onMessage: {
          addListener: vi.fn((fn) => {
            listeners.message = fn;
          }),
        },
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

  it('injects the drawing app into the asking tab only, and reports the result', async () => {
    backgroundDefinition.main();
    const sendResponse = vi.fn();
    const keepOpen = listeners.message?.({ type: 'PAGE_ANCHOR_LOAD_APP' }, { tab: { id: 9 } }, sendResponse);
    expect(keepOpen).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 9 }, files: ['page-app.js'] });
    expect(sendResponse).toHaveBeenCalledWith({ ok: true });
  });

  describe('page screenshots for export', () => {
    const capture = async (tabId = 5) => {
      const sendResponse = vi.fn();
      const keepOpen = listeners.message?.({ type: 'PAGE_ANCHOR_CAPTURE_VIEWPORT' }, { tab: { id: tabId } }, sendResponse);
      expect(keepOpen).toBe(true);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      return sendResponse.mock.calls[0][0];
    };

    beforeEach(() => {
      mockChrome.tabs.get = vi.fn().mockResolvedValue({ id: 5, windowId: 3, active: true });
      mockChrome.tabs.captureVisibleTab = vi.fn().mockResolvedValue('data:image/png;base64,AAAA');
      backgroundDefinition.main();
    });

    it("captures the asking tab's window as PNG", async () => {
      expect(await capture()).toEqual({ dataUrl: 'data:image/png;base64,AAAA' });
      expect(mockChrome.tabs.get).toHaveBeenCalledWith(5);
      expect(mockChrome.tabs.captureVisibleTab).toHaveBeenCalledWith(3, { format: 'png' });
    });

    it('refuses once the asking tab is no longer the one on screen', async () => {
      mockChrome.tabs.get.mockResolvedValue({ id: 5, windowId: 3, active: false });
      expect(await capture()).toEqual({ error: 'tab-inactive' });
      expect(mockChrome.tabs.captureVisibleTab).not.toHaveBeenCalled();
    });

    it("waits out Chrome's capture rate limit and retries", async () => {
      mockChrome.tabs.captureVisibleTab
        .mockRejectedValueOnce(new Error('This request exceeds the MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota.'))
        .mockResolvedValueOnce('data:image/png;base64,BBBB');
      expect(await capture()).toEqual({ dataUrl: 'data:image/png;base64,BBBB' });
      expect(mockChrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(2);
    });

    it('tells a page that refuses screenshots apart from a failed screenshot', async () => {
      mockChrome.tabs.captureVisibleTab.mockRejectedValueOnce(new Error('The extensions gallery cannot be scripted.'));
      expect((await capture()).error).toBe('blocked');
      mockChrome.tabs.captureVisibleTab.mockRejectedValueOnce(new Error('Missing host permission for the tab'));
      expect((await capture()).error).toBe('blocked');
    });

    it('reports other capture failures without retrying', async () => {
      mockChrome.tabs.captureVisibleTab.mockRejectedValue(new Error('Failed to capture tab: unknown error'));
      const response = await capture();
      expect(response.error).toBe('capture-failed');
      expect(response.detail).toMatch(/unknown error/);
      expect(mockChrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(1);
    });

    it('forwards a page area and scale for off-screen capture, and drops malformed ones', async () => {
      const region = { rect: { x: 0, y: 2048, width: 414, height: 2048 }, scale: 2.625 };
      let sendResponse = vi.fn();
      listeners.message?.({ type: 'PAGE_ANCHOR_CAPTURE_VIEWPORT', region }, { tab: { id: 5 } }, sendResponse);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(mockChrome.tabs.captureVisibleTab).toHaveBeenLastCalledWith(3, { format: 'png', rect: region.rect, scale: 2.625 });

      sendResponse = vi.fn();
      const bad = { rect: { x: 0, y: 0, width: -1, height: Number.NaN }, scale: 0 };
      listeners.message?.({ type: 'PAGE_ANCHOR_CAPTURE_VIEWPORT', region: bad }, { tab: { id: 5 } }, sendResponse);
      await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
      expect(mockChrome.tabs.captureVisibleTab).toHaveBeenLastCalledWith(3, { format: 'png' });
    });

    it('ignores capture requests that do not come from a tab', () => {
      expect(listeners.message?.({ type: 'PAGE_ANCHOR_CAPTURE_VIEWPORT' }, {}, vi.fn())).toBe(false);
    });
  });

  it('relays storage change notices to every other tab, key names only', async () => {
    backgroundDefinition.main();
    mockChrome.tabs.query.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
    mockChrome.tabs.sendMessage.mockResolvedValue(undefined);

    listeners.message?.({ type: 'PAGE_ANCHOR_STORAGE_CHANGED', keys: ['page_anchor_data:https://a/', 42] }, { tab: { id: 2 } });
    await new Promise((r) => setTimeout(r, 0));

    const targets = mockChrome.tabs.sendMessage.mock.calls.map((c: [number, unknown]) => c[0]);
    expect(targets).toEqual([1, 3]);
    expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'PAGE_ANCHOR_STORAGE_CHANGED', keys: ['page_anchor_data:https://a/'] });
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

  describe('access to websites', () => {
    const NO_ACCESS = { title: 'Page Anchor needs access to websites' };
    const DEFAULT = { title: 'Page Anchor: toggle drawing toolbar' };

    it('marks the icon while access is missing and clears it once granted', async () => {
      mockChrome.permissions.contains.mockResolvedValue(false);
      backgroundDefinition.main();
      await vi.waitFor(() => expect(mockChrome.action.setTitle).toHaveBeenCalledWith(NO_ACCESS));
      expect(mockChrome.permissions.contains).toHaveBeenCalledWith({ origins: ['<all_urls>'] });
      expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '!' });

      mockChrome.permissions.contains.mockResolvedValue(true);
      mockChrome.tabs.query.mockResolvedValue([{ id: 4, url: 'https://example.com' }]);
      listeners.permissionAdded?.();
      await vi.waitFor(() => expect(mockChrome.action.setTitle).toHaveBeenLastCalledWith(DEFAULT));
      expect(mockChrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
      // Tabs that were already open get the extension without a reload.
      await vi.waitFor(() => expect(mockChrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 4 }, files: ['content-scripts/content.js'] }));
    });

    it('marks the icon again when access is taken away', async () => {
      backgroundDefinition.main();
      await vi.waitFor(() => expect(mockChrome.action.setBadgeText).toHaveBeenCalledWith({ text: '' }));
      mockChrome.permissions.contains.mockResolvedValue(false);
      listeners.permissionRemoved?.();
      await vi.waitFor(() => expect(mockChrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' }));
    });

    it('stops marking the icon once the user keeps access limited, and marks it again if they undo that', async () => {
      mockChrome.permissions.contains.mockResolvedValue(false);
      backgroundDefinition.main();
      await vi.waitFor(() => expect(mockChrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' }));

      stored.site_access_choice = 'limited';
      listeners.storageChanged?.({ site_access_choice: { newValue: 'limited' } });
      await vi.waitFor(() => expect(mockChrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' }));
      expect(mockChrome.action.setTitle).toHaveBeenLastCalledWith(DEFAULT);

      delete stored.site_access_choice;
      listeners.storageChanged?.({ site_access_choice: {} });
      await vi.waitFor(() => expect(mockChrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '!' }));
    });

    it('ignores storage changes that have nothing to do with access', async () => {
      backgroundDefinition.main();
      await vi.waitFor(() => expect(mockChrome.action.setBadgeText).toHaveBeenCalledTimes(1));
      listeners.storageChanged?.({ page_anchor_settings: {} });
      await new Promise((r) => setTimeout(r, 0));
      expect(mockChrome.action.setBadgeText).toHaveBeenCalledTimes(1);
    });

    it("answers the page app about the asking page's own site", async () => {
      mockChrome.permissions.contains.mockImplementation(async ({ origins }: { origins: string[] }) => origins[0] === 'https://allowed.example/*');
      backgroundDefinition.main();
      const ask = async (url: string) => {
        const sendResponse = vi.fn();
        expect(listeners.message?.({ type: 'PAGE_ANCHOR_SITE_ACCESS' }, { tab: { id: 2 }, url } as never, sendResponse)).toBe(true);
        await vi.waitFor(() => expect(sendResponse).toHaveBeenCalled());
        return sendResponse.mock.calls[0][0];
      };
      expect(await ask('https://allowed.example/a/b?c=1')).toEqual({ granted: true });
      expect(await ask('http://blocked.example:8080/x')).toEqual({ granted: false });
      expect(mockChrome.permissions.contains).toHaveBeenCalledWith({ origins: ['http://blocked.example/*'] });
      // Pages that are not websites have nothing to ask for.
      expect(await ask('file:///C:/notes.html')).toEqual({ granted: true });
    });

    it('opens settings on the question of one site when the toolbar asks for it', async () => {
      backgroundDefinition.main();
      listeners.message?.({ type: 'PAGE_ANCHOR_OPEN_OPTIONS', site: 'https://example.com/page' }, { tab: { id: 2 } });
      await vi.waitFor(() => expect(mockChrome.runtime.openOptionsPage).toHaveBeenCalled());
      expect(stored.site_access_request).toEqual({ url: 'https://example.com/page' });
    });

    it('opens plain settings from the More menu', async () => {
      backgroundDefinition.main();
      listeners.message?.({ type: 'PAGE_ANCHOR_OPEN_OPTIONS' }, { tab: { id: 2 } });
      await vi.waitFor(() => expect(mockChrome.runtime.openOptionsPage).toHaveBeenCalled());
      expect(stored.site_access_request).toBeUndefined();
    });

    it('opens the settings page on install when access was not granted', async () => {
      mockChrome.permissions.contains.mockResolvedValue(false);
      backgroundDefinition.main();
      await listeners.onInstalled?.({ reason: 'install' });
      expect(mockChrome.runtime.openOptionsPage).toHaveBeenCalled();
      expect(mockChrome.scripting.executeScript).not.toHaveBeenCalled();
    });

    it('does not open the settings page on install when access was granted', async () => {
      mockChrome.tabs.query.mockResolvedValue([]);
      backgroundDefinition.main();
      await listeners.onInstalled?.({ reason: 'install' });
      expect(mockChrome.runtime.openOptionsPage).not.toHaveBeenCalled();
    });

    it('does not open the settings page on an update, even without access', async () => {
      mockChrome.permissions.contains.mockResolvedValue(false);
      mockChrome.tabs.query.mockResolvedValue([]);
      backgroundDefinition.main();
      await listeners.onInstalled?.({ reason: 'update' });
      expect(mockChrome.runtime.openOptionsPage).not.toHaveBeenCalled();
    });
  });
});

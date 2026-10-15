import { defineBackground } from 'wxt/utils/define-background';

export default defineBackground(() => {
  // Listen for extension commands (e.g. keyboard shortcuts like Alt+D defined in manifest)
  chrome.commands?.onCommand?.addListener(async (command) => {
    if (command === 'toggle-drawing-mode') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_TOGGLE' });
        } catch {
          // If content script was not ready, inject or ignore
        }
      }
    }
  });

  // Handle extension icon click (if popup not opened or triggered via background)
  chrome.action?.onClicked?.addListener(async (tab) => {
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { type: 'PAGE_ANCHOR_TOGGLE' });
      } catch {
        // Tab does not permit scripting or needs refresh
      }
    }
  });
});

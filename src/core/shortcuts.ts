import {
  BrowserConflictInfo,
  ShortcutAction,
  ShortcutDefinition,
  ShortcutHandler,
} from '../types/shortcuts.types';

export type { BrowserConflictInfo, ShortcutAction, ShortcutDefinition, ShortcutHandler };

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  'toggle-active': 'Alt+Shift+D',
  'action-toggle-toolbar': 'Alt+Shift+T',
  'tool-select': 'v',
  'tool-pen': 'p',
  'tool-highlighter': 'h',
  'tool-rect': 'r',
  'tool-circle': 'c',
  'tool-line': 'l',
  'tool-arrow': 'a',
  'tool-double-arrow': 'd',
  'tool-text': 't',
  'tool-eraser': 'e',
  'action-undo': 'Ctrl+z',
  'action-redo': 'Ctrl+y',
  'action-delete': 'Delete',
  'action-clear': 'Alt+Shift+X',
  'action-export': 'Alt+Shift+E',
  'action-select-all': 'Ctrl+a',
};

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'toggle-active',
    name: 'Toggle Drawing Mode',
    description: 'Turn drawing mode on or off across page',
    defaultKey: DEFAULT_SHORTCUTS['toggle-active'],
  },
  {
    id: 'action-toggle-toolbar',
    name: 'Toggle Toolbar Visibility',
    description: 'Collapse or expand the floating toolbar',
    defaultKey: DEFAULT_SHORTCUTS['action-toggle-toolbar'],
  },
  {
    id: 'tool-select',
    name: 'Select / Move Tool',
    description: 'Select elements to move or delete',
    defaultKey: DEFAULT_SHORTCUTS['tool-select'],
  },
  {
    id: 'tool-pen',
    name: 'Freehand Pen',
    description: 'Freehand sketching & drawing tool',
    defaultKey: DEFAULT_SHORTCUTS['tool-pen'],
  },
  {
    id: 'tool-highlighter',
    name: 'Highlighter',
    description: 'Semi-transparent highlighter tool',
    defaultKey: DEFAULT_SHORTCUTS['tool-highlighter'],
  },
  {
    id: 'tool-rect',
    name: 'Rectangle Shape',
    description: 'Draw box or rectangle',
    defaultKey: DEFAULT_SHORTCUTS['tool-rect'],
  },
  {
    id: 'tool-circle',
    name: 'Circle / Ellipse Shape',
    description: 'Draw circle or ellipse',
    defaultKey: DEFAULT_SHORTCUTS['tool-circle'],
  },
  {
    id: 'tool-line',
    name: 'Line Tool',
    description: 'Draw straight line',
    defaultKey: DEFAULT_SHORTCUTS['tool-line'],
  },
  {
    id: 'tool-arrow',
    name: 'Arrow Tool',
    description: 'Draw directional arrow',
    defaultKey: DEFAULT_SHORTCUTS['tool-arrow'],
  },
  {
    id: 'tool-double-arrow',
    name: 'Double-headed Arrow',
    description: 'Draw dimension arrow with heads on both ends',
    defaultKey: DEFAULT_SHORTCUTS['tool-double-arrow'],
  },
  {
    id: 'tool-text',
    name: 'Text Annotation',
    description: 'Add text note on page',
    defaultKey: DEFAULT_SHORTCUTS['tool-text'],
  },
  {
    id: 'tool-eraser',
    name: 'Eraser Tool',
    description: 'Erase strokes or shapes',
    defaultKey: DEFAULT_SHORTCUTS['tool-eraser'],
  },
  {
    id: 'action-undo',
    name: 'Undo',
    description: 'Undo previous drawing action',
    defaultKey: DEFAULT_SHORTCUTS['action-undo'],
  },
  {
    id: 'action-redo',
    name: 'Redo',
    description: 'Redo undone action',
    defaultKey: DEFAULT_SHORTCUTS['action-redo'],
  },
  {
    id: 'action-delete',
    name: 'Delete Selected',
    description: 'Remove the selected element(s)',
    defaultKey: DEFAULT_SHORTCUTS['action-delete'],
  },
  {
    id: 'action-clear',
    name: 'Clear All',
    description: 'Clear all annotations on current page',
    defaultKey: DEFAULT_SHORTCUTS['action-clear'],
  },
  {
    id: 'action-export',
    name: 'Export Image',
    description: 'Export annotated page as PNG screenshot',
    defaultKey: DEFAULT_SHORTCUTS['action-export'],
  },
  {
    id: 'action-select-all',
    name: 'Select All Elements',
    description: 'Select all drawn elements on page to move or delete all at once',
    defaultKey: DEFAULT_SHORTCUTS['action-select-all'],
  },
];

/**
 * Normalizes a KeyboardEvent into a canonical shortcut string (e.g. "Ctrl+Shift+K").
 */
export function normalizeKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = [];

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  if (e.ctrlKey && !isMac) parts.push('Ctrl');
  if (e.metaKey) parts.push(isMac ? 'Cmd' : 'Meta');
  if (e.ctrlKey && isMac) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  let key = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    return '';
  }

  if (key === ' ') key = 'Space';
  else if (key === 'Escape') key = 'Esc';
  else if (key.length === 1) key = key.toLowerCase();

  parts.push(key);
  return parts.join('+');
}

/**
 * Formats a key combo string for display with platform styling.
 */
export function formatShortcutForDisplay(keyCombo: string): string {
  if (!keyCombo) return 'None';
  return keyCombo
    .replace('Ctrl', '⌃ Ctrl')
    .replace('Cmd', '⌘ Cmd')
    .replace('Alt', '⌥ Alt')
    .replace('Shift', '⇧ Shift');
}

/**
 * Comprehensive cross-browser collision dictionary.
 * Covers Chrome, Firefox, Safari, Edge, Opera, and OS-level system shortcuts.
 */
export const BROWSER_RESERVED_CONFLICTS: Record<string, BrowserConflictInfo> = {
  'ctrl+t': { browser: 'All Browsers', action: 'Open new tab' },
  'cmd+t': { browser: 'All Browsers (macOS)', action: 'Open new tab' },
  'ctrl+w': { browser: 'All Browsers', action: 'Close active tab' },
  'cmd+w': { browser: 'All Browsers (macOS)', action: 'Close active tab' },
  'ctrl+n': { browser: 'All Browsers', action: 'Open new window' },
  'cmd+n': { browser: 'All Browsers (macOS)', action: 'Open new window' },
  'ctrl+shift+t': { browser: 'All Browsers', action: 'Reopen last closed tab' },
  'cmd+shift+t': { browser: 'All Browsers (macOS)', action: 'Reopen last closed tab' },
  'ctrl+shift+w': { browser: 'All Browsers', action: 'Close active window' },
  'cmd+shift+w': { browser: 'All Browsers (macOS)', action: 'Close active window' },
  'ctrl+tab': { browser: 'All Browsers', action: 'Switch to next tab' },
  'ctrl+shift+tab': { browser: 'All Browsers', action: 'Switch to previous tab' },
  'ctrl+r': { browser: 'All Browsers', action: 'Reload page' },
  'cmd+r': { browser: 'All Browsers (macOS)', action: 'Reload page' },
  'f5': { browser: 'All Browsers', action: 'Reload page' },
  'ctrl+shift+r': { browser: 'All Browsers', action: 'Hard reload page' },
  'cmd+shift+r': { browser: 'Safari / All (macOS)', action: 'Hard reload / Reader Mode' },
  'ctrl+f5': { browser: 'All Browsers', action: 'Hard reload page' },
  'ctrl+l': { browser: 'All Browsers', action: 'Focus address bar (omnibox)' },
  'cmd+l': { browser: 'All Browsers (macOS)', action: 'Focus address bar' },
  'ctrl+d': { browser: 'All Browsers', action: 'Bookmark current page' },
  'cmd+d': { browser: 'All Browsers (macOS)', action: 'Bookmark current page' },
  'ctrl+shift+d': { browser: 'All Browsers', action: 'Bookmark all tabs' },
  'cmd+shift+d': { browser: 'Safari / Chrome (macOS)', action: 'Add to Reading List / Bookmark tabs' },
  'ctrl+f': { browser: 'All Browsers', action: 'Find on page' },
  'cmd+f': { browser: 'All Browsers (macOS)', action: 'Find on page' },
  'f3': { browser: 'All Browsers', action: 'Find next' },
  'ctrl+g': { browser: 'All Browsers', action: 'Find next match' },
  'cmd+g': { browser: 'All Browsers (macOS)', action: 'Find next match' },
  'ctrl+shift+g': { browser: 'All Browsers', action: 'Find previous match' },
  'cmd+shift+g': { browser: 'All Browsers (macOS)', action: 'Find previous match' },
  'ctrl+p': { browser: 'All Browsers', action: 'Print page' },
  'cmd+p': { browser: 'All Browsers (macOS)', action: 'Print page' },
  'ctrl+s': { browser: 'All Browsers', action: 'Save page' },
  'cmd+s': { browser: 'All Browsers (macOS)', action: 'Save page' },
  'ctrl+u': { browser: 'All Browsers', action: 'View page source' },
  'ctrl+h': { browser: 'All Browsers', action: 'Open browsing history' },
  'ctrl+j': { browser: 'All Browsers', action: 'Open downloads manager' },
  'f11': { browser: 'All Browsers', action: 'Toggle full screen mode' },
  'ctrl+shift+delete': { browser: 'All Browsers', action: 'Clear browsing data dialog' },
  'alt+home': { browser: 'All Browsers', action: 'Navigate to home page' },
  'alt+left': { browser: 'All Browsers', action: 'Back history navigation' },
  'alt+right': { browser: 'All Browsers', action: 'Forward history navigation' },
  'alt+d': { browser: 'Chrome / Edge', action: 'Focus address bar (omnibox)' },
  'ctrl+shift+n': { browser: 'Chrome / Edge / Opera', action: 'Open Incognito / InPrivate window' },
  'cmd+shift+n': { browser: 'Chrome / Safari (macOS)', action: 'Open Incognito / Private window' },
  'ctrl+shift+b': { browser: 'Chrome / Edge', action: 'Toggle bookmarks bar' },
  'cmd+shift+b': { browser: 'Chrome (macOS)', action: 'Toggle bookmarks bar' },
  'ctrl+shift+j': { browser: 'Chrome / Edge', action: 'Open JavaScript Console' },
  'alt+f': { browser: 'Chrome / Edge', action: 'Open main browser menu / Settings' },
  'alt+e': { browser: 'Chrome / Edge', action: 'Open browser options menu' },
  'ctrl+shift+p': { browser: 'Firefox', action: 'Open Private Browsing window' },
  'ctrl+k': { browser: 'Firefox', action: 'Focus search bar in address area' },
  'ctrl+e': { browser: 'Firefox', action: 'Focus Web Search bar' },
  'ctrl+shift+a': { browser: 'Firefox', action: 'Open Add-ons & Themes manager' },
  'ctrl+shift+k': { browser: 'Firefox', action: 'Open Web Console' },
  'ctrl+shift+e': { browser: 'Firefox', action: 'Open Network Monitor' },
  'ctrl+shift+m': { browser: 'Firefox / Chrome / Edge', action: 'Responsive Design Mode (Firefox) / Switch Profile (Edge)' },
  'ctrl+shift+o': { browser: 'Firefox / Edge / Chrome', action: 'Open Bookmarks organizer / Favorites flyout' },
  'ctrl+shift+y': { browser: 'Firefox / Edge', action: 'Open Downloads library (Firefox) / Collections (Edge)' },
  'ctrl+b': { browser: 'Firefox', action: 'Toggle Bookmarks sidebar' },
  'cmd+b': { browser: 'Firefox (macOS)', action: 'Toggle Bookmarks sidebar' },
  'alt+t': { browser: 'Firefox', action: 'Open Tools menu bar' },
  'alt+v': { browser: 'Firefox', action: 'Open View menu bar' },
  'alt+s': { browser: 'Firefox', action: 'Open History menu bar' },
  'alt+b': { browser: 'Firefox', action: 'Open Bookmarks menu bar' },
  'alt+h': { browser: 'Firefox', action: 'Open Help menu bar' },
  'ctrl+shift+s': { browser: 'Edge / Firefox', action: 'Web Capture / Screenshot tool' },
  'ctrl+shift+u': { browser: 'Edge', action: 'Start Read Aloud' },
  'cmd+alt+i': { browser: 'Safari / Chrome (macOS)', action: 'Open Web Inspector' },
  'cmd+alt+c': { browser: 'Safari / Chrome (macOS)', action: 'Open JavaScript Console' },
  'cmd+alt+e': { browser: 'Safari', action: 'Empty Developer Caches' },
  'cmd+alt+u': { browser: 'Safari', action: 'Show Page Source' },
  'cmd+alt+l': { browser: 'Safari', action: 'Show Downloads' },
  'cmd+alt+b': { browser: 'Safari', action: 'Manage Bookmarks' },
  'cmd+alt+a': { browser: 'Safari', action: 'Show All Tabs Overview' },
  'cmd+y': { browser: 'Safari', action: 'Show History' },
  'cmd+ctrl+f': { browser: 'Safari (macOS)', action: 'Toggle Full Screen' },
  'f12': { browser: 'All Browsers', action: 'Open Developer Tools' },
  'ctrl+shift+i': { browser: 'All Browsers', action: 'Open Developer Tools' },
  'ctrl+shift+c': { browser: 'All Browsers', action: 'Inspect Element' },
  'alt+f4': { browser: 'System (Windows)', action: 'Close active application' },
  'cmd+q': { browser: 'System (macOS)', action: 'Quit application' },
  'cmd+m': { browser: 'System (macOS)', action: 'Minimize active window' },
  'cmd+h': { browser: 'System (macOS)', action: 'Hide application' },
};

/**
 * Set of all lowercase reserved shortcut strings for fast O(1) membership testing.
 */
export const RESERVED_BROWSER_SHORTCUTS = new Set(Object.keys(BROWSER_RESERVED_CONFLICTS));

/**
 * Checks whether a key combination conflicts with any known browser or OS shortcut.
 */
export function isReservedBrowserShortcut(combo: string): boolean {
  return getBrowserShortcutConflict(combo) !== null;
}

/**
 * Retrieves the specific browser and conflicting action for a given shortcut key combo.
 * Seamlessly normalizes 'opt' / 'option' to 'alt' across macOS and Windows.
 */
export function getBrowserShortcutConflict(combo: string): BrowserConflictInfo | null {
  if (!combo) return null;
  const normalized = combo
    .toLowerCase()
    .trim()
    .replace(/\bopt\b/g, 'alt')
    .replace(/\boption\b/g, 'alt');
  return BROWSER_RESERVED_CONFLICTS[normalized] || null;
}

/**
 * Robust shortcut listener and dispatcher.
 * Enforces active-mode tool silencing and form input suppression.
 */
export class ShortcutManager {
  private activeShortcuts: Record<ShortcutAction, string> = { ...DEFAULT_SHORTCUTS };
  private listeners: ShortcutHandler[] = [];
  private boundHandler: (e: KeyboardEvent) => void;
  private activeModeGetter?: () => boolean;

  constructor(
    customShortcuts?: Partial<Record<ShortcutAction, string>>,
    activeModeGetter?: () => boolean
  ) {
    if (customShortcuts) {
      this.activeShortcuts = { ...this.activeShortcuts, ...customShortcuts };
    }
    this.activeModeGetter = activeModeGetter;
    this.boundHandler = this.handleKeyDown.bind(this);
  }

  public setActiveModeGetter(getter: () => boolean): void {
    this.activeModeGetter = getter;
  }

  public setShortcuts(shortcuts: Record<ShortcutAction, string>): void {
    this.activeShortcuts = { ...shortcuts };
  }

  public getShortcuts(): Record<ShortcutAction, string> {
    return { ...this.activeShortcuts };
  }

  public addListener(handler: ShortcutHandler): () => void {
    this.listeners.push(handler);
    return () => {
      this.listeners = this.listeners.filter((h) => h !== handler);
    };
  }

  public attach(): void {
    window.addEventListener('keydown', this.boundHandler, true);
  }

  public detach(): void {
    window.removeEventListener('keydown', this.boundHandler, true);
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target && typeof target.getAttribute === 'function') {
      const tagName = target.tagName?.toLowerCase();
      const isInput =
        tagName === 'input' ||
        tagName === 'textarea' ||
        target.isContentEditable ||
        target.getAttribute('contenteditable') === 'true';

      if (isInput && e.key !== 'Escape') {
        return;
      }
    }

    const pressedKey = normalizeKeyEvent(e);
    if (!pressedKey) return;

    const isDrawingActive = this.activeModeGetter ? this.activeModeGetter() : true;

    for (const [actionId, shortcutKey] of Object.entries(this.activeShortcuts)) {
      if (this.isMatch(pressedKey, shortcutKey)) {
        const isGlobalToggle = actionId === 'toggle-active' || actionId === 'action-toggle-toolbar';

        if (!isDrawingActive && !isGlobalToggle) {
          continue;
        }

        e.preventDefault();
        e.stopPropagation();
        this.listeners.forEach((fn) => fn(actionId as ShortcutAction, e));
        return;
      }
    }
  }

  private isMatch(pressed: string, registered: string): boolean {
    if (!registered || !pressed) return false;
    return pressed.toLowerCase() === registered.toLowerCase();
  }
}

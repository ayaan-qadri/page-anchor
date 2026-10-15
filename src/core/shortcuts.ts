import { ShortcutAction, ShortcutDefinition } from './types';
import { DEFAULT_SHORTCUTS } from './storage';

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'toggle-active',
    name: 'Toggle Drawing Mode',
    description: 'Turn drawing mode on or off',
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
];

/**
 * Normalizes a KeyboardEvent into a standard canonical shortcut string (e.g. "Ctrl+Shift+K").
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

  // Ignore bare modifier presses
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(key)) {
    return '';
  }

  // Canonicalize special keys
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

export type ShortcutHandler = (action: ShortcutAction, event: KeyboardEvent) => void;

export class ShortcutManager {
  private activeShortcuts: Record<ShortcutAction, string> = { ...DEFAULT_SHORTCUTS };
  private listeners: ShortcutHandler[] = [];
  private boundHandler: (e: KeyboardEvent) => void;

  constructor(customShortcuts?: Partial<Record<ShortcutAction, string>>) {
    if (customShortcuts) {
      this.activeShortcuts = { ...this.activeShortcuts, ...customShortcuts };
    }
    this.boundHandler = this.handleKeyDown.bind(this);
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
    // If user is currently typing in an input, textarea, contenteditable, don't hijack unless it's Escape
    const target = e.target as HTMLElement | null;
    if (target) {
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

    // Check matches
    for (const [actionId, shortcutKey] of Object.entries(this.activeShortcuts)) {
      if (this.isMatch(pressedKey, shortcutKey)) {
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

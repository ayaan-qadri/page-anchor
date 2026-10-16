export type ShortcutAction =
  | 'toggle-active'
  | 'tool-select'
  | 'tool-pen'
  | 'tool-highlighter'
  | 'tool-rect'
  | 'tool-circle'
  | 'tool-line'
  | 'tool-arrow'
  | 'tool-double-arrow'
  | 'tool-text'
  | 'tool-eraser'
  | 'action-undo'
  | 'action-redo'
  | 'action-delete'
  | 'action-clear'
  | 'action-export'
  | 'action-toggle-toolbar'
  | 'action-select-all';

export interface ShortcutDefinition {
  id: ShortcutAction;
  name: string;
  description: string;
  defaultKey: string;
}

export interface BrowserConflictInfo {
  browser: string;
  action: string;
}

export type ShortcutHandler = (action: ShortcutAction, event: KeyboardEvent) => void;

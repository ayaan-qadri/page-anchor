import { TextElement } from './engine.types';
import { ExtensionSettings } from './storage.types';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * UI COMPONENT CALLBACKS & VIEW STATE TYPE DEFINITIONS
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface ToolbarCallbacks {
  onClear?: () => void;
  onExport?: () => void;
  onSettingsUpdate?: (settings: ExtensionSettings) => void;
  onToggleActive?: (active: boolean) => void;
}

export interface SettingsModalCallbacks {
  onSave?: (settings: ExtensionSettings) => void;
  onClose?: () => void;
}

export interface TextEditorCallbacks {
  onCommit?: (text: string, element: TextElement) => void;
  onCancel?: () => void;
}

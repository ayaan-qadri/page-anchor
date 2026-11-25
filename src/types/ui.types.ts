import { TextElement } from './engine.types';
import { ExtensionSettings } from './storage.types';

export interface ToolbarCallbacks {
  onClear?: () => void;
  onSettingsUpdate?: (settings: ExtensionSettings) => void;
  onToggleActive?: (active: boolean) => void;
  onToggleDomAnchoring?: (enabled: boolean) => void;
  /** Opens the extension's options page, where settings and backup live. */
  onOpenOptions?: () => void;
  onExport?: (format: 'png' | 'pdf') => void;
  /** Absent where the browser cannot print; the menu then has no Print item. */
  onPrint?: () => void;
  onCaptureArea?: () => void;
}

export interface TextEditorCallbacks {
  onCommit?: (text: string, element: TextElement) => void;
  onCancel?: () => void;
}

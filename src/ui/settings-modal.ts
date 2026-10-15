import { ShortcutAction } from '../types/shortcuts.types';
import { ExtensionSettings } from '../types/storage.types';
import { SettingsModalCallbacks } from '../types/ui.types';
import {
  SHORTCUT_DEFINITIONS,
  formatShortcutForDisplay,
  normalizeKeyEvent,
  isReservedBrowserShortcut,
  getBrowserShortcutConflict,
} from '../core/shortcuts';
import { DEFAULT_SETTINGS, saveSettings } from '../core/storage';
import { ICONS } from '../icons/svg-icons';

export type { SettingsModalCallbacks };

export class SettingsModal {
  private container: HTMLElement;
  private currentModal: HTMLElement | null = null;
  private settings: ExtensionSettings;
  private callbacks: SettingsModalCallbacks;
  private recordingAction: ShortcutAction | null = null;
  private recordingKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(
    container: HTMLElement,
    settings: ExtensionSettings,
    callbacks: SettingsModalCallbacks = {}
  ) {
    this.container = container;
    this.settings = JSON.parse(JSON.stringify(settings));
    this.callbacks = callbacks;
  }

  public open(): void {
    this.close();

    const backdrop = document.createElement('div');
    backdrop.className = 'pa-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'pa-modal';

    const header = document.createElement('div');
    header.className = 'pa-modal-header';
    header.innerHTML = `
      <div class="pa-modal-title">
        ${ICONS.settings}
        <span>Page Anchor Settings</span>
      </div>
      <button class="pa-modal-close" title="Close">${ICONS.close}</button>
    `;

    const body = document.createElement('div');
    body.className = 'pa-modal-body';

    const shortcutSection = document.createElement('div');
    shortcutSection.innerHTML = `<div class="pa-section-title">Keyboard Shortcuts (Click to Rebind)</div>`;

    const shortcutsList = document.createElement('div');
    shortcutsList.style.display = 'flex';
    shortcutsList.style.flexDirection = 'column';
    shortcutsList.style.gap = '6px';

    SHORTCUT_DEFINITIONS.forEach((def) => {
      const row = document.createElement('div');
      row.className = 'pa-shortcut-row';

      const info = document.createElement('div');
      info.className = 'pa-shortcut-info';
      info.innerHTML = `
        <span class="pa-shortcut-name">${def.name}</span>
        <span class="pa-shortcut-desc">${def.description}</span>
      `;

      const currentKey = this.settings.shortcuts[def.id] || def.defaultKey;
      const recordBtn = document.createElement('button');
      recordBtn.className = 'pa-shortcut-record-btn';
      recordBtn.textContent = formatShortcutForDisplay(currentKey);
      recordBtn.title = 'Click to record new shortcut';

      recordBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.startRecording(def.id, recordBtn);
      });

      row.appendChild(info);
      row.appendChild(recordBtn);
      shortcutsList.appendChild(row);
    });

    shortcutSection.appendChild(shortcutsList);
    body.appendChild(shortcutSection);

    const persistSection = document.createElement('div');
    persistSection.innerHTML = `<div class="pa-section-title">Persistence & URL Matching</div>`;

    const urlMatchRow = document.createElement('div');
    urlMatchRow.className = 'pa-shortcut-row';
    urlMatchRow.innerHTML = `
      <div class="pa-shortcut-info">
        <span class="pa-shortcut-name">URL Matching Mode</span>
        <span class="pa-shortcut-desc">How drawings are associated with web pages</span>
      </div>
    `;

    const select = document.createElement('select');
    select.style.background = 'rgba(255, 255, 255, 0.08)';
    select.style.color = '#ffffff';
    select.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    select.style.borderRadius = '6px';
    select.style.padding = '4px 8px';
    select.style.outline = 'none';

    select.innerHTML = `
      <option value="clean" ${this.settings.urlMatchMode === 'clean' ? 'selected' : ''}>Clean URL (strip tracking params & hashes)</option>
      <option value="exact" ${this.settings.urlMatchMode === 'exact' ? 'selected' : ''}>Exact URL (preserve all params)</option>
      <option value="domain" ${this.settings.urlMatchMode === 'domain' ? 'selected' : ''}>Entire Domain / Hostname</option>
    `;

    select.addEventListener('change', () => {
      this.settings.urlMatchMode = select.value as 'clean' | 'exact' | 'domain';
    });

    urlMatchRow.appendChild(select);
    persistSection.appendChild(urlMatchRow);
    body.appendChild(persistSection);

    const perfSection = document.createElement('div');
    perfSection.innerHTML = `<div class="pa-section-title">Optimization</div>`;

    const perfRow = document.createElement('div');
    perfRow.className = 'pa-shortcut-row';
    perfRow.innerHTML = `
      <div class="pa-shortcut-info">
        <span class="pa-shortcut-name">Zero-Lag Performance Mode</span>
        <span class="pa-shortcut-desc">Enables spatial frustum culling & adaptive point smoothing</span>
      </div>
    `;

    const perfCheckbox = document.createElement('input');
    perfCheckbox.type = 'checkbox';
    perfCheckbox.checked = this.settings.performanceMode;
    perfCheckbox.style.cursor = 'pointer';
    perfCheckbox.style.width = '18px';
    perfCheckbox.style.height = '18px';
    perfCheckbox.addEventListener('change', () => {
      this.settings.performanceMode = perfCheckbox.checked;
    });

    perfRow.appendChild(perfCheckbox);
    perfSection.appendChild(perfRow);
    body.appendChild(perfSection);

    const footer = document.createElement('div');
    footer.className = 'pa-modal-footer';

    const resetBtn = document.createElement('button');
    resetBtn.className = 'pa-action-btn pa-btn-secondary';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.addEventListener('click', () => {
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this.open();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pa-action-btn pa-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = document.createElement('button');
    saveBtn.className = 'pa-action-btn pa-btn-primary';
    saveBtn.textContent = 'Save Settings';
    saveBtn.addEventListener('click', async () => {
      await saveSettings(this.settings);
      this.callbacks.onSave?.(this.settings);
      this.close();
    });

    footer.appendChild(resetBtn);
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    backdrop.appendChild(modal);

    header.querySelector('.pa-modal-close')?.addEventListener('click', () => this.close());

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.close();
      }
    });

    this.container.appendChild(backdrop);
    this.currentModal = backdrop;
  }

  private startRecording(actionId: ShortcutAction, btn: HTMLButtonElement): void {
    if (this.recordingKeyHandler) {
      window.removeEventListener('keydown', this.recordingKeyHandler, true);
    }

    this.recordingAction = actionId;
    btn.classList.add('recording');
    btn.textContent = 'Press keys...';

    this.recordingKeyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const combo = normalizeKeyEvent(e);
      if (!combo) return;

      this.settings.shortcuts[actionId] = combo;
      btn.textContent = formatShortcutForDisplay(combo);
      btn.classList.remove('recording');

      const conflict = getBrowserShortcutConflict(combo);
      if (conflict) {
        btn.style.borderColor = '#f59e0b';
        btn.style.color = '#fbbf24';
        btn.title = `Warning: "${combo}" conflicts with ${conflict.browser} (${conflict.action}). Key may be intercepted by the browser.`;
      } else {
        btn.style.borderColor = '';
        btn.style.color = '';
        btn.title = 'Click to record new shortcut';
      }

      if (this.recordingKeyHandler) {
        window.removeEventListener('keydown', this.recordingKeyHandler, true);
        this.recordingKeyHandler = null;
      }
      this.recordingAction = null;
    };

    window.addEventListener('keydown', this.recordingKeyHandler, true);
  }

  public close(): void {
    if (this.recordingKeyHandler) {
      window.removeEventListener('keydown', this.recordingKeyHandler, true);
      this.recordingKeyHandler = null;
    }
    if (this.currentModal) {
      this.currentModal.remove();
      this.currentModal = null;
    }
    this.callbacks.onClose?.();
  }
}

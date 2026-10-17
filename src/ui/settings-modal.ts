import { ShortcutAction } from '../types/shortcuts.types';
import { ExtensionSettings } from '../types/storage.types';
import { SettingsModalCallbacks } from '../types/ui.types';
import {
  SHORTCUT_DEFINITIONS,
  formatShortcutForDisplay,
  normalizeKeyEvent,
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
  private previousActiveElement: HTMLElement | null = null;
  private modalKeydownHandler: ((e: KeyboardEvent) => void) | null = null;

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

    this.previousActiveElement = document.activeElement as HTMLElement | null;

    const backdrop = document.createElement('div');
    backdrop.className = 'pa-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'pa-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pa-settings-modal-title');

    const header = document.createElement('div');
    header.className = 'pa-modal-header';
    header.innerHTML = `
      <div id="pa-settings-modal-title" class="pa-modal-title">
        ${ICONS.settings}
        <span>Page Anchor Settings</span>
      </div>
      <button class="pa-modal-close" title="Close" aria-label="Close settings">${ICONS.close}</button>
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
      recordBtn.type = 'button';
      recordBtn.className = 'pa-shortcut-record-btn';
      recordBtn.textContent = formatShortcutForDisplay(currentKey);
      recordBtn.title = 'Click to record new shortcut (Esc to cancel)';
      recordBtn.setAttribute(
        'aria-label',
        `Rebind shortcut for ${def.name}. Current shortcut is ${formatShortcutForDisplay(currentKey)}`
      );

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

    const urlMatchSelect = document.createElement('select');
    urlMatchSelect.id = 'pa-modal-url-match';
    this.styleSelect(urlMatchSelect, 'URL Matching Mode');

    urlMatchSelect.innerHTML = `
      <option value="clean" ${this.settings.urlMatchMode === 'clean' ? 'selected' : ''}>Clean URL (strip tracking params & hashes)</option>
      <option value="exact" ${this.settings.urlMatchMode === 'exact' ? 'selected' : ''}>Exact URL (preserve all params)</option>
      <option value="domain" ${this.settings.urlMatchMode === 'domain' ? 'selected' : ''}>Entire Domain / Hostname</option>
    `;

    urlMatchSelect.addEventListener('change', () => {
      this.settings.urlMatchMode = urlMatchSelect.value as 'clean' | 'exact' | 'domain';
    });

    const urlMatchInfo = document.createElement('label');
    urlMatchInfo.htmlFor = 'pa-modal-url-match';
    urlMatchInfo.className = 'pa-shortcut-info';
    urlMatchInfo.innerHTML = `
      <span class="pa-shortcut-name">URL Matching Mode</span>
      <span class="pa-shortcut-desc">How drawings are associated with web pages</span>
    `;

    urlMatchRow.appendChild(urlMatchInfo);
    urlMatchRow.appendChild(urlMatchSelect);
    persistSection.appendChild(urlMatchRow);
    body.appendChild(persistSection);

    const anchorSection = document.createElement('div');
    anchorSection.innerHTML = `<div class="pa-section-title">Smart Element Anchoring</div>`;

    const anchorRow = document.createElement('div');
    anchorRow.className = 'pa-shortcut-row';

    const anchorCheckbox = document.createElement('input');
    anchorCheckbox.id = 'pa-modal-dom-anchor';
    anchorCheckbox.type = 'checkbox';
    anchorCheckbox.checked = this.settings.domAnchoringEnabled ?? true;
    anchorCheckbox.style.cursor = 'pointer';
    anchorCheckbox.style.width = '18px';
    anchorCheckbox.style.height = '18px';
    anchorCheckbox.setAttribute('aria-label', 'Enable Smart DOM Element Anchoring by default');
    anchorCheckbox.addEventListener('change', () => {
      this.settings.domAnchoringEnabled = anchorCheckbox.checked;
    });

    const anchorLabel = document.createElement('label');
    anchorLabel.htmlFor = 'pa-modal-dom-anchor';
    anchorLabel.className = 'pa-shortcut-info';
    anchorLabel.innerHTML = `
      <span class="pa-shortcut-name">Smart Element Anchoring</span>
      <span class="pa-shortcut-desc">Pins highlights to DOM elements (follows moving GitHub issues, cards, comments)</span>
    `;

    anchorRow.appendChild(anchorLabel);
    anchorRow.appendChild(anchorCheckbox);
    anchorSection.appendChild(anchorRow);

    const orphanRow = document.createElement('div');
    orphanRow.className = 'pa-shortcut-row';

    const orphanSelect = document.createElement('select');
    orphanSelect.id = 'pa-modal-orphan-mode';
    this.styleSelect(orphanSelect, 'When annotated element disappears or is removed from page');

    orphanSelect.innerHTML = `
      <option value="hide" ${(this.settings.orphanedAnchorMode || 'hide') === 'hide' ? 'selected' : ''}>Hide automatically (Default)</option>
      <option value="dimmed" ${this.settings.orphanedAnchorMode === 'dimmed' ? 'selected' : ''}>Remain visible at original location (Dimmed)</option>
    `;

    orphanSelect.addEventListener('change', () => {
      this.settings.orphanedAnchorMode = orphanSelect.value as 'hide' | 'dimmed';
    });

    const orphanInfo = document.createElement('label');
    orphanInfo.htmlFor = 'pa-modal-orphan-mode';
    orphanInfo.className = 'pa-shortcut-info';
    orphanInfo.innerHTML = `
      <span class="pa-shortcut-name">When Marked Item Is Not Found</span>
      <span class="pa-shortcut-desc">Behavior when an annotated issue is closed or on another page</span>
    `;

    orphanRow.appendChild(orphanInfo);
    orphanRow.appendChild(orphanSelect);
    anchorSection.appendChild(orphanRow);

    body.appendChild(anchorSection);

    const perfSection = document.createElement('div');
    perfSection.innerHTML = `<div class="pa-section-title">Optimization</div>`;

    const perfCheckbox = document.createElement('input');
    perfCheckbox.id = 'pa-modal-perf-mode';
    perfCheckbox.type = 'checkbox';
    perfCheckbox.checked = this.settings.performanceMode;
    perfCheckbox.style.cursor = 'pointer';
    perfCheckbox.style.width = '18px';
    perfCheckbox.style.height = '18px';
    perfCheckbox.setAttribute('aria-label', 'Enable Zero-Lag Performance Mode');
    perfCheckbox.addEventListener('change', () => {
      this.settings.performanceMode = perfCheckbox.checked;
    });

    const perfLabel = document.createElement('label');
    perfLabel.htmlFor = 'pa-modal-perf-mode';
    perfLabel.className = 'pa-shortcut-row';
    perfLabel.style.cursor = 'pointer';
    perfLabel.innerHTML = `
      <div class="pa-shortcut-info">
        <span class="pa-shortcut-name">Zero-Lag Performance Mode</span>
        <span class="pa-shortcut-desc">Enables spatial frustum culling & adaptive point smoothing</span>
      </div>
    `;
    perfLabel.appendChild(perfCheckbox);
    perfSection.appendChild(perfLabel);
    body.appendChild(perfSection);

    const footer = document.createElement('div');
    footer.className = 'pa-modal-footer';

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'pa-action-btn pa-btn-secondary';
    resetBtn.textContent = 'Reset to Defaults';
    resetBtn.addEventListener('click', () => {
      this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      this.open();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pa-action-btn pa-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => this.close());

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
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

    const closeBtn = header.querySelector('.pa-modal-close') as HTMLElement;
    closeBtn?.addEventListener('click', () => this.close());

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.close();
      }
    });

    // Focus Trap & Keyboard Handling (WCAG 2.1.2, 2.4.3)
    this.modalKeydownHandler = (e: KeyboardEvent) => {
      if (this.recordingAction) {
        // While actively recording a shortcut key, let the recording key handler handle it
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(
          modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', this.modalKeydownHandler, true);

    this.container.appendChild(backdrop);
    this.currentModal = backdrop;

    // Initial focus on close button or first interactive element
    setTimeout(() => {
      closeBtn?.focus();
    }, 50);
  }

  /** Omits `outline: none`, which would beat the `:focus-visible` ring (WCAG 2.4.7). */
  private styleSelect(select: HTMLSelectElement, ariaLabel: string): void {
    select.style.background = 'rgba(255, 255, 255, 0.08)';
    select.style.color = '#ffffff';
    select.style.border = '1px solid rgba(255, 255, 255, 0.15)';
    select.style.borderRadius = '6px';
    select.style.padding = '4px 8px';
    select.setAttribute('aria-label', ariaLabel);
  }

  private startRecording(actionId: ShortcutAction, btn: HTMLButtonElement): void {
    if (this.recordingKeyHandler) {
      window.removeEventListener('keydown', this.recordingKeyHandler, true);
    }

    const def = SHORTCUT_DEFINITIONS.find((d) => d.id === actionId);
    const actionName = def ? def.name : actionId;

    this.recordingAction = actionId;
    btn.classList.add('recording');
    btn.textContent = 'Press keys...';
    btn.setAttribute('aria-label', `Recording shortcut for ${actionName}. Press keys, or press Escape to cancel.`);

    this.recordingKeyHandler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        const prevKey = this.settings.shortcuts[actionId] || (def ? def.defaultKey : '');
        btn.textContent = formatShortcutForDisplay(prevKey);
        btn.classList.remove('recording');
        btn.setAttribute(
          'aria-label',
          `Rebind shortcut for ${actionName}. Current shortcut is ${formatShortcutForDisplay(prevKey)}`
        );
        if (this.recordingKeyHandler) {
          window.removeEventListener('keydown', this.recordingKeyHandler, true);
          this.recordingKeyHandler = null;
        }
        this.recordingAction = null;
        return;
      }

      const combo = normalizeKeyEvent(e);
      if (!combo) return;

      this.settings.shortcuts[actionId] = combo;
      btn.textContent = formatShortcutForDisplay(combo);
      btn.classList.remove('recording');
      btn.setAttribute(
        'aria-label',
        `Rebind shortcut for ${actionName}. Current shortcut is ${formatShortcutForDisplay(combo)}`
      );

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
    if (this.modalKeydownHandler) {
      window.removeEventListener('keydown', this.modalKeydownHandler, true);
      this.modalKeydownHandler = null;
    }
    if (this.currentModal) {
      this.currentModal.remove();
      this.currentModal = null;
    }

    // Restore focus to previously active element
    this.previousActiveElement?.focus();
    this.previousActiveElement = null;

    this.callbacks.onClose?.();
  }
}

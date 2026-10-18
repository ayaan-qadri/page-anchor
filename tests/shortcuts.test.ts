import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_DEFINITIONS,
  formatShortcutForDisplay,
  normalizeKeyEvent,
  ShortcutManager,
} from '../src/core/shortcuts';

describe('Shortcuts Engine: Keyboard Normalization & Dispatching', () => {
  it('normalizes single keys and combined modifier keys consistently', () => {
    expect(normalizeKeyEvent({ key: 'p', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent)).toBe('p');
    expect(normalizeKeyEvent({ key: 'P', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent)).toBe('p');

    expect(normalizeKeyEvent({ key: 'd', altKey: true, ctrlKey: false, shiftKey: false, metaKey: false } as KeyboardEvent)).toBe('Alt+d');
    expect(normalizeKeyEvent({ key: 'z', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent)).toBe('Ctrl+z');
    expect(normalizeKeyEvent({ key: 'Z', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false } as KeyboardEvent)).toBe('Ctrl+Shift+z');

    expect(normalizeKeyEvent({ key: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent)).toBe('Esc');
    expect(normalizeKeyEvent({ key: ' ', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent)).toBe('Space');

    expect(normalizeKeyEvent({ key: 'Control', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false } as KeyboardEvent)).toBe('');
    expect(normalizeKeyEvent({ key: 'Shift', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false } as KeyboardEvent)).toBe('');
  });

  it('formats shortcuts cleanly for UI labels', () => {
    expect(formatShortcutForDisplay('Alt+D')).toContain('Alt');
    expect(formatShortcutForDisplay('Ctrl+Z')).toContain('Ctrl');
    expect(formatShortcutForDisplay('')).toBe('None');
  });

  it('dispatches registered shortcut actions when keys match', () => {
    const manager = new ShortcutManager({
      'toggle-active': 'Alt+D',
      'tool-pen': 'p',
    });

    const mockCallback = vi.fn();
    manager.addListener(mockCallback);
    manager.attach();

    const eventAltD = new KeyboardEvent('keydown', {
      key: 'd',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(eventAltD);

    expect(mockCallback).toHaveBeenCalledWith('toggle-active', expect.any(KeyboardEvent));

    const eventP = new KeyboardEvent('keydown', {
      key: 'p',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(eventP);

    expect(mockCallback).toHaveBeenCalledWith('tool-pen', expect.any(KeyboardEvent));

    manager.detach();
  });

  it('does NOT trigger shortcuts if user is typing inside an input or textarea', () => {
    const manager = new ShortcutManager({
      'tool-pen': 'p',
    });

    const mockCallback = vi.fn();
    manager.addListener(mockCallback);
    manager.attach();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const eventInInput = new KeyboardEvent('keydown', {
      key: 'p',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(eventInInput);

    expect(mockCallback).not.toHaveBeenCalled();

    input.remove();
    manager.detach();
  });

  it('does NOT trigger shortcuts for keys typed into an input inside the Shadow DOM', () => {
    const manager = new ShortcutManager({
      'tool-pen': 'p',
    });

    const mockCallback = vi.fn();
    manager.addListener(mockCallback);
    manager.attach();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('textarea');
    shadow.appendChild(input);

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'p', bubbles: true, composed: true, cancelable: true })
    );

    expect(mockCallback).not.toHaveBeenCalled();

    host.remove();
    manager.detach();
  });

  it('correctly identifies browser-reserved shortcuts across Chrome, Firefox, Safari, and Edge', async () => {
    const { isReservedBrowserShortcut, getBrowserShortcutConflict } = await import('../src/core/shortcuts');
    
    const chromeConflict = getBrowserShortcutConflict('alt+d');
    expect(chromeConflict).not.toBeNull();
    expect(chromeConflict?.browser).toContain('Chrome');
    expect(chromeConflict?.action).toContain('address bar');

    const firefoxConflict = getBrowserShortcutConflict('ctrl+shift+a');
    expect(firefoxConflict).not.toBeNull();
    expect(firefoxConflict?.browser).toBe('Firefox');
    expect(firefoxConflict?.action).toContain('Add-ons');

    const safariConflict = getBrowserShortcutConflict('cmd+opt+e');
    expect(safariConflict).not.toBeNull();
    expect(safariConflict?.browser).toBe('Safari');
    expect(safariConflict?.action).toContain('Caches');

    const edgeConflict = getBrowserShortcutConflict('ctrl+shift+s');
    expect(edgeConflict).not.toBeNull();
    expect(edgeConflict?.browser).toContain('Edge');

    expect(isReservedBrowserShortcut('ctrl+t')).toBe(true);
    expect(isReservedBrowserShortcut('ctrl+w')).toBe(true);
    expect(isReservedBrowserShortcut('f12')).toBe(true);
    expect(isReservedBrowserShortcut('ctrl+l')).toBe(true);

    expect(isReservedBrowserShortcut('Alt+Shift+D')).toBe(false);
    expect(isReservedBrowserShortcut('Alt+Shift+T')).toBe(false);
    expect(isReservedBrowserShortcut('Alt+Shift+X')).toBe(false);
    expect(isReservedBrowserShortcut('Alt+Shift+E')).toBe(false);
  });

  it('registers a default for every tool and action, including double-arrow and delete', () => {
    expect(DEFAULT_SHORTCUTS['tool-double-arrow']).toBe('d');
    expect(DEFAULT_SHORTCUTS['action-delete']).toBe('Delete');
    // Every entry in the definition registry must have a default binding.
    for (const def of SHORTCUT_DEFINITIONS) {
      expect(DEFAULT_SHORTCUTS[def.id], `Missing default for ${def.id}`).toBeTruthy();
    }
  });

  it('guarantees that every default shortcut in the central registry is collision-free', async () => {
    const { DEFAULT_SHORTCUTS, isReservedBrowserShortcut } = await import('../src/core/shortcuts');
    
    for (const [actionId, keyCombo] of Object.entries(DEFAULT_SHORTCUTS)) {
      if (keyCombo.length > 1) {
        const isConflict = isReservedBrowserShortcut(keyCombo);
        expect(isConflict, `Default shortcut "${keyCombo}" for "${actionId}" must not conflict with any browser!`).toBe(false);
      }
    }
  });

  it('bypasses tool shortcuts when drawing mode is inactive so page keys are not hijacked', () => {
    let drawingModeActive = false;
    const manager = new ShortcutManager(
      {
        'toggle-active': 'Alt+Shift+d',
        'tool-pen': 'p',
      },
      () => drawingModeActive
    );

    const mockCallback = vi.fn();
    manager.addListener(mockCallback);
    manager.attach();

    const eventP = new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
    window.dispatchEvent(eventP);
    expect(mockCallback).not.toHaveBeenCalled();

    const eventToggle = new KeyboardEvent('keydown', { key: 'd', altKey: true, shiftKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(eventToggle);
    expect(mockCallback).toHaveBeenCalledWith('toggle-active', expect.any(KeyboardEvent));

    mockCallback.mockClear();
    drawingModeActive = true;
    window.dispatchEvent(eventP);
    expect(mockCallback).toHaveBeenCalledWith('tool-pen', expect.any(KeyboardEvent));

    manager.detach();
  });
});

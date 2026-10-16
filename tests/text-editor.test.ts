import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TextEditorOverlay } from '../src/ui/text-editor';
import { TextElement } from '../src/types/engine.types';

describe('TextEditorOverlay: In-Place Text Editing', () => {
  let container: HTMLElement;
  let editor: TextEditorOverlay;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    editor = new TextEditorOverlay(container);
  });

  afterEach(() => {
    editor.close();
    container.remove();
  });

  it('mounts textarea positioned accurately based on coordinates and scroll offset', () => {
    Object.defineProperty(window, 'scrollX', { value: 20, writable: true, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 50, writable: true, configurable: true });

    editor.open(
      { x: 200, y: 300 },
      { fontSize: 18, fontColor: '#38bdf8', bgColor: 'rgba(0,0,0,0.8)' },
      vi.fn()
    );

    const wrapper = container.querySelector('.pa-text-input-wrapper') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.left).toBe('180px');
    expect(wrapper.style.top).toBe('250px');

    const textarea = wrapper.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.style.fontSize).toBe('18px');
    expect(textarea.style.color).toBe('#38bdf8');
    expect(textarea.getAttribute('role') || textarea.getAttribute('aria-label')).toBeTruthy();

    Object.defineProperty(window, 'scrollX', { value: 0, writable: true, configurable: true });
    Object.defineProperty(window, 'scrollY', { value: 0, writable: true, configurable: true });
  });

  it('commits text note and creates TextElement when Enter is pressed', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    editor.open({ x: 100, y: 150 }, { fontSize: 16, fontColor: '#ffffff' }, onCommit, onCancel);

    const textarea = container.querySelector('.pa-text-textarea') as HTMLTextAreaElement;
    textarea.value = 'My meeting note';

    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.dispatchEvent(enterEvent);

    expect(onCommit).toHaveBeenCalledTimes(1);
    const created: TextElement = onCommit.mock.calls[0][0];
    expect(created.type).toBe('text');
    expect(created.text).toBe('My meeting note');
    expect(created.x).toBe(100);
    expect(created.y).toBe(150);
    expect(created.fontSize).toBe(16);
    expect(created.bbox).toBeDefined();
    expect(created.bbox.minX).toBeLessThanOrEqual(100);

    // Overlay should close after commit
    expect(container.querySelector('.pa-text-input-wrapper')).toBeNull();
  });

  it('allows multiline notes when Shift+Enter is pressed without committing', () => {
    const onCommit = vi.fn();
    editor.open({ x: 50, y: 50 }, { fontSize: 16, fontColor: '#ffffff' }, onCommit);

    const textarea = container.querySelector('.pa-text-textarea') as HTMLTextAreaElement;
    textarea.value = 'Line 1';

    const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });
    textarea.dispatchEvent(shiftEnter);

    expect(onCommit).not.toHaveBeenCalled();
    expect(container.querySelector('.pa-text-input-wrapper')).not.toBeNull();
  });

  it('cancels and invokes onCancel when Escape key is pressed', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    editor.open({ x: 50, y: 50 }, { fontSize: 16, fontColor: '#ffffff' }, onCommit, onCancel);

    const textarea = container.querySelector('.pa-text-textarea') as HTMLTextAreaElement;
    textarea.value = 'Unfinished thoughts';

    const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    textarea.dispatchEvent(escapeEvent);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pa-text-input-wrapper')).toBeNull();
  });

  it('commits on blur event if text is non-empty', () => {
    const onCommit = vi.fn();
    editor.open({ x: 80, y: 80 }, { fontSize: 14, fontColor: '#ff0000' }, onCommit);

    const textarea = container.querySelector('.pa-text-textarea') as HTMLTextAreaElement;
    textarea.value = 'Saved on blur';

    textarea.dispatchEvent(new Event('blur'));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].text).toBe('Saved on blur');
    expect(container.querySelector('.pa-text-input-wrapper')).toBeNull();
  });

  it('calls onCancel if blur occurs with empty or whitespace-only text', () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();

    editor.open({ x: 80, y: 80 }, { fontSize: 14, fontColor: '#ff0000' }, onCommit, onCancel);

    const textarea = container.querySelector('.pa-text-textarea') as HTMLTextAreaElement;
    textarea.value = '   ';

    textarea.dispatchEvent(new Event('blur'));

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.pa-text-input-wrapper')).toBeNull();
  });

  it('closes any existing open editor before opening a new one', () => {
    const onCancelFirst = vi.fn();
    editor.open({ x: 10, y: 10 }, { fontSize: 14, fontColor: '#fff' }, vi.fn(), onCancelFirst);
    expect(container.querySelectorAll('.pa-text-input-wrapper')).toHaveLength(1);

    editor.open({ x: 50, y: 50 }, { fontSize: 14, fontColor: '#fff' }, vi.fn());
    expect(container.querySelectorAll('.pa-text-input-wrapper')).toHaveLength(1);
  });
});

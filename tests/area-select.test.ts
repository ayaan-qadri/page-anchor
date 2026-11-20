import { afterEach, describe, expect, it, vi } from 'vitest';
import { AreaSelector, type AreaSelectHandlers } from '../src/ui/area-select';

function pointer(type: string, x: number, y: number, pointerType = 'mouse'): PointerEvent {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: pointerType } });
  return event;
}

describe('AreaSelector', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  const layer = () => document.querySelector<HTMLElement>('.pa-area');
  const action = (name: string) => document.querySelector<HTMLButtonElement>(`[data-action="${name}"]`);

  function open(overrides: Partial<AreaSelectHandlers> = {}) {
    const blob = new Blob(['x'], { type: 'image/png' });
    const handlers: AreaSelectHandlers = {
      capture: vi.fn(async () => blob),
      onSave: vi.fn(),
      onCopy: vi.fn(async (pending: Promise<Blob>) => void (await pending)),
      onError: vi.fn(),
      onClose: vi.fn(),
      ...overrides,
    };
    const selector = new AreaSelector(document.body, handlers);
    Object.defineProperties(layer()!, { clientWidth: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } });
    return { selector, handlers, blob };
  }

  function drag(from: [number, number], to: [number, number]) {
    const el = layer()!;
    el.dispatchEvent(pointer('pointerdown', ...from));
    el.dispatchEvent(pointer('pointermove', ...to));
    el.dispatchEvent(pointer('pointerup', ...to));
  }

  it('shows the actions only after an area is dragged out, in any direction', () => {
    open();
    expect(layer()!.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(layer());
    expect(document.querySelector<HTMLElement>('.pa-area-actions')!.hidden).toBe(true);

    drag([200, 150], [50, 40]);
    const box = document.querySelector<HTMLElement>('.pa-area-box')!;
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(['50px', '40px', '150px', '110px']);
    expect(document.querySelector<HTMLElement>('.pa-area-actions')!.hidden).toBe(false);
    expect(document.activeElement).toBe(action('area-copy'));
  });

  it('ignores a click without a drag', () => {
    const { handlers } = open();
    drag([100, 100], [101, 102]);
    expect(document.querySelector<HTMLElement>('.pa-area-actions')!.hidden).toBe(true);
    expect(handlers.capture).not.toHaveBeenCalled();
  });

  it('saves the area in the chosen format and closes', async () => {
    const { handlers, blob } = open();
    drag([10, 20], [110, 70]);
    action('area-pdf')!.click();
    await vi.waitFor(() => expect(handlers.onClose).toHaveBeenCalled());
    expect(handlers.capture).toHaveBeenCalledWith('pdf', { x: 10, y: 20, width: 100, height: 50 });
    expect(handlers.onSave).toHaveBeenCalledWith('pdf', blob);
    expect(layer()).toBeNull();
  });

  it('starts the copy in the click itself, before the screenshot is ready', () => {
    let resolve!: (b: Blob) => void;
    const { handlers } = open({ capture: vi.fn(() => new Promise<Blob>((r) => (resolve = r))) });
    drag([10, 20], [110, 70]);
    action('area-copy')!.click();
    expect(handlers.onCopy).toHaveBeenCalledTimes(1);
    resolve(new Blob());
  });

  it('acts on a finger lift even when the browser sends no click, and only once when it does', async () => {
    const { handlers } = open();
    drag([10, 20], [110, 70]);
    const save = action('area-png')!;
    save.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 40 }) as DOMRect;
    save.dispatchEvent(pointer('pointerup', 300, 20, 'touch'));
    expect(handlers.capture).not.toHaveBeenCalled();
    save.dispatchEvent(pointer('pointerup', 50, 20, 'touch'));
    save.click();
    await vi.waitFor(() => expect(handlers.onSave).toHaveBeenCalled());
    expect(handlers.capture).toHaveBeenCalledTimes(1);
  });

  it('covers only the pinch-zoomed part of the page, at normal size, and hands back page coordinates', async () => {
    const vv = { offsetLeft: 100, offsetTop: 50, scale: 2, width: 200, height: 300, addEventListener: vi.fn() };
    vi.stubGlobal('visualViewport', vv);
    try {
      const { handlers } = open();
      const el = layer()!;
      expect([el.style.left, el.style.top, el.style.width, el.style.height, el.style.transform]).toEqual(['100px', '50px', '400px', '600px', 'scale(0.5)']);
      drag([110, 60], [160, 110]);
      action('area-png')!.click();
      await vi.waitFor(() => expect(handlers.onClose).toHaveBeenCalled());
      expect(handlers.capture).toHaveBeenCalledWith('png', { x: 110, y: 60, width: 50, height: 50 });

      const second = open();
      Object.defineProperties(document.querySelectorAll<HTMLElement>('.pa-area')[0], { clientWidth: { value: 400 }, clientHeight: { value: 600 } });
      action('area-whole')!.click();
      action('area-png')!.click();
      await vi.waitFor(() => expect(second.handlers.capture).toHaveBeenCalledWith('png', { x: 100, y: 50, width: 200, height: 300 }));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('has no Copy button where images cannot be copied', () => {
    open({ onCopy: undefined });
    expect(action('area-copy')).toBeNull();
    expect(action('area-png')).not.toBeNull();
  });

  it('reports a failed screenshot and closes', async () => {
    const { handlers } = open({ capture: vi.fn().mockRejectedValue(new Error('nope')) });
    drag([10, 20], [110, 70]);
    action('area-png')!.click();
    await vi.waitFor(() => expect(handlers.onClose).toHaveBeenCalled());
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onSave).not.toHaveBeenCalled();
  });

  it('has buttons for the whole screen and for cancelling, for screens without a keyboard', () => {
    const { handlers } = open();
    action('area-whole')!.click();
    const box = document.querySelector<HTMLElement>('.pa-area-box')!;
    expect([box.style.width, box.style.height]).toEqual(['800px', '600px']);
    expect(document.querySelector<HTMLElement>('.pa-area-actions')!.hidden).toBe(false);

    open();
    const hint = document.querySelectorAll<HTMLElement>('.pa-area-hint')[1];
    hint.dispatchEvent(pointer('pointerdown', 10, 10));
    expect(document.querySelectorAll<HTMLElement>('.pa-area-box')[1].hidden).toBe(true);
    hint.querySelector<HTMLButtonElement>('[data-action="area-close"]')!.click();
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.pa-area')).toHaveLength(1);
  });

  it('Enter picks the whole screen and Escape closes without passing the key on', () => {
    const { handlers } = open();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(document.querySelector<HTMLElement>('.pa-area-actions')!.hidden).toBe(false);

    const behind = vi.fn();
    document.addEventListener('keydown', behind);
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.removeEventListener('keydown', behind);
    expect(behind).not.toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
    expect(layer()).toBeNull();
  });
});

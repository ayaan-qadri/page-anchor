import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExportStatus } from '../src/ui/export-status';

describe('ExportStatus', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  const panel = () => document.querySelector<HTMLElement>('.pa-export-status')!;
  const text = (sel: string) => panel().querySelector(sel)?.textContent ?? null;

  it('says what is being saved, how far it is, and which actions stop it', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const status = new ExportStatus(document.body, 'png', vi.fn());
    expect(panel().getAttribute('role')).toBe('status');
    expect(text('.pa-export-status-title')).toBe('Saving page as PNG image');
    expect(text('.pa-export-status-hint')).toBe('Scrolling, clicking, pressing a key or switching tabs stops saving.');

    status.setProgress(0.426);
    expect(text('.pa-export-status-percent')).toBe('43%');
    const bar = panel().querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('43');
    expect(panel().querySelector<HTMLElement>('.pa-export-status-fill')!.style.width).toBe('43%');
  });

  it('names touch and tab switching on touch screens, and names PDF saves', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(pointer: coarse)' }));
    new ExportStatus(document.body, 'pdf', vi.fn());
    expect(text('.pa-export-status-title')).toBe('Saving page as PDF');
    expect(text('.pa-export-status-hint')).toBe('Touching the page or switching tabs stops saving.');
  });

  it('stops on the Stop button, and drops the stop hint once only the file is left to write', () => {
    const onStop = vi.fn();
    const status = new ExportStatus(document.body, 'png', onStop);
    panel().querySelector<HTMLButtonElement>('.pa-export-status-stop')!.click();
    expect(onStop).toHaveBeenCalledTimes(1);

    status.setFinishing();
    expect(text('.pa-export-status-title')).toBe('Finishing…');
    expect(panel().querySelector('.pa-export-status-stop')).toBeNull();
    expect(panel().querySelector('.pa-export-status-hint')).toBeNull();
  });

  it('steps aside for a screenshot and is removed completely when done', () => {
    const status = new ExportStatus(document.body, 'png', vi.fn());
    const show = status.hide();
    expect(panel().classList.contains('pa-export-status-hidden')).toBe(true);
    show();
    expect(panel().classList.contains('pa-export-status-hidden')).toBe(false);
    status.destroy();
    expect(document.querySelector('.pa-export-status')).toBeNull();
  });
});

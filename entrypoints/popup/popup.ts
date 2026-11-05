import { PDFDocument } from 'pdf-lib';
import { browser } from 'wxt/browser';
import { loadSettings } from '../../src/core/storage';
import { formatShortcutForDisplay } from '../../src/core/shortcuts';
import { injectContentScript } from '../../src/core/inject';
import { PopupSettingsPanel } from './popup-settings';

// Full-page export: one Firefox captureVisibleTab screenshot, with Page Anchor overlays.
// PNG is continuous; PDF uses the same capture and renderer sliced onto A4 pages.
export async function initPopup() {
  const toggleSwitch = document.getElementById('toggle-draw-mode') as HTMLInputElement;
  const pageTitleEl = document.getElementById('page-title') as HTMLElement;
  const countEl = document.getElementById('annotation-count') as HTMLElement;
  const clearBtn = document.getElementById('btn-clear') as HTMLButtonElement;
  const optionsBtn = document.getElementById('btn-options') as HTMLButtonElement;
  const backBtn = document.getElementById('btn-settings-back') as HTMLButtonElement | null;
  const fullSettingsBtn = document.getElementById('btn-open-full-settings') as HTMLButtonElement | null;
  const hintEl = document.getElementById('quick-shortcut-hint') as HTMLElement;
  const homeView = document.getElementById('view-home');
  const settingsView = document.getElementById('view-settings');
  const settingsRoot = document.getElementById('popup-settings-root');

  const announcer = document.getElementById('popup-announcer');
  const announce = (msg: string) => {
    if (announcer) {
      announcer.textContent = '';
      requestAnimationFrame(() => {
        announcer.textContent = msg;
      });
    }
  };

  const ext: any = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);
  if (!ext) return;

  let settingsPanel: PopupSettingsPanel | null = null;
  let settingsMounted = false;

  const openSettings = async () => {
    homeView?.classList.add('hidden');
    settingsView?.classList.remove('hidden');
    if (!settingsMounted && settingsRoot) {
      settingsMounted = true;
      settingsPanel = new PopupSettingsPanel(settingsRoot, announce);
      await settingsPanel.mount();
      announce('Settings opened');
    }
  };

  const closeSettings = () => {
    settingsPanel?.dispose();
    settingsView?.classList.add('hidden');
    homeView?.classList.remove('hidden');
  };

  const openFullSettingsPage = () => {
    if (ext.runtime?.openOptionsPage) {
      ext.runtime.openOptionsPage();
    } else if (ext.runtime?.getURL) {
      window.open(ext.runtime.getURL('options.html'));
    }
  };

  optionsBtn?.addEventListener('click', () => {
    void openSettings();
  });
  backBtn?.addEventListener('click', closeSettings);
  fullSettingsBtn?.addEventListener('click', openFullSettingsPage);

  const settings = await loadSettings();
  const toggleKey = settings.shortcuts['toggle-active'] || 'Alt+Shift+D';
  if (hintEl) {
    hintEl.textContent = formatShortcutForDisplay(toggleKey);
  }

  const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id === undefined) {
    pageTitleEl.textContent = 'No active webpage';
    toggleSwitch.disabled = true;
    return;
  }

  const tabId = tab.id;
  
  pageTitleEl.textContent = tab.title || tab.url || 'Webpage';

  // Both exports use one full-page capture and the same annotation renderer.
  const pngBtn = document.createElement('button');
  pngBtn.textContent = 'Сохранить PNG (вся страница)';
  pngBtn.style.cssText =
    'padding:12px; background:#16876f; color:white; border-radius:8px; ' +
    'border:none; width:100%; margin-top:8px;';
  clearBtn.insertAdjacentElement('afterend', pngBtn);

  const exportBtn = document.createElement('button');
  exportBtn.textContent = 'Экспорт PDF (A4)';
  exportBtn.style.cssText =
    'padding:12px; background:#3f63da; color:white; border-radius:8px; ' +
    'border:none; width:100%; margin-top:8px;';
  pngBtn.insertAdjacentElement('afterend', exportBtn);

  const exportProgress = document.createElement('progress');
  exportProgress.max = 100;
  exportProgress.value = 0;
  exportProgress.style.cssText = 'width:100%; height:12px; display:none;';
  exportBtn.insertAdjacentElement('afterend', exportProgress);

  const exportLog = document.createElement('pre');
  exportLog.style.cssText =
    'white-space:pre-wrap; overflow-wrap:anywhere; font-size:11px; line-height:1.5; ' +
    'padding:8px; max-height:220px; overflow:auto; color:#a9c1f8;';
  exportProgress.insertAdjacentElement('afterend', exportLog);

  let outputUrl: string | null = null;
  const outputLinks: HTMLAnchorElement[] = [];
  const log = (message: string) => {
    exportLog.textContent += message + '\n';
    exportLog.scrollTop = exportLog.scrollHeight;
    console.log('[Page Anchor export]', message);
  };

  const wait = (ms: number): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

  const decodeImage = async (dataUrl: string): Promise<HTMLImageElement> => {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    return image;
  };

  const addOutputLink = (label: string, filename?: string): void => {
    if (!outputUrl) return;
    const link = document.createElement('a');
    link.href = outputUrl;
    if (filename) link.download = filename;
    else {
      link.target = '_blank';
      link.rel = 'noopener';
    }
    link.textContent = label;
    link.style.cssText =
      'display:block; color:#7fd1d0; padding:8px; font-weight:bold; text-decoration:underline;';
    const previous = outputLinks[outputLinks.length - 1];
    (previous || exportLog).insertAdjacentElement('afterend', link);
    outputLinks.push(link);
  };

  const exportFullPage = async (format: 'png' | 'pdf'): Promise<void> => {
    pngBtn.disabled = true;
    exportBtn.disabled = true;
    pngBtn.textContent = 'Экспорт...';
    exportBtn.textContent = 'Экспорт...';
    exportLog.textContent = '';
    exportProgress.style.display = 'block';
    exportProgress.value = 0;
    for (const link of outputLinks) link.remove();
    outputLinks.length = 0;
    if (outputUrl) {
      URL.revokeObjectURL(outputUrl);
      outputUrl = null;
    }

    let sessionStarted = false;
    try {
      log('1/3 Подготовка страницы...');
      const geometry: any = await ext.tabs.sendMessage(tabId, {
        type: 'PAGE_ANCHOR_FULL_BEGIN',
      });
      if (!geometry?.ok) {
        throw new Error(String(geometry?.error || 'Не удалось начать экспорт. Проверь content.ts и engine.ts.'));
      }
      sessionStarted = true;
      const cssWidth = Number(geometry.width);
      const cssHeight = Number(geometry.height);
      if (!(cssWidth > 0 && cssHeight > 0)) {
        throw new Error('Страница вернула неверные размеры');
      }
      log(`Документ: ${cssWidth} × ${cssHeight} CSS px, рисунков: ${geometry.count}`);
      await wait(180); // Allow Firefox to repaint after hiding Page Anchor.

      log('2/3 Захват всей HTML-страницы...');
      const imageDataUrl: string = await ext.tabs.captureVisibleTab(undefined, {
        format: 'png',
        rect: { x: 0, y: 0, width: cssWidth, height: cssHeight },
        scale: 1,
      });
      const screenshot = await decodeImage(imageDataUrl);
      if (!(screenshot.width > 0 && screenshot.height > 0)) {
        throw new Error('Пустой снимок страницы');
      }
      const scaleX = screenshot.width / cssWidth;
      const scaleY = screenshot.height / cssHeight;
      log(`Снимок: ${screenshot.width} × ${screenshot.height} px; scaleX=${scaleX.toFixed(4)}, scaleY=${scaleY.toFixed(4)}`);
      exportProgress.value = 15;

      // Keep the proven A4-sized overlay slices. Avoid requesting a giant
      // overlay canvas from the content script even for the continuous PNG.
      const a4Width = 595.28;
      const a4Height = 841.89;
      const slicePixelHeight = Math.max(1, Math.floor(screenshot.width * a4Height / a4Width));
      const pageCount = Math.ceil(screenshot.height / slicePixelHeight);
      const shouldRenderAnnotations = Number(geometry.count) > 0;

      const renderAnnotations = async (ctx: CanvasRenderingContext2D,
        pixelTop: number, pixelHeight: number, destinationY: number): Promise<void> => {
        if (!shouldRenderAnnotations) return;
        const layer: any = await ext.tabs.sendMessage(tabId, {
          type: 'PAGE_ANCHOR_FULL_SLICE',
          pxWidth: screenshot.width,
          pxHeight: pixelHeight,
          pxTop: pixelTop,
          cssWidth,
          scaleX,
          scaleY,
        });
        if (!layer?.ok || !layer?.dataUrl) {
          throw new Error(String(layer?.error || 'Не удалось получить слой рисунков'));
        }
        const overlay = await decodeImage(String(layer.dataUrl));
        ctx.drawImage(overlay, 0, destinationY);
      };

      log(`3/3 Наложение рисунков и создание ${format.toUpperCase()}...`);
      if (format === 'png') {
        // One final bitmap, no artificial page boundaries. This can require
        // significant memory on very long pages; PDF remains the fallback.
        const canvas = document.createElement('canvas');
        canvas.width = screenshot.width;
        canvas.height = screenshot.height;
        if (canvas.width !== screenshot.width || canvas.height !== screenshot.height) {
          throw new Error('Превышен лимит размеров Canvas; используй экспорт PDF');
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Не удалось создать Canvas для PNG; используй PDF');
        ctx.drawImage(screenshot, 0, 0);

        for (let i = 0; i < pageCount; i++) {
          const pixelTop = i * slicePixelHeight;
          const pixelHeight = Math.min(slicePixelHeight, screenshot.height - pixelTop);
          await renderAnnotations(ctx, pixelTop, pixelHeight, pixelTop);
          exportProgress.value = 15 + 75 * (i + 1) / pageCount;
        }
        const blob = await new Promise<Blob>((resolve, reject) => {
          try {
            canvas.toBlob(result => result
              ? resolve(result)
              : reject(new Error('Не удалось создать PNG; используй PDF')),
            'image/png');
          } catch (error) {
            reject(error);
          }
        });
        outputUrl = URL.createObjectURL(blob);
        const filename = `page-anchor-${Date.now()}.png`;
        // Viewing and downloading are intentionally separate for Firefox Android.
        addOutputLink(`Открыть PNG (${screenshot.width} × ${screenshot.height}, ${Math.round(blob.size / 1024)} КБ)`);
        addOutputLink('Скачать PNG', filename);
        log('Готово. Создано одно непрерывное изображение с рисунками.');
      } else {
        // Preserve the tested A4 PDF export geometry exactly.
        const pdf = await PDFDocument.create();
        for (let i = 0; i < pageCount; i++) {
          const pixelTop = i * slicePixelHeight;
          const pixelHeight = Math.min(slicePixelHeight, screenshot.height - pixelTop);
          const canvas = document.createElement('canvas');
          canvas.width = screenshot.width;
          canvas.height = pixelHeight;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('Canvas 2D недоступен');
          ctx.drawImage(screenshot,
            0, pixelTop, screenshot.width, pixelHeight,
            0, 0, screenshot.width, pixelHeight);
          await renderAnnotations(ctx, pixelTop, pixelHeight, 0);

          const embedded = await pdf.embedPng(canvas.toDataURL('image/png'));
          const page = pdf.addPage([a4Width, a4Height]);
          const drawHeight = a4Width * pixelHeight / screenshot.width;
          page.drawImage(embedded, {
            x: 0,
            y: a4Height - drawHeight,
            width: a4Width,
            height: drawHeight,
          });
          exportProgress.value = 15 + 75 * (i + 1) / pageCount;
          log(`Страница ${i + 1}/${pageCount} готова`);
        }
        const pdfBytes = await pdf.save();
        const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
        new Uint8Array(pdfBuffer).set(pdfBytes);
        const blob = new Blob([pdfBuffer], { type: 'application/pdf' });
        outputUrl = URL.createObjectURL(blob);
        addOutputLink(`Открыть PDF (${pageCount} стр., ${Math.round(blob.size / 1024)} КБ)`);
        log('Готово. PDF создан из одного полного снимка.');
      }
      exportProgress.value = 100;
    } catch (error) {
      log('ОШИБКА: ' + String(error));
    } finally {
      if (sessionStarted) {
        try {
          await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_FULL_END' });
        } catch (error) {
          log('Не удалось сразу восстановить интерфейс (есть защитный таймер): ' + String(error));
        }
      }
      pngBtn.disabled = false;
      exportBtn.disabled = false;
      pngBtn.textContent = 'Сохранить PNG (вся страница)';
      exportBtn.textContent = 'Экспорт PDF (A4)';
    }
  };

  pngBtn.addEventListener('click', () => { void exportFullPage('png'); });
  exportBtn.addEventListener('click', () => { void exportFullPage('pdf'); });
  // --- End full-page export ---

  async function injectIntoPage(): Promise<boolean> {
    return injectContentScript(ext, tabId);
  }

  try {
    const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_GET_STATUS' }) as any;
    if (res) {
      toggleSwitch.checked = !!res.active;
      countEl.textContent = `${res.count || 0} annotation${res.count === 1 ? '' : 's'} on page`;
    }
  } catch {
    const injected = await injectIntoPage();
    if (injected) {
      setTimeout(async () => {
        try {
          const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_GET_STATUS' }) as any;
          if (res) {
            toggleSwitch.checked = !!res.active;
            countEl.textContent = `${res.count || 0} annotation${res.count === 1 ? '' : 's'} on page`;
          }
        } catch {
          countEl.textContent = 'Anchor ready to activate';
        }
      }, 120);
    } else {
      countEl.textContent = 'Anchor ready to activate';
    }
  }

  toggleSwitch.addEventListener('change', async () => {
    try {
      const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_TOGGLE' }) as any;
      toggleSwitch.checked = !!res?.active;
      if (res?.count !== undefined) {
        countEl.textContent = `${res.count} annotation${res.count === 1 ? '' : 's'} on page`;
      }
      announce(res?.active ? 'Drawing toolbar enabled' : 'Drawing toolbar disabled');
    } catch {
      const injected = await injectIntoPage();
      if (injected) {
        setTimeout(async () => {
          try {
            const res = await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_TOGGLE' }) as any;
            toggleSwitch.checked = !!res?.active;
            if (res?.count !== undefined) {
              countEl.textContent = `${res.count} annotation${res.count === 1 ? '' : 's'} on page`;
            }
            announce(res?.active ? 'Drawing toolbar enabled' : 'Drawing toolbar disabled');
          } catch {
            countEl.textContent = 'Please refresh the webpage';
            announce('Could not connect to webpage. Please refresh.');
          }
        }, 120);
      } else {
        countEl.textContent = 'Please refresh the webpage';
        announce('Could not connect to webpage. Please refresh.');
      }
    }
  });

  clearBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear all annotations on this page?')) {
      try {
        await ext.tabs.sendMessage(tabId, { type: 'PAGE_ANCHOR_CLEAR' });
        countEl.textContent = '0 annotations on page';
        announce('All annotations cleared');
      } catch {
        alert('Could not clear annotations.');
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', initPopup);
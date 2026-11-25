import { PRINT_DONE, PRINT_FAILED, PRINT_READY, PRINT_STARTED, isPrintRequest } from '../../src/export/print';

let started = false;

const reply = (type: string) => window.parent.postMessage({ type }, '*');

/** Waits for load, not decode(): decoding every sheet up front can take hundreds of megabytes on a long page. */
function addImage(image: Blob, width: number | undefined): Promise<void> {
  const img = new Image();
  img.alt = '';
  if (width) img.style.width = `min(${width}px, 100%)`;
  else img.className = 'sheet';
  const loaded = new Promise<void>((resolve, reject) => {
    img.addEventListener('load', () => resolve(), { once: true });
    img.addEventListener('error', () => reject(new Error('Image did not load')), { once: true });
  });
  img.src = URL.createObjectURL(image);
  const page = document.createElement('div');
  page.className = 'page';
  page.appendChild(img);
  document.body.appendChild(page);
  return loaded;
}

window.addEventListener('message', async (event) => {
  if (started || event.source !== window.parent || !isPrintRequest(event.data)) return;
  started = true;
  const { images, width, title } = event.data;
  document.title = title;
  try {
    await Promise.all(images.map((image) => addImage(image, width)));
  } catch {
    reply(PRINT_FAILED);
    return;
  }
  window.addEventListener('afterprint', () => reply(PRINT_DONE), { once: true });
  reply(PRINT_STARTED);
  window.print();
});

reply(PRINT_READY);

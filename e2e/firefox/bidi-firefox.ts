/** A real Firefox with the built extension installed, driven over WebDriver BiDi. Playwright's own Firefox cannot load add-ons, so this speaks BiDi directly to the release browser. Env: FIREFOX_BIN=<path to firefox>, PA_EXT_DIR=<built extension dir, default .output/firefox-mv3>, PA_HEADED=1 to show the window. */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import type { ExtensionDriver } from '../shared/smart-anchoring-flows';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const FIREFOX_BIN = process.env.FIREFOX_BIN ?? (process.platform === 'win32' ? 'C:\\Program Files\\Mozilla Firefox\\firefox.exe' : 'firefox');
export const FIREFOX_EXTENSION_DIR = process.env.PA_EXT_DIR ? path.resolve(process.env.PA_EXT_DIR) : path.join(ROOT, '.output', 'firefox-mv3');

export const KEY = { Alt: '\uE00A', Shift: '\uE008', Enter: '\uE007', Escape: '\uE00C' } as const;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LaunchOptions {
  /** Extra Firefox prefs written to the profile's user.js. */
  prefs?: Record<string, string | number | boolean>;
  /** Opened in a tab before the add-on is installed, like a page the user already had open. */
  openBeforeInstall?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class BidiFirefox {
  private nextId = 0;
  private pending = new Map<number, Pending>();
  readonly consoleErrors: string[] = [];

  private constructor(
    private readonly process: ChildProcess,
    private readonly socket: WebSocket,
    private readonly profile: string,
    private context = ''
  ) {
    socket.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      const waiter = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (waiter) {
        this.pending.delete(msg.id);
        if (msg.type === 'error') waiter.reject(new Error(`${msg.error}: ${msg.message}`));
        else waiter.resolve(msg.result);
      } else if (msg.method === 'log.entryAdded' && msg.params.level === 'error' && /page.?anchor/i.test(msg.params.text ?? '')) {
        this.consoleErrors.push(msg.params.text);
      }
    };
  }

  static async launch(options: LaunchOptions = {}): Promise<BidiFirefox> {
    if (!fs.existsSync(path.join(FIREFOX_EXTENSION_DIR, 'manifest.json'))) {
      throw new Error(`Built Firefox extension not found in ${FIREFOX_EXTENSION_DIR}; run pnpm build:firefox first`);
    }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pa-ff-e2e-'));
    const prefs: Record<string, string | number | boolean> = {
      'browser.shell.checkDefaultBrowser': false,
      'datareporting.policy.dataSubmissionEnabled': false,
      'browser.aboutwelcome.enabled': false,
      'browser.download.folderList': 2,
      'browser.download.dir': profile,
      'browser.download.always_ask_before_handling_new_types': false,
      ...options.prefs,
    };
    fs.writeFileSync(
      path.join(profile, 'user.js'),
      Object.entries(prefs)
        .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
        .join('\n')
    );
    const port = 9300 + Math.floor(Math.random() * 600);
    const child = spawn(FIREFOX_BIN, [...(process.env.PA_HEADED ? [] : ['--headless']), '--no-remote', '--profile', profile, `--remote-debugging-port=${port}`, '--width=1280', '--height=800'], {
      stdio: 'ignore',
      // Lets the tests drive the add-on's own pages, such as its settings page.
      env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' },
    });
    let spawnError: Error | null = null;
    child.on('error', (error) => (spawnError = error));

    let socket: WebSocket | null = null;
    for (let i = 0; i < 60 && !socket && !spawnError; i++) {
      socket = await new Promise<WebSocket | null>((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
        ws.onopen = () => resolve(ws);
        ws.onerror = () => resolve(null);
      });
      if (!socket) await sleep(500);
    }
    if (!socket) {
      child.kill();
      throw new Error(`Firefox did not start (FIREFOX_BIN=${FIREFOX_BIN})${spawnError ? `: ${String(spawnError)}` : ''}`);
    }

    const browser = new BidiFirefox(child, socket, profile);
    await browser.send('session.new', { capabilities: {} });
    await browser.send('session.subscribe', { events: ['log.entryAdded'] });
    if (options.openBeforeInstall) {
      await browser.newTab();
      await browser.driver().goto(options.openBeforeInstall);
    }
    await browser.send('webExtension.install', { extensionData: { type: 'path', path: FIREFOX_EXTENSION_DIR } });
    // A fresh tab, since the first listed context may be the add-on's privileged background page.
    if (!browser.context) await browser.newTab();
    return browser;
  }

  get downloadDir(): string {
    return this.profile;
  }

  get currentTab(): string {
    return this.context;
  }

  async newTab(): Promise<string> {
    const { context } = (await this.send('browsingContext.create', { type: 'tab' })) as { context: string };
    this.context = context;
    await this.setViewport(1280, 800);
    return context;
  }

  /** Brings a tab to the front and points every later call at it. */
  async switchTo(context: string): Promise<void> {
    this.context = context;
    await this.send('browsingContext.activate', { context });
  }

  /** Points later calls at an add-on page, which BiDi cannot bring to the front; it already is when the add-on opened it. */
  useAddonPage(context: string): void {
    this.context = context;
  }

  async tabs(): Promise<{ context: string; url: string }[]> {
    const { contexts } = (await this.send('browsingContext.getTree', { maxDepth: 0 })) as { contexts: { context: string; url: string }[] };
    return contexts;
  }

  async click(x: number, y: number): Promise<void> {
    await this.send('input.performActions', {
      context: this.context,
      actions: [
        {
          type: 'pointer',
          id: 'mouse',
          parameters: { pointerType: 'mouse' },
          actions: [{ type: 'pointerMove', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }],
        },
      ],
    });
    await this.send('input.releaseActions', { context: this.context });
  }

  async type(text: string): Promise<void> {
    await this.send('input.performActions', {
      context: this.context,
      actions: [{ type: 'key', id: 'keyboard', actions: [...text].flatMap((value) => [{ type: 'keyDown', value }, { type: 'keyUp', value }]) }],
    });
    await this.send('input.releaseActions', { context: this.context });
  }

  send(method: string, params: object): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const result = (await this.send('script.evaluate', {
      expression: `(async () => JSON.stringify(await (${expression})))()`,
      target: { context: this.context },
      awaitPromise: true,
    })) as { type: string; result?: { type: string; value?: string }; exceptionDetails?: { text: string } };
    if (result.type === 'exception') throw new Error(`page script failed: ${result.exceptionDetails?.text}`);
    const value = result.result?.type === 'string' ? result.result.value : undefined;
    return (value === undefined ? undefined : JSON.parse(value)) as T;
  }

  async keys(...values: string[]): Promise<void> {
    await this.send('input.performActions', {
      context: this.context,
      actions: [
        {
          type: 'key',
          id: 'keyboard',
          actions: [...values.map((value) => ({ type: 'keyDown', value })), ...[...values].reverse().map((value) => ({ type: 'keyUp', value }))],
        },
      ],
    });
    await this.send('input.releaseActions', { context: this.context });
  }

  async setViewport(width: number, height: number): Promise<void> {
    await this.send('browsingContext.setViewport', { context: this.context, viewport: { width, height } });
  }

  async close(): Promise<void> {
    try {
      await this.send('session.end', {});
    } catch {}
    this.socket.close();
    this.process.kill();
    await sleep(800);
    try {
      fs.rmSync(this.profile, { recursive: true, force: true });
    } catch {}
  }

  driver(): ExtensionDriver {
    const toolbarVisible = () => this.evaluate<boolean>(`!!document.getElementById('page-anchor-host')?.shadowRoot?.querySelector('.pa-toolbar')?.checkVisibility()`);
    return {
      name: 'firefox',
      goto: async (url) => {
        await this.send('browsingContext.navigate', { context: this.context, url, wait: 'complete' });
      },
      reload: async () => {
        await this.send('browsingContext.reload', { context: this.context, wait: 'complete' });
      },
      evaluate: (expression) => this.evaluate(expression),
      openToolbar: async () => {
        // The content script installs its shortcut listener at document_idle; retry until the toolbar shows up.
        for (let attempt = 0; attempt < 10; attempt++) {
          if (await toolbarVisible()) return;
          await this.keys(KEY.Alt, KEY.Shift, 'D');
          for (let i = 0; i < 15; i++) {
            await sleep(200);
            if (await toolbarVisible()) return;
          }
        }
        throw new Error('Page Anchor toolbar did not open in Firefox');
      },
      press: (key) => this.keys(key),
      drag: async ([x1, y1], [x2, y2]) => {
        const steps = 10;
        await this.send('input.performActions', {
          context: this.context,
          actions: [
            {
              type: 'pointer',
              id: 'mouse',
              parameters: { pointerType: 'mouse' },
              actions: [
                { type: 'pointerMove', x: x1, y: y1 },
                { type: 'pointerDown', button: 0 },
                ...Array.from({ length: steps }, (_, i) => ({ type: 'pointerMove', x: Math.round(x1 + ((x2 - x1) * (i + 1)) / steps), y: Math.round(y1 + ((y2 - y1) * (i + 1)) / steps), duration: 16 })),
                { type: 'pointerUp', button: 0 },
              ],
            },
          ],
        });
        await this.send('input.releaseActions', { context: this.context });
      },
      setViewport: (width, height) => this.setViewport(width, height),
      // Saves are debounced by 250 ms; storage is not reachable from the page in Firefox, so allow a generous margin.
      waitForSave: () => sleep(1500),
      screenshot: async (file) => {
        const { data } = (await this.send('browsingContext.captureScreenshot', { context: this.context })) as { data: string };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, Buffer.from(data, 'base64'));
      },
    };
  }
}

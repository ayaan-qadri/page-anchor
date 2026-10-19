<div align="center">
  <img src="public/icon-128.png" width="100" height="100" alt="Page Anchor Logo"/>
  <br/>
  <strong style="font-size: 2em;">Page Anchor</strong>
  <br/>
  <p>Draw on any web page. Annotations stay attached to the elements you drew them on.</p>

  <p>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-10B981?style=for-the-badge" alt="MIT License"/></a>
    <a href="https://wxt.dev/"><img src="https://img.shields.io/badge/Built_with-WXT-0EA5E9?style=for-the-badge" alt="Built with WXT"/></a>
    <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript"/></a>
    <a href="https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3"><img src="https://img.shields.io/badge/Manifest-V3-7C3AED?style=for-the-badge" alt="Manifest V3"/></a>
  </p>
</div>

---

## Table of Contents

- [Install](#install)
- [What is Page Anchor?](#what-is-page-anchor)
- [Features](#features)
- [How It Works](#how-it-works)
- [Why Another Annotation Extension?](#why-another-annotation-extension)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [How It Was Built](#how-it-was-built)
- [Platform Support](#platform-support)
- [Getting Started (Development)](#getting-started-development)
- [Testing the Extension](#testing-the-extension)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [Security & Privacy](#security--privacy)
- [License](#license)

---

## Install

There's no one-click store install documented yet, so for now Page Anchor is built from source. It takes about a minute:

```bash
git clone https://github.com/ayaan-qadri/page-anchor.git
cd page-anchor
pnpm install
pnpm build
```

Then load `.output/chrome-mv3` as an unpacked extension (steps [below](#testing-the-extension)). Press `Alt + Shift + D` on any page to start drawing.

---

## What is Page Anchor?

Page Anchor is a browser extension for marking up pages you don't own the source of: a staging site you're reviewing, a design that shipped slightly wrong, an article you're studying, a dashboard you're explaining to someone.

Click an icon, and a small toolbar appears. Draw a box around the broken button, arrow at the thing you mean, drop a note next to it, and leave. The next time you open that URL, everything is still there.

All of it is local. There's no account, no sync server, no upload, and no telemetry.

---

## Features

- **Pen and highlighter**: freehand strokes smoothed with quadratic bezier interpolation. The highlighter draws at 35% alpha, which keeps highlighted text legible on articles, docs, and code.
- **Vector shapes**: rectangle, ellipse, straight line (hold `Shift` to snap to 45° increments), directional arrow, and a double-headed dimension arrow for marking distances and gaps.
- **Text notes**: click anywhere to type, with configurable font size and a high-legibility backdrop so notes stay readable over busy pages.
- **Select, move, erase**: click an existing element to select it and drag it elsewhere, delete it with `Delete`/`Backspace`, or sweep the eraser across anything you want gone.
- **DOM-aware anchoring**: drawings follow the elements they were made on when a page reflows, rather than staying pinned to raw pixel coordinates. This is the part that makes it work on real sites instead of only static ones.
- **Persistent per-URL storage**: annotations are saved automatically and restored when you come back. Tracking parameters (`utm_*`, `fbclid`, `gclid`, …) and hash fragments are stripped before matching, so a link shared with tracking junk still finds your drawings. Matching can be clean, exact, or domain-wide.
- **Fully rebindable shortcuts**: every tool and action can be remapped with an interactive key recorder, with warnings when you pick something the browser has reserved.
- **Shadow DOM isolation**: the overlay UI lives in its own shadow root, so Tailwind resets, Bootstrap, and styled-components on the host page can't break it, and its styles can't leak out.
- **Backup and restore**: export every page's annotations as a JSON file and import it again later.
- **Bounded undo/redo**: 50 steps per page, so a long session doesn't grow memory without limit.
- **Cheap on weak hardware**: the renderer is built to stay smooth on budget laptops and Chromebooks. Details in [How It Works](#how-it-works).
- **Cross-browser**: one codebase, builds for Chrome/Edge/Brave (MV3), Firefox (MV2), and Safari.

---

## How It Works

### Anchoring drawings to the DOM

Most drawing extensions store strokes as absolute page coordinates. That works until the page moves: a comment gets added, an ad loads, a list re-sorts, and every annotation is now pointing at the wrong paragraph.

Page Anchor tries to attach each annotation to an element at the moment you draw it:

```text
[On stroke completion]
       │
       ├─► 1. Find the element under the stroke
       │      └─ elementsFromPoint(), skipping page wrappers, canvases,
       │         and the extension's own host element
       │
       ├─► 2. Prefer the most specific stable container
       │      └─ #id → data-id / data-testid → article / li / tr / section
       │         → card / comment / list-item class patterns
       │
       ├─► 3. Record how to find it again
       │      └─ primary CSS selector + fallback selectors
       │         + a short W3C-style text quote
       │
       └─► 4. On later visits, resolve and shift
              ├─ selector match → fallback selectors → text walk
              ├─ store the element's initial rect, then apply the delta
              │  when it moves (MutationObserver + resize, debounced)
              └─ if nothing resolves, the annotation is "orphaned" and is
                 either hidden or drawn dimmed, depending on your setting
```

Anchoring can be turned off in settings if you'd rather have fixed page coordinates, and orphaned annotations can be hidden entirely or left visible but dimmed.

### Staying fast on low-end hardware

Drawing overlays get slow for two predictable reasons: enormous canvases (a 20,000px-tall page is a lot of pixels to allocate), and redrawing every object on every `mousemove`. Page Anchor avoids both:

1. **Fixed-viewport dual canvas.** The canvas is clamped to `innerWidth × innerHeight`. A separate active layer previews the stroke in progress, while a base layer holds everything committed — so drawing never forces a full re-render of existing annotations.
2. **Frustum culling.** Every element keeps an axis-aligned bounding box; anything outside the viewport is skipped instead of being sent to Canvas 2D. This one is always on.
3. **RDP point decimation.** Raw pointer input produces thousands of points. On stroke completion, Ramer–Douglas–Peucker simplification (1.2px tolerance) discards points that sit within a pixel of the approximated line, which also shrinks what has to be written to storage. This is the one optimisation exposed as a setting (`Simplify Stroke Points`); turn it off if you want maximum stroke fidelity.
4. **Coalesced pointer events.** `getCoalescedEvents()` picks up sub-frame input from high-rate mice and trackpads without flooding the main thread.
5. **Passive, rAF-throttled scroll handling.** Scroll and resize work is batched into animation frames and debounced so native scrolling stays smooth.

There's a harness for measuring this instead of trusting the claims — see [`pnpm perf`](#getting-started-development).

---

## Why Another Annotation Extension?

Screenshot tools are one-shot: you capture, mark up, save a PNG, and the context is gone. Generic drawing extensions tend to treat the page as a flat bitmap and break the moment the layout shifts. And the browser's own annotation features are tied to a specific reading mode or a specific vendor.

The goal here was narrower: a light overlay that behaves like part of the page, remembers what you drew, and doesn't ask you to create an account to do it. The main use cases it was built around:

1. **Reviewing work in progress** — flagging layout bugs, spacing problems, and copy changes on a live staging site, where you can't edit the DOM by hand for a client.
2. **Design and content feedback** — drawing directly on the thing being discussed instead of describing its location in a ticket.
3. **Studying and research** — highlighting and annotating long articles, documentation, and papers without installing a reader mode.
4. **Teaching and explaining** — walking someone through a dashboard or a flow while drawing on it.

---

## Keyboard Shortcuts

| Action | Default | Notes |
| :--- | :---: | :--- |
| Toggle drawing mode | `Alt + Shift + D` | Overlay on / off. Avoids `Alt + D`, which focuses the address bar |
| Toggle toolbar | `Alt + Shift + T` | Dock the toolbar to the left edge, or restore it |
| Select / move | `V` | Drag to reposition, `Delete` to remove |
| Pen | `P` | Freehand |
| Highlighter | `H` | Semi-transparent |
| Rectangle | `R` | |
| Circle | `C` | Ellipse by default, `Shift` for a perfect circle |
| Line | `L` | `Shift` snaps to 0°, 45°, 90° |
| Arrow | `A` | Single head |
| Double arrow | `D` | Heads on both ends |
| Text note | `T` | Click to place |
| Eraser | `E` | Click or sweep |
| Undo | `Ctrl + Z` | `Cmd + Z` on macOS |
| Redo | `Ctrl + Y` | `Cmd + Y` on macOS |
| Select all | `Ctrl + A` | Selects every element so you can move them together |
| Delete selected | `Delete` | `Backspace` also works |
| Clear page | `Alt + Shift + X` | Clears everything on the current URL |

A few deliberate choices:

- Global toggles use `Alt + Shift` so they don't collide with reserved browser shortcuts (`Ctrl + D` for bookmarks, `Alt + D` for the address bar) or with `AltGr` combinations that produce characters like `€` on European layouts.
- Single-letter tool shortcuts only fire while drawing mode is active. With the overlay off, the page receives every keystroke as normal — YouTube, GitHub, and your own web apps behave exactly as they would without the extension.
- Modifiers are labelled per platform: `Ctrl` on Windows and Linux, `Cmd` on macOS, `Option` instead of `Alt` on Apple hardware. Bindings saved by older versions are migrated automatically.
- Everything above can be rebound from the popup's **Settings** panel or the **Options** page, which warn you when a chord is likely to be intercepted by the browser.

---

## How It Was Built

- **[WXT](https://wxt.dev/)** for the extension framework: Vite-powered builds, HMR during development, and one codebase producing MV3 and MV2 bundles.
- **TypeScript** in strict mode across the engine, storage layer, UI, and background worker.
- **Tailwind CSS v4** for the popup and options pages, compiled at build time.
- **Canvas 2D** for rendering, with no rendering library in between.
- **Lucide** icons, inlined as SVG at build time so there's no icon request at runtime.
- **Vitest** and **happy-dom** for unit and integration tests, **Playwright** for end-to-end runs in a real browser.

> **A note on the TypeScript toolchain**: TypeScript 7 ships without the compiler API that `typescript-eslint` still needs. The `typescript` dev dependency is therefore aliased to `@typescript/typescript6` (the 6.x compatibility API, which exposes `tsc6`), while `@typescript/native` provides the TypeScript 7 `tsc` binary used by `pnpm compile` and `pnpm build`.

---

## Platform Support

| Browser | Engine / manifest | Build target |
| :--- | :--- | :--- |
| Google Chrome, Brave, Edge, Opera, Vivaldi | Chromium, Manifest V3 | `pnpm build` / `pnpm build:edge` |
| Mozilla Firefox | Gecko, Manifest V2 | `pnpm build:firefox` |
| Safari | WebKit, Manifest V3 | `pnpm build:safari` |

The Firefox build requires **Firefox 140+**, the version that introduced the data-collection consent declaration used in the manifest. Firefox for Android needs 142+.

---

## Getting Started (Development)

### Prerequisites

- **Node.js** 20.19+ or 22.12+ (22 LTS recommended) — [nodejs.org](https://nodejs.org/)
- **pnpm** — [pnpm.io](https://pnpm.io/). The repo pins `pnpm@11.24.0` through the `packageManager` field, so Corepack will use the right version automatically.

```bash
npm install -g pnpm
```

### Setup

```bash
git clone https://github.com/ayaan-qadri/page-anchor.git
cd page-anchor
pnpm install
```

### Development

```bash
pnpm dev            # Chrome/Chromium with HMR
pnpm dev:firefox    # Firefox with HMR
```

WXT opens a browser profile with the extension loaded and reloads it as you edit.

### Builds

```bash
pnpm build              # Chrome / Chromium (MV3) → .output/chrome-mv3
pnpm build:firefox      # Firefox (MV2)          → .output/firefox-mv2
pnpm build:edge         # Microsoft Edge
pnpm build:safari       # Safari

pnpm zip                # store-ready zips for each target
pnpm zip:firefox
pnpm zip:edge
pnpm zip:safari
```

### Checks

```bash
pnpm compile    # tsc --noEmit
pnpm lint       # ESLint over src/, entrypoints/, tests/, e2e/, scripts/
pnpm test       # Vitest unit + integration suite
pnpm check      # all three; CI runs this, then both production builds
pnpm test:e2e   # Playwright, in a real browser (needs: pnpm exec playwright install chromium)
```

### Load, throttle, and edge-case harnesses

```bash
pnpm build && pnpm test:edge   # persistence, quota, backups, SPAs, orphaned anchors
pnpm build && pnpm perf        # 1,000 anchored elements at 1x / 4x / 6x CPU, slow 3G
pnpm build && pnpm perf:quick  # 300 elements, for a faster loop
```

Both harnesses launch Chromium with the built extension installed, drive the real UI, and write `edge-results.json` and `perf-results.json`. `pnpm perf` reports main-thread task time, frame-time percentiles, long tasks, and storage timings per phase, so performance changes can be compared rather than guessed at.

### Regenerating the icons

```bash
pnpm icons              # rebuild 16 / 32 / 48 / 128 from assets/icon-source.png
pnpm icons -- --all     # also emit 19 / 38 / 64 / 96 / 256 / 512
```

Every shipped size is derived from `assets/icon-source.png`, so swapping the brand artwork means replacing that one file and re-running the command. The script is dependency-free — it decodes, resamples, and re-encodes PNGs itself — detects the artwork's bounding box, and masks each tile with an anti-aliased rounded corner.

---

## Testing the Extension

### Chrome, Brave, Edge

1. Build with `pnpm build` (or run `pnpm dev` and use the profile WXT opens).
2. Go to `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select `.output/chrome-mv3`.
5. Open any page and press `Alt + Shift + D`.

On `chrome://` pages and other privileged URLs, extensions can't inject content scripts, so the overlay won't appear there. That's the browser's restriction, not a bug.

### Firefox

1. Build with `pnpm build:firefox`.
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **Load Temporary Add-on…** and select `.output/firefox-mv2/manifest.json`.

Temporary add-ons are removed when Firefox closes. For a persistent install you'll need a signed build.

---

## Project Structure

```text
page-anchor/
├── entrypoints/
│   ├── background.ts            # Service worker, commands, cross-tab messaging
│   ├── content.ts               # Content script: mounts the overlay on each page
│   ├── popup/                   # Toolbar popup (status, settings, backup)
│   │   ├── index.html
│   │   ├── popup.css
│   │   ├── popup.ts
│   │   └── popup-settings.ts
│   └── options/                 # Full options page
│       ├── index.html
│       ├── options.css
│       └── options.ts
├── src/
│   ├── core/
│   │   ├── anchor.ts            # DOM anchoring: selectors, deltas, orphan recovery
│   │   ├── engine.ts            # Dual-canvas renderer, input handling, hit testing
│   │   ├── geometry.ts          # Bounding boxes, culling, RDP, bezier splines
│   │   ├── history.ts           # Bounded undo/redo stack
│   │   ├── shortcuts.ts         # Bindings, normalisation, conflict detection
│   │   ├── storage.ts           # URL normalisation, per-page persistence
│   │   ├── format.ts            # Element labels and display formatting
│   │   └── inject.ts            # Idempotent script injection
│   ├── ui/
│   │   ├── toolbar.ts           # Floating toolbar, left-edge docking
│   │   ├── text-editor.ts       # In-page text annotation overlay
│   │   ├── shortcut-recorder.ts # Interactive key capture
│   │   ├── styles.ts            # Shadow DOM CSS
│   │   └── dom.ts               # Safe DOM helpers (no innerHTML)
│   ├── icons/svg-icons.ts       # Inlined SVG icon set
│   ├── types/                   # Engine, storage, shortcut, and UI contracts
│   └── styles/tailwind.css      # Popup / options styles
├── public/                      # Generated icons: 16, 32, 48, 128
├── assets/icon-source.png       # Master artwork for the icon pipeline
├── scripts/
│   ├── generate-icons.js        # pnpm icons
│   ├── perf-throttle.mjs        # pnpm perf
│   └── edge-cases.mjs           # pnpm test:edge
├── tests/                       # Vitest suites
├── e2e/                         # Playwright specs
├── wxt.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── eslint.config.js
└── package.json
```

---

## Contributing

Contributions are welcome, whether that's a bug fix, a new tool, better anchor heuristics, or documentation.

1. Read the [Contributing Guidelines](CONTRIBUTING.md).
2. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).
3. Run `pnpm check` before opening a pull request.
4. Found a bug or have an idea? [Open an issue](https://github.com/ayaan-qadri/page-anchor/issues).

If you're changing anything in the renderer or the anchoring logic, the perf and edge-case harnesses are the fastest way to find out whether you've regressed something.

---

## Security & Privacy

- **Local only.** Drawings, notes, and settings live in `browser.storage.local`. Nothing is sent anywhere; there are no accounts and no telemetry.
- **Narrow, explained permissions.** `storage` for annotations and settings, `activeTab` for the popup, and `scripting` on Chromium builds. The content script matches all URLs — that's what makes it possible to draw on arbitrary pages — but it only mounts the overlay and reads the annotations it stored itself. No network requests are made at runtime.
- **Encapsulated UI.** The overlay lives inside a shadow root, so it can't be styled by, or leak styles into, the page you're annotating.
- **Minimal page mutation.** The extension adds its own host element and canvases to the page; it doesn't rewrite or restyle the site's own DOM.

Full details: [Privacy Policy](PRIVACY.md) and [Security Policy](SECURITY.md).

---

## License

Distributed under the [MIT License](LICENSE). Use it, modify it, and redistribute it as you see fit.

Release history lives in [CHANGELOG.md](CHANGELOG.md).

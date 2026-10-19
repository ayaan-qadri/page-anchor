# Contributing to Page Anchor

First off, thanks for taking the time to contribute! 🎉

Page Anchor is an open-source project and we welcome contributions of all kinds - bug fixes, new drawing tools, performance improvements, UI/UX polish, documentation improvements, and multi-browser testing.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Submitting Pull Requests](#submitting-pull-requests)
- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Testing Guidelines](#testing-guidelines)

---

## Code of Conduct

This project follows our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to uphold a welcoming, inclusive, and respectful environment for everyone.

---

## How Can I Contribute?

### Reporting Bugs

If you find a bug or unexpected behavior on a specific web page:

1. Search existing [Issues](https://github.com/ayaan-qadri/page-anchor/issues) to ensure it hasn't already been reported.
2. [Open a new issue](https://github.com/ayaan-qadri/page-anchor/issues/new) and include:
   - **Browser & Version** (e.g., Chrome 124, Firefox 125, Edge 124).
   - **Page URL or HTML Snippet** where the issue occurred.
   - **Steps to reproduce**.
   - **Expected behavior** vs. **actual behavior**.
   - **Console logs or screenshots** if available.

### Suggesting Enhancements

Have an idea for a new tool or workflow improvement? [Open a feature request](https://github.com/ayaan-qadri/page-anchor/issues/new) describing:

- The problem or workflow you want to improve.
- Your proposed solution or user experience.
- Any alternative approaches considered.

### Submitting Pull Requests

1. **Fork** the repository and create your branch from `main`:
   ```bash
   git checkout -b feature/my-new-feature
   ```
2. **Install dependencies**:
   ```bash
   pnpm install
   ```
3. Make your changes with clear, concise commit messages.
4. Ensure all type checks, linting, and tests pass:
   ```bash
   pnpm check
   ```
5. Push to your fork and submit a **Pull Request**.

---

## Development Setup

### Prerequisites
- Node.js (v24+)
- pnpm 11.24+ (`npm install -g pnpm`)

### Key Commands

```bash
# Start development mode with hot reload
pnpm dev

# Build for Chrome MV3
pnpm build

# Build for Firefox MV2
pnpm build:firefox

# Type-check, lint, and run unit tests
pnpm check

# Run the end-to-end browser tests (Playwright)
pnpm test:e2e

# Regenerate extension icons
pnpm icons
```

---

## Project Architecture

- **`entrypoints/`**:
  - `background.ts`: Service worker that routes the toggle command and injects the overlay into open tabs.
  - `content.ts`: Content script that mounts the Shadow DOM host and drives the drawing engine.
  - `popup/`: Browser action popup with quick toggles and the settings panel.
  - `options/`: Full-screen settings, shortcut rebinding, and saved-page management.
- **`src/core/`**:
  - `engine.ts`: Fixed-viewport dual-canvas rendering engine with frustum culling.
  - `geometry.ts`: AABB culling, RDP stroke simplification, and spline maths.
  - `storage.ts`: URL normalization and cross-browser `storage.local` persistence.
  - `shortcuts.ts`: Keyboard shortcut manager, recorder, and conflict detection.
  - `history.ts`: Bounded per-page undo/redo stack.
  - `types.ts`: TypeScript data contracts and messaging protocol definitions.
- **`src/ui/`**:
  - `styles.ts`: Shadow DOM isolated CSS.
  - `dom.ts`: Safe markup helpers that avoid `innerHTML` for dynamic values.
  - `toolbar.ts`: Floating, draggable toolbar with a left-edge dock.
  - `text-editor.ts`: In-page text annotation overlay.
- **`src/icons/`**:
  - `svg-icons.ts`: Inline Lucide SVG icon registry.

---

## Testing Guidelines

We use [Vitest](https://vitest.dev/) for unit and integration tests, [Playwright](https://playwright.dev/) for real-browser end-to-end flows, and two Node harnesses that load the built extension into Chromium:

- `pnpm test` runs the unit suite; `pnpm test:e2e` drives real user flows in a browser.
- `pnpm test:edge` checks persistence, storage-quota, backup, SPA-navigation, and orphan cases.
- `pnpm perf` measures main-thread cost under CPU throttling and a slow network.
- Add test coverage for any new tools, geometry helpers, or storage behaviours.
- Run `pnpm check` before committing.

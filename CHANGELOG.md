# Changelog

All notable changes to Page Anchor are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [1.0.1] — 2026-10-26

### Fixed

- Drawings no longer vanish on pages with deeply nested elements. Anchors now
  resolve the full path to `body`, validate the selector against the captured
  element, and retry after truncated-selector misses.

## [1.0.0] — 2026-10-19

Initial public release.

### Added

- Freehand pen and semi-transparent highlighter with quadratic bezier smoothing.
- Vector shapes: rectangle, circle/ellipse, line (with Shift snapping),
  directional arrow, and double-headed dimension arrow.
- Text annotations with configurable size and high-legibility backdrop cards.
- Select/move, instant eraser, per-page undo/redo, and clear page.
- Per-URL persistent storage with tracking-parameter and hash normalisation.
- DOM-aware anchoring so drawings follow elements that move as a page changes.
- Fully rebindable keyboard shortcuts with a live key recorder and conflict
  warnings.
- Shadow DOM isolated UI that never leaks into, or is affected by, host pages.
- Fixed-viewport dual-canvas engine with frustum culling for low-end hardware.
- Backup and restore of all annotations as JSON.
- Cross-browser builds for Chrome/Edge/Brave (Manifest V3), Firefox (Manifest
  V2), and Safari.

### Privacy

- Drawings, notes, and settings are stored locally in your browser. See [PRIVACY.md](PRIVACY.md).

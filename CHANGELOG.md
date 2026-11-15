# Changelog

All notable changes to Page Anchor are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- The extension icon now toggles the in-page drawing toolbar directly, instead
  of opening a dashboard popup. Clicking it again hides the toolbar, so it
  stops covering the page. Settings, saved pages, and backup live on the
  Options page, reachable from the toolbar's "More" menu.
- The left-edge dock is gone. The toolbar is either showing or hidden, and the
  extension icon toggles between the two. The "Dock to Left Edge" menu item
  went with it, since it did exactly what the icon now does.
- The drawing toolbar is shorter and calmer. Shape tools moved into a "Shapes"
  menu, and secondary controls moved into a "More" menu, taking the bar from
  twenty buttons to thirteen. Selection chrome was muted so it stops
  competing with the page being annotated.

### Fixed

- Changing the highlighter colour now actually changes the highlighter. The
  preset swatches and the colour preview follow the active tool, so picking a
  colour while the highlighter is selected recolours highlights instead of the
  pen. Editing the pen colour no longer disturbs the highlighter's colour.
- "Clear All" no longer asks for confirmation on every press. It clears
  immediately and offers an undo, so repeated edits are not interrupted by a
  modal dialog.
- Undoing a clear restores the drawings in a single step instead of two.
- An eraser sweep counts as one undo step rather than one per pointer event.
- Clicking an element to select it no longer consumes an undo step.
- Clicking inside a shape you drew now selects it, instead of requiring a hit
  on its thin outline.

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

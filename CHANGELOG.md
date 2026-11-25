# Changelog

All notable changes to Page Anchor are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Brighter highlighters that keep text readable. Highlights now tint the
  page the way a real marker does: on light pages the text under them stays
  black, and on dark pages it stays white, so even the strongest setting
  never hides what you highlighted.
- The highlighter has its own six vivid colours, an intensity slider from soft
  to bold, and a preview of how the highlight looks on light and dark pages.
- A roughly straight sweep with the highlighter snaps to a neat, level bar
  with flat ends. Circles and other freehand marks stay as drawn.
- Print the page with your drawings. Choose "Print" from the toolbar's
  "More" menu, or print just a selected area from "Capture area". Long pages
  are split into sheets between lines of text, and everything prints at the
  same size on A4 or Letter paper. Not available in Safari.

### Changed

- Highlights are drawn under pen marks, shapes and notes instead of over them.
- Colour swatches are announced by name, such as "Yellow", to screen readers.

## [1.1.2] - 2026-11-21

### Added

- Capture just part of the page. Choose "Capture area" from the toolbar's
  "More" menu, drag over the part you want, then save it as a PNG or PDF or
  copy it to the clipboard.
- On phones, a one-time hint explains that two fingers scroll the page while
  the toolbar is open.

### Changed

- Every browser, Firefox and Safari included, now runs the same Manifest V3
  build. If access to websites is limited, the Options page explains why
  drawings may not reappear on their own and lets you allow all websites,
  allow just the current site, or keep it limited.

### Fixed

- Drawings stay attached to the right content more reliably when a page
  changes its layout or content after loading.
- Scrolling with two fingers while drawing on a phone no longer leaves a
  stray mark, and scrolls the page as far as the fingers move.

## [1.1.1] - 2026-11-17

### Added

- Save the whole page, drawings included, as a PNG image or an A4 PDF from the
  toolbar's "More" menu. Works on desktop and phones. A progress panel shows
  how far the save is and what stops it: scrolling, clicking, pressing a key
  or switching tabs, or touching the page on a phone, plus a Stop button.
  Firefox captures the page without moving it; other browsers scroll through
  it briefly. Everything happens on your device, and no extra libraries or
  permissions were added. Thanks to @Ishayahu for the original idea and
  implementation.

### Fixed

- On phones the toolbar no longer runs off the edge of the screen. It wraps
  onto a second row, so every tool and the "More" menu stay reachable.
- Drawing with a finger no longer scrolls the page or swipes back to the
  previous page. Thanks to @Ishayahu for finding both on Android.

## [1.1.0] - 2026-11-16

### Changed

- Pages without drawings no longer pay for the extension. A tiny script checks
  for saved drawings; the toolbar and drawing engine load only on pages that
  have drawings or when you open the toolbar.
- The toolbar never opens by itself when a page loads, even if it was open
  last time. Click the extension icon or use the shortcut to bring it up. The
  "Keep toolbar open by default" setting was removed.
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

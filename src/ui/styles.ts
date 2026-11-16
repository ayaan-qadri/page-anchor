export const SHADOW_STYLES = `
/* Important :host declarations come from the inner cascade context, so they beat page rules on the host even when those are !important. */
:host {
  all: initial !important;
  display: block !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: visible !important;
  z-index: 2147483647 !important;
  visibility: visible !important;
  opacity: 1 !important;
  pointer-events: auto !important;
  /* Any of these would become the containing block for the fixed-position toolbar and canvases. */
  transform: none !important;
  filter: none !important;
  backdrop-filter: none !important;
  perspective: none !important;
  contain: none !important;
  will-change: auto !important;
  clip-path: none !important;
  mask: none !important;
  zoom: 1 !important;
  direction: ltr !important;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
  font-size: 13px !important;
  font-weight: 400 !important;
  font-style: normal !important;
  line-height: 1.5 !important;
  letter-spacing: normal !important;
  text-transform: none !important;
  text-align: left !important;
  color: var(--pa-text) !important;
  box-sizing: border-box !important;

  /* Design tokens (isolated copy, the host page never loads the app theme). */
  --pa-bg: #141724 !important;
  --pa-surface: #1e2233 !important;
  --pa-surface-2: #262b3e !important;
  --pa-elevated: #2f354c !important;
  --pa-text: #e8eaf3 !important;
  --pa-muted: #9da6c0 !important;
  --pa-faint: #7d86a2 !important;
  --pa-line: rgba(255, 255, 255, 0.12) !important;
  --pa-line-strong: rgba(255, 255, 255, 0.18) !important;
  --pa-accent: #5b8def !important;
  --pa-accent-strong: #3f63da !important;
  --pa-accent-soft: #a9c1f8 !important;
  --pa-ring: #7ca5f7 !important;
  --pa-violet: #8b7ae0 !important;
  --pa-mint: #7fd1d0 !important;
  --pa-danger: #e0576b !important;
  --pa-danger-soft: #f2a0aa !important;
  --pa-warning: #e5a94a !important;
  --pa-warning-soft: #f0c680 !important;
  --pa-ease: cubic-bezier(0.4, 0, 0.2, 1) !important;
  --pa-panel-shadow: 0 4px 20px -2px rgba(0, 0, 0, 0.35), 0 2px 6px -1px rgba(0, 0, 0, 0.2) !important;
  --pa-bar-bg: rgba(26, 30, 44, 0.94) !important;
  --pa-pop-bg: rgba(26, 30, 44, 0.98) !important;
  --pa-hover: rgba(255, 255, 255, 0.07) !important;
  --pa-hover-strong: rgba(255, 255, 255, 0.11) !important;
  --pa-active-bg: rgba(91, 141, 239, 0.18) !important;
  --pa-active-fg: #b9cdfa !important;
  --pa-active-ring: rgba(124, 165, 247, 0.5) !important;
  --pa-icon: #b3bbd1 !important;
  --pa-track: rgba(255, 255, 255, 0.14) !important;
  --pa-thumb: #f4f6fc !important;
  --pa-swatch-ring: rgba(0, 0, 0, 0.45) !important;
}

/* Follows the system theme, so the toolbar is not a dark slab on a light desktop. */
@media (prefers-color-scheme: light) {
  :host {
    --pa-surface: #f4f6fa !important;
    --pa-surface-2: #eef1f6 !important;
    --pa-elevated: #e4e8f0 !important;
    --pa-text: #1b2030 !important;
    --pa-muted: #4d556b !important;
    --pa-faint: #6b7389 !important;
    --pa-line: rgba(15, 23, 42, 0.1) !important;
    --pa-line-strong: rgba(15, 23, 42, 0.16) !important;
    --pa-ring: #3f6fe0 !important;
    --pa-panel-shadow: 0 8px 28px -8px rgba(15, 23, 42, 0.28), 0 1px 3px rgba(15, 23, 42, 0.1) !important;
    --pa-bar-bg: rgba(255, 255, 255, 0.96) !important;
    --pa-pop-bg: rgba(255, 255, 255, 0.99) !important;
    --pa-hover: rgba(15, 23, 42, 0.06) !important;
    --pa-hover-strong: rgba(15, 23, 42, 0.1) !important;
    --pa-active-bg: rgba(63, 111, 224, 0.12) !important;
    --pa-active-fg: #2a56c6 !important;
    --pa-active-ring: rgba(63, 111, 224, 0.45) !important;
    --pa-icon: #3e465c !important;
    --pa-track: rgba(15, 23, 42, 0.14) !important;
    --pa-thumb: #2a56c6 !important;
    --pa-swatch-ring: rgba(15, 23, 42, 0.2) !important;
  }
}

*, *::before, *::after {
  box-sizing: inherit;
  margin: 0;
  padding: 0;
}

.pa-toolbar-wrapper {
  position: fixed;
  z-index: 2147483645;
  user-select: none;
  touch-action: none;
  transition: opacity 0.15s ease;
}

.pa-toolbar {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 6px;
  border-radius: 16px;
  background: var(--pa-bar-bg);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid var(--pa-line);
  box-shadow: var(--pa-panel-shadow);
}

.pa-toolbar-close-btn {
  position: absolute;
  top: -8px;
  right: -8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  background: var(--pa-pop-bg);
  border: 1px solid var(--pa-line-strong);
  color: var(--pa-muted);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
  transition: transform 0.12s var(--pa-ease), background-color 0.12s var(--pa-ease),
    color 0.12s var(--pa-ease), border-color 0.12s var(--pa-ease);
  z-index: 10;
}

.pa-toolbar-close-btn::before {
  content: "";
  position: absolute;
  top: -4px;
  left: -4px;
  right: -4px;
  bottom: -4px;
}

.pa-toolbar-close-btn:hover {
  background: var(--pa-elevated);
  color: var(--pa-text);
  border-color: var(--pa-line-strong);
  transform: scale(1.1);
}

.pa-toolbar-close-btn:active {
  transform: scale(0.95);
}

.pa-toolbar-close-btn svg {
  width: 12px;
  height: 12px;
  flex: none;
}

.pa-toolbar-close-btn .pa-tooltip {
  left: auto;
  right: 0;
  transform: translateY(4px);
}

.pa-toolbar-close-btn:hover .pa-tooltip,
.pa-toolbar-close-btn:focus-visible .pa-tooltip {
  opacity: 1;
  transform: translateY(0);
}

.pa-toolbar-close-btn .pa-tooltip.pa-tooltip-below,
.pa-placement-top .pa-toolbar-close-btn .pa-tooltip {
  bottom: auto;
  top: calc(100% + 10px);
  transform: translateY(-4px);
}

.pa-toolbar-close-btn:hover .pa-tooltip.pa-tooltip-below,
.pa-toolbar-close-btn:focus-visible .pa-tooltip.pa-tooltip-below,
.pa-placement-top .pa-toolbar-close-btn:hover .pa-tooltip,
.pa-placement-top .pa-toolbar-close-btn:focus-visible .pa-tooltip {
  opacity: 1;
  transform: translateY(0);
}

.pa-drag-handle {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 36px;
  border-radius: 9px;
  color: var(--pa-faint);
  cursor: grab;
  transition: color 0.13s var(--pa-ease), background-color 0.13s var(--pa-ease);
}

.pa-drag-handle:hover {
  color: var(--pa-muted);
  background: var(--pa-hover);
}

.pa-drag-handle:active {
  cursor: grabbing;
}

.pa-separator {
  flex: none;
  width: 1px;
  height: 22px;
  margin: 0 5px;
  background: var(--pa-line);
}

.pa-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--pa-icon);
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), color 0.13s var(--pa-ease),
    box-shadow 0.13s var(--pa-ease), transform 0.08s var(--pa-ease);
}

.pa-btn:hover {
  background: var(--pa-hover);
  color: var(--pa-text);
}

.pa-btn:active {
  transform: scale(0.95);
}

.pa-btn.active {
  background: var(--pa-active-bg);
  color: var(--pa-active-fg);
  box-shadow: inset 0 0 0 1px var(--pa-active-ring);
}

/* The icon steps left, staying level with its neighbours, so the key letter gets its own corner instead of touching the glyph. */
.pa-btn.has-key-hint > svg {
  transform: translateX(-3px);
}

.pa-key-hint {
  position: absolute;
  right: 4px;
  bottom: 3px;
  color: var(--pa-faint);
  font-size: 8.5px;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.02em;
  opacity: 0.85;
  pointer-events: none;
}

.pa-btn.active .pa-key-hint {
  color: var(--pa-active-fg);
  opacity: 0.75;
}

.pa-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

.pa-tooltip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  padding: 6px 10px;
  border-radius: 8px;
  background: #151a28;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #eef0f6;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: 0;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  box-shadow: 0 10px 24px -8px rgba(0, 0, 0, 0.85);
  transition: opacity 0.14s var(--pa-ease), transform 0.14s var(--pa-ease);
  z-index: 100;
}

/* A tooltip never sits on top of the menu, popover or toast its own button just opened. */
.pa-tip-hidden .pa-tooltip,
[aria-expanded="true"] > .pa-tooltip {
  opacity: 0 !important;
  visibility: hidden;
}

.pa-tooltip kbd {
  display: inline-block;
  padding: 1px 5px;
  margin-left: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #b3bbd1;
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.4;
}

.pa-btn:hover .pa-tooltip,
.pa-btn:focus-visible .pa-tooltip,
.pa-drag-handle:hover .pa-tooltip,
.pa-drag-handle:focus-visible .pa-tooltip,
.pa-color-preview-btn:hover .pa-tooltip,
.pa-color-preview-btn:focus-visible .pa-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.pa-tooltip.pa-tooltip-below,
.pa-placement-top .pa-tooltip {
  bottom: auto;
  top: calc(100% + 10px);
  transform: translateX(-50%) translateY(-4px);
}

.pa-btn:hover .pa-tooltip.pa-tooltip-below,
.pa-btn:focus-visible .pa-tooltip.pa-tooltip-below,
.pa-drag-handle:hover .pa-tooltip.pa-tooltip-below,
.pa-drag-handle:focus-visible .pa-tooltip.pa-tooltip-below,
.pa-color-preview-btn:hover .pa-tooltip.pa-tooltip-below,
.pa-color-preview-btn:focus-visible .pa-tooltip.pa-tooltip-below,
.pa-placement-top .pa-btn:hover .pa-tooltip,
.pa-placement-top .pa-btn:focus-visible .pa-tooltip,
.pa-placement-top .pa-drag-handle:hover .pa-tooltip,
.pa-placement-top .pa-drag-handle:focus-visible .pa-tooltip,
.pa-placement-top .pa-color-preview-btn:hover .pa-tooltip,
.pa-placement-top .pa-color-preview-btn:focus-visible .pa-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.pa-color-preview-btn {
  position: relative;
  flex: none;
  width: 26px;
  height: 26px;
  margin: 0 5px;
  border-radius: 999px;
  border: 2px solid #f4f6fc;
  cursor: pointer;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.5);
  transition: transform 0.13s var(--pa-ease);
}

.pa-color-preview-btn:hover {
  transform: scale(1.08);
}

.pa-color-preview-btn.is-empty {
  background: transparent;
  border: 2px dashed var(--pa-faint);
  box-shadow: none;
}

.pa-color-preview-btn.is-mixed {
  background: conic-gradient(#ef4444, #facc15, #22c55e, #3b82f6, #8b5cf6, #ef4444);
}

.pa-popover {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  display: none;
  flex-direction: column;
  width: 252px;
  padding: 0;
  border-radius: 14px;
  background: var(--pa-pop-bg);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid var(--pa-line-strong);
  box-shadow: var(--pa-panel-shadow);
  max-height: min(70vh, 520px);
  overflow: hidden;
  z-index: 101;
}

.pa-popover.below {
  bottom: auto;
  top: calc(100% + 10px);
}

.pa-popover-header {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 10px 14px;
  border-bottom: 1px solid var(--pa-line);
}

.pa-popover-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.pa-popover-tool-info {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
}

.pa-popover-tool-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: var(--pa-active-bg);
  color: var(--pa-active-fg);
  flex-shrink: 0;
}

.pa-popover-tool-icon svg {
  width: 15px;
  height: 15px;
}

.pa-popover-tool-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--pa-text);
  letter-spacing: -0.005em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pa-tool-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pa-tool-panel-empty {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0 2px 0;
  color: var(--pa-muted);
  font-size: 11px;
  line-height: 1.4;
}

.pa-tool-empty-msg {
  color: var(--pa-muted);
  font-size: 13px;
  line-height: 1.45;
}

.pa-quick-tools {
  display: flex;
  gap: 6px;
  margin-top: 2px;
}

.pa-quick-tool-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1;
  padding: 8px 6px;
  border-radius: 9px;
  background: var(--pa-hover);
  border: 1px solid var(--pa-line);
  color: var(--pa-text);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), border-color 0.13s var(--pa-ease);
}

.pa-quick-tool-btn:hover {
  background: var(--pa-hover-strong);
  border-color: var(--pa-line-strong);
}

.pa-quick-tool-btn svg {
  width: 13px;
  height: 13px;
  color: var(--pa-active-fg);
}

.pa-popover-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 14px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.pa-popover.open {
  display: flex;
}

.pa-color-grid {
  display: grid;
  grid-template-columns: repeat(6, 26px);
  justify-content: space-between;
  gap: 10px;
}

.pa-color-swatch {
  position: relative;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  border: 1px solid var(--pa-swatch-ring);
  cursor: pointer;
  transition: transform 0.13s var(--pa-ease), box-shadow 0.13s var(--pa-ease);
}

.pa-color-swatch:hover {
  transform: scale(1.12);
}

.pa-color-swatch.active {
  box-shadow: 0 0 0 2px var(--pa-pop-bg), 0 0 0 4px var(--pa-ring);
}

/* Any other colour: the native picker sits invisibly over a rainbow swatch. */
.pa-color-custom {
  background: conic-gradient(#ef4444, #facc15, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, #ef4444);
}

.pa-color-custom::after {
  content: "+";
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ffffff;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
  pointer-events: none;
}

.pa-color-custom:focus-within {
  outline: 2px solid var(--pa-ring);
  outline-offset: 2px;
}

.pa-slider-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pa-popover-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  color: var(--pa-muted);
}

.pa-popover-color {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  border: 0;
  cursor: pointer;
}

.pa-popover-divider {
  height: 1px;
  background: var(--pa-line);
}

.pa-popover-reset {
  flex: none;
  padding: 5px 9px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: var(--pa-muted);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), color 0.13s var(--pa-ease);
}

.pa-popover-reset:hover {
  background: var(--pa-hover);
  color: var(--pa-text);
}

.pa-slider-label {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--pa-muted);
}

.pa-slider-label span:last-child {
  color: var(--pa-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.pa-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 999px;
  background: var(--pa-track);
  outline: none;
}

.pa-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 999px;
  background: var(--pa-thumb);
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
}

.pa-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border: none;
  border-radius: 999px;
  background: var(--pa-thumb);
  cursor: pointer;
}

.pa-count-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 17px;
  padding: 2px 4px;
  border-radius: 999px;
  background: var(--pa-accent-strong);
  border: 2px solid var(--pa-bar-bg);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  text-align: center;
  pointer-events: none;
}

/* ── Popup menus ──────────────────────────────────────────────── */

.pa-menu-anchor {
  position: relative;
  display: flex;
}

.pa-menu {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: none;
  flex-direction: column;
  min-width: 236px;
  max-height: min(85vh, 480px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border-radius: 14px;
  background: var(--pa-pop-bg);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid var(--pa-line-strong);
  box-shadow: var(--pa-panel-shadow);
  z-index: 102;
}

.pa-menu.above {
  top: auto;
  bottom: calc(100% + 8px);
}

.pa-menu.pa-menu-right {
  left: auto;
  right: 0;
  transform: none;
}

.pa-menu.open {
  display: flex;
}

.pa-menu-item {
  display: flex;
  align-items: center;
  gap: 11px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--pa-text);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  line-height: 1.3;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s var(--pa-ease), color 0.12s var(--pa-ease);
}

.pa-menu-item:hover,
.pa-menu-item:focus-visible {
  background: var(--pa-hover);
}

.pa-menu-item.active {
  background: var(--pa-active-bg);
  color: var(--pa-active-fg);
}

.pa-menu-item svg {
  flex: none;
  width: 17px;
  height: 17px;
}

.pa-menu-item-icon {
  display: flex;
  flex: none;
  color: var(--pa-icon);
}

.pa-menu-item.active .pa-menu-item-icon {
  color: inherit;
}

.pa-menu-item[aria-checked="true"] .pa-menu-item-hint {
  color: var(--pa-active-fg);
}

.pa-menu-item-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pa-menu-item-key {
  flex: none;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--pa-hover);
  color: var(--pa-muted);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
}

.pa-menu-item-hint {
  flex: none;
  color: var(--pa-faint);
  font-size: 12px;
  font-weight: 500;
}

.pa-text-input-wrapper {
  position: absolute;
  z-index: 2147483644;
  padding: 8px 10px 6px;
  border-radius: 10px;
  background: rgba(17, 20, 31, 0.96);
  border: 1.5px solid #7ca5f7;
  box-shadow: 0 12px 32px -10px rgba(0, 0, 0, 0.6);
}

.pa-text-textarea {
  background: transparent;
  border: none;
  outline: none;
  color: #e8eaf3;
  font-family: inherit;
  font-weight: 600;
  line-height: 1.4;
  resize: both;
  min-width: 180px;
  min-height: 28px;
}

.pa-text-textarea:focus-visible {
  outline: none;
}

.pa-text-hint {
  margin-top: 4px;
  color: #8f98b3;
  font-size: 11px;
  white-space: nowrap;
}

.pa-text-textarea::placeholder {
  color: #7d86a2;
  font-weight: 500;
}

/* ── Focus & motion (WCAG 2.4.7 / 2.3.3) ────────────────────── */

:focus-visible {
  outline: 2px solid var(--pa-ring);
  outline-offset: 2px;
}

.pa-color-swatch:focus-visible {
  outline-color: #ffffff;
}

.pa-slider:focus-visible {
  outline-offset: 4px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.pa-toast {
  position: absolute;
  top: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 6px 6px 14px;
  border-radius: 12px;
  background: var(--pa-pop-bg);
  border: 1px solid var(--pa-line-strong);
  box-shadow: var(--pa-panel-shadow);
  color: var(--pa-text);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  z-index: 2147483647;
  pointer-events: auto;
  animation: pa-toast-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

.pa-toast.above {
  top: auto;
  bottom: calc(100% + 10px);
}

.pa-toast.pa-toast-hiding {
  opacity: 0;
  transform: translateX(-50%) translateY(4px);
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.pa-toast-text {
  color: var(--pa-text);
}

.pa-toast-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 5px 11px;
  border-radius: 8px;
  background: var(--pa-accent-strong);
  border: none;
  color: #ffffff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.12s ease, transform 0.08s ease;
}

.pa-toast-btn:hover {
  background: var(--pa-accent-strong);
}

.pa-toast-btn:active {
  transform: scale(0.96);
}

@keyframes pa-toast-in {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`;

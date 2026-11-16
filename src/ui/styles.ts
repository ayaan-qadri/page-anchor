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
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
  font-size: 13px !important;
  font-weight: 400 !important;
  font-style: normal !important;
  line-height: 1.5 !important;
  letter-spacing: normal !important;
  text-transform: none !important;
  text-align: left !important;
  color: #e8eaf3 !important;
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
  gap: 2px;
  padding: 5px;
  border-radius: 13px;
  background: rgba(26, 30, 44, 0.92);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid var(--pa-line);
  box-shadow: var(--pa-panel-shadow);
}

.pa-toolbar-close-btn {
  position: absolute;
  top: -7px;
  right: -7px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: rgba(26, 30, 44, 0.96);
  border: 1.5px solid var(--pa-line-strong);
  color: var(--pa-muted);
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
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
  border-color: rgba(255, 255, 255, 0.35);
  transform: scale(1.1);
}

.pa-toolbar-close-btn:active {
  transform: scale(0.95);
}

.pa-toolbar-close-btn svg {
  width: 11px;
  height: 11px;
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
  height: 32px;
  border-radius: 8px;
  color: var(--pa-faint);
  cursor: grab;
  transition: color 0.13s var(--pa-ease), background-color 0.13s var(--pa-ease);
}

.pa-drag-handle:hover {
  color: var(--pa-muted);
  background: rgba(255, 255, 255, 0.05);
}

.pa-drag-handle:active {
  cursor: grabbing;
}

.pa-separator {
  flex: none;
  width: 1px;
  height: 18px;
  margin: 0 3px;
  background: var(--pa-line);
}

.pa-btn {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--pa-muted);
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), color 0.13s var(--pa-ease),
    box-shadow 0.13s var(--pa-ease), transform 0.08s var(--pa-ease);
}

.pa-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: var(--pa-text);
}

.pa-btn:active {
  transform: scale(0.95);
}

.pa-btn.active {
  background: rgba(91, 141, 239, 0.16);
  color: var(--pa-accent-soft);
  box-shadow: inset 0 0 0 1px rgba(124, 165, 247, 0.45);
}

.pa-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

.pa-tooltip {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  padding: 5px 8px;
  border-radius: 8px;
  background: #141826;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--pa-text);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  box-shadow: 0 10px 24px -8px rgba(0, 0, 0, 0.85);
  transition: opacity 0.14s var(--pa-ease), transform 0.14s var(--pa-ease);
  z-index: 100;
}

.pa-tooltip kbd {
  display: inline-block;
  padding: 1px 5px;
  margin-left: 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--pa-muted);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px;
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
  width: 24px;
  height: 24px;
  margin: 0 4px;
  border-radius: 999px;
  border: 2px solid #f4f6fc;
  cursor: pointer;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55), 0 2px 6px rgba(0, 0, 0, 0.5);
  transition: transform 0.13s var(--pa-ease);
}

.pa-color-preview-btn:hover {
  transform: scale(1.08);
}

.pa-popover {
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%);
  display: none;
  flex-direction: column;
  min-width: 196px;
  padding: 0;
  border-radius: 12px;
  background: rgba(26, 30, 44, 0.96);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid var(--pa-line-strong);
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.5);
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--pa-line);
  background: rgba(255, 255, 255, 0.02);
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
  gap: 7px;
  min-width: 0;
}

.pa-popover-tool-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  background: var(--pa-surface-2);
  color: var(--pa-accent-soft);
  flex-shrink: 0;
}

.pa-popover-tool-icon svg {
  width: 14px;
  height: 14px;
}

.pa-popover-tool-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--pa-text);
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.pa-popover-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(91, 141, 239, 0.14);
  border: 1px solid rgba(91, 141, 239, 0.3);
  color: var(--pa-accent-soft);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  flex-shrink: 0;
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
  color: var(--pa-faint);
  font-size: 11px;
}

.pa-tool-switch-prompt {
  font-weight: 600;
  color: var(--pa-text);
  font-size: 11px;
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
  gap: 5px;
  flex: 1;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--pa-surface-2);
  border: 1px solid var(--pa-line);
  color: var(--pa-text);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), border-color 0.13s var(--pa-ease);
}

.pa-quick-tool-btn:hover {
  background: var(--pa-elevated);
  border-color: var(--pa-line-strong);
}

.pa-quick-tool-btn svg {
  width: 13px;
  height: 13px;
  color: var(--pa-accent-soft);
}

.pa-popover-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.pa-popover-footer {
  flex: none;
  padding: 10px 12px;
  border-top: 1px solid var(--pa-line);
}

.pa-popover.open {
  display: flex;
}

.pa-color-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.pa-color-target {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--pa-faint);
}

.pa-color-swatch {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.45);
  cursor: pointer;
  transition: transform 0.13s var(--pa-ease), box-shadow 0.13s var(--pa-ease);
}

.pa-color-swatch:hover {
  transform: scale(1.14);
}

.pa-color-swatch.active {
  box-shadow: 0 0 0 2px var(--pa-surface-2), 0 0 0 4px var(--pa-ring);
}

.pa-slider-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
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
  width: 30px;
  height: 26px;
  padding: 2px;
  border: 1px solid var(--pa-line-strong);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  cursor: pointer;
}

.pa-popover-divider {
  height: 1px;
  background: var(--pa-line);
}

.pa-popover-reset {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--pa-line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--pa-muted);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), color 0.13s var(--pa-ease),
    border-color 0.13s var(--pa-ease);
}

.pa-popover-reset:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--pa-text);
  border-color: var(--pa-line-strong);
}

.pa-slider-label {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
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
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  outline: none;
}

.pa-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 13px;
  height: 13px;
  border: none;
  border-radius: 999px;
  background: #f4f6fc;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}

.pa-slider::-moz-range-thumb {
  width: 13px;
  height: 13px;
  border: none;
  border-radius: 999px;
  background: #f4f6fc;
  cursor: pointer;
}

.pa-count-badge {
  position: absolute;
  top: -3px;
  right: -3px;
  min-width: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--pa-accent-strong);
  border: 1.5px solid rgba(26, 30, 44, 0.96);
  color: #ffffff;
  font-size: 9.5px;
  font-weight: 700;
  line-height: 1;
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
  min-width: 218px;
  max-height: min(85vh, 480px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 5px;
  border-radius: 11px;
  background: rgba(26, 30, 44, 0.97);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
  border: 1px solid var(--pa-line-strong);
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.5);
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
  gap: 9px;
  width: 100%;
  padding: 7px 9px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--pa-muted);
  font-size: 12px;
  font-weight: 500;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 0.12s var(--pa-ease), color 0.12s var(--pa-ease);
}

.pa-menu-item:hover {
  background: rgba(255, 255, 255, 0.07);
  color: var(--pa-text);
}

.pa-menu-item.active {
  background: rgba(91, 141, 239, 0.16);
  color: var(--pa-accent-soft);
}

.pa-menu-item svg {
  flex: none;
}

.pa-menu-item-icon {
  display: flex;
  flex: none;
}

.pa-menu-item[aria-checked="true"] .pa-menu-item-hint {
  color: var(--pa-accent-soft);
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
  background: rgba(255, 255, 255, 0.07);
  color: var(--pa-faint);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
}

.pa-menu-item-hint {
  flex: none;
  color: var(--pa-faint);
  font-size: 10.5px;
  font-weight: 500;
}

.pa-text-input-wrapper {
  position: absolute;
  z-index: 2147483644;
  padding: 8px;
  border-radius: 10px;
  background: rgba(17, 20, 31, 0.97);
  border: 1px solid rgba(124, 165, 247, 0.5);
  box-shadow: 0 12px 32px -10px rgba(0, 0, 0, 0.9);
}

.pa-text-textarea {
  background: transparent;
  border: none;
  outline: none;
  color: var(--pa-text);
  font-family: inherit;
  font-weight: 600;
  line-height: 1.4;
  resize: both;
  min-width: 150px;
  min-height: 44px;
}

.pa-text-textarea::placeholder {
  color: var(--pa-faint);
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
  gap: 10px;
  padding: 6px 12px;
  border-radius: 9px;
  background: var(--pa-surface-2);
  border: 1px solid var(--pa-line-strong);
  box-shadow: 0 6px 20px -3px rgba(0, 0, 0, 0.45);
  color: var(--pa-text);
  font-size: 12px;
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
  padding: 3px 9px;
  border-radius: 6px;
  background: var(--pa-accent);
  border: none;
  color: #ffffff;
  font-size: 11px;
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

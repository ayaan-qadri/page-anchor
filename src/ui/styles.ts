export const SHADOW_STYLES = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: #e8eaf3;
  box-sizing: border-box;

  /* Design tokens (isolated copy — the host page never loads the app theme). */
  --pa-bg: #0a0d16;
  --pa-surface: #11141f;
  --pa-surface-2: #161a27;
  --pa-elevated: #1b2030;
  --pa-text: #e8eaf3;
  --pa-muted: #99a1b8;
  --pa-faint: #7c849e;
  --pa-line: rgba(255, 255, 255, 0.08);
  --pa-line-strong: rgba(255, 255, 255, 0.14);
  --pa-accent: #5b8def;
  --pa-accent-strong: #3f63da;
  --pa-accent-soft: #a9c1f8;
  --pa-ring: #7ca5f7;
  --pa-violet: #8b7ae0;
  --pa-mint: #7fd1d0;
  --pa-danger: #e0576b;
  --pa-danger-soft: #f2a0aa;
  --pa-warning: #e5a94a;
  --pa-warning-soft: #f0c680;
  --pa-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --pa-panel-shadow: 0 1px 2px rgba(0, 0, 0, 0.5), 0 12px 32px -14px rgba(0, 0, 0, 0.85);
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
  transition: opacity 0.15s ease, transform 0.15s ease;
}

/*
 * While the user repositions the toolbar we place it at pixel coordinates and
 * clear the centering transform. Without this the left/top snap is instant but
 * the transform animates, which reads as a one-off flick on the first drag.
 */
.pa-toolbar-wrapper.pa-repositioning {
  transition: none;
}

.pa-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 5px;
  border-radius: 13px;
  background: rgba(17, 20, 31, 0.86);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--pa-line);
  box-shadow: var(--pa-panel-shadow);
}

.pa-drag-handle {
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

.pa-btn:hover .pa-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.pa-color-preview-btn {
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
  gap: 12px;
  min-width: 196px;
  padding: 12px;
  border-radius: 12px;
  background: rgba(17, 20, 31, 0.96);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--pa-line-strong);
  box-shadow: 0 18px 40px -14px rgba(0, 0, 0, 0.9);
  z-index: 101;
}

.pa-popover.open {
  display: flex;
}

.pa-color-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
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

.pa-toolbar-wrapper.docked .pa-toolbar,
.pa-toolbar-wrapper.docked .pa-popover {
  display: none !important;
}

.pa-dock {
  display: none;
  position: relative;
}

.pa-toolbar-wrapper.docked .pa-dock {
  display: block;
}

.pa-dock-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 11px 6px;
  border-radius: 0 13px 13px 0;
  background: rgba(17, 20, 31, 0.9);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--pa-line);
  border-left: none;
  color: var(--pa-faint);
  cursor: pointer;
  box-shadow: var(--pa-panel-shadow);
  transition: color 0.15s var(--pa-ease), padding 0.15s var(--pa-ease),
    background-color 0.15s var(--pa-ease);
}

.pa-dock-tab:hover {
  color: var(--pa-text);
  background: rgba(23, 27, 41, 0.96);
  padding-right: 9px;
}

.pa-dock-tab > svg {
  color: var(--pa-accent-soft);
}

.pa-dock-tab:focus-visible {
  outline-offset: -2px;
}

.pa-dock-close {
  position: absolute;
  top: -7px;
  right: -7px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 999px;
  background: var(--pa-elevated);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--pa-line-strong);
  color: var(--pa-muted);
  cursor: pointer;
  box-shadow: var(--pa-panel-shadow);
  transition: color 0.15s var(--pa-ease), background-color 0.15s var(--pa-ease),
    border-color 0.15s var(--pa-ease), transform 0.15s var(--pa-ease);
}

.pa-dock-close:hover {
  color: #ffffff;
  background: var(--pa-danger);
  border-color: transparent;
  transform: scale(1.08);
}

.pa-dock-close:focus-visible {
  outline-offset: 1px;
}

.pa-dock-badge {
  min-width: 16px;
  padding: 2px 5px;
  border-radius: 999px;
  background: var(--pa-accent-strong);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
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

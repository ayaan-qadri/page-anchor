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
  --pa-violet: #a78bfa;
  --pa-mint: #5eead4;
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

/* ── Floating toolbar ───────────────────────────────────────── */

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

.pa-btn.active-warn {
  background: rgba(229, 169, 74, 0.16);
  color: var(--pa-warning-soft);
  box-shadow: inset 0 0 0 1px rgba(229, 169, 74, 0.45);
}

.pa-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
  pointer-events: none;
}

/* ── Tooltips ───────────────────────────────────────────────── */

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

/* ── Colour controls ────────────────────────────────────────── */

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

/* ── Anchor pill ────────────────────────────────────────────── */

.pa-anchor-pill {
  position: fixed;
  bottom: 22px;
  right: 22px;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px 8px 12px;
  border-radius: 999px;
  background: rgba(17, 20, 31, 0.9);
  -webkit-backdrop-filter: blur(20px) saturate(160%);
  backdrop-filter: blur(20px) saturate(160%);
  border: 1px solid var(--pa-line-strong);
  color: var(--pa-text);
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  cursor: pointer;
  user-select: none;
  box-shadow: var(--pa-panel-shadow);
  transition: transform 0.16s var(--pa-ease), border-color 0.16s var(--pa-ease),
    box-shadow 0.16s var(--pa-ease);
}

.pa-anchor-pill > svg {
  flex: none;
  color: var(--pa-accent-soft);
  transition: color 0.16s var(--pa-ease);
}

.pa-anchor-pill:hover {
  transform: translateY(-1px);
  border-color: rgba(124, 165, 247, 0.5);
}

.pa-anchor-pill.active {
  border-color: rgba(124, 165, 247, 0.55);
  box-shadow: 0 0 0 3px rgba(91, 141, 239, 0.14), var(--pa-panel-shadow);
}

.pa-anchor-pill.active > svg {
  color: var(--pa-ring);
}

.pa-pill-badge {
  min-width: 18px;
  padding: 3px 6px;
  border-radius: 999px;
  background: var(--pa-accent-strong);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}

/* ── Text annotation editor ─────────────────────────────────── */

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

/* ── Settings modal ─────────────────────────────────────────── */

.pa-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(6, 8, 14, 0.68);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: paFadeIn 0.16s ease-out;
}

@keyframes paFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.pa-modal {
  display: flex;
  flex-direction: column;
  width: 90%;
  max-width: 560px;
  max-height: 85vh;
  border-radius: 14px;
  background: var(--pa-surface);
  border: 1px solid var(--pa-line);
  box-shadow: 0 24px 64px -20px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.pa-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 15px 18px;
  border-bottom: 1px solid var(--pa-line);
}

.pa-modal-title {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--pa-text);
}

.pa-modal-title svg {
  color: var(--pa-accent-soft);
}

.pa-modal-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid transparent;
  color: var(--pa-muted);
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), color 0.13s var(--pa-ease),
    border-color 0.13s var(--pa-ease);
}

.pa-modal-close:hover {
  color: var(--pa-text);
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--pa-line);
}

.pa-modal-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 18px;
  overflow-y: auto;
}

.pa-section-title {
  margin-bottom: 9px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--pa-faint);
}

.pa-shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--pa-line);
}

.pa-shortcut-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.pa-shortcut-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--pa-text);
}

.pa-shortcut-desc {
  font-size: 11px;
  color: var(--pa-muted);
}

.pa-shortcut-record-btn {
  flex: none;
  min-width: 96px;
  padding: 5px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--pa-line-strong);
  color: var(--pa-accent-soft);
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11.5px;
  font-weight: 600;
  text-align: center;
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), border-color 0.13s var(--pa-ease),
    color 0.13s var(--pa-ease);
}

.pa-shortcut-record-btn:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(124, 165, 247, 0.5);
}

.pa-shortcut-record-btn.recording {
  color: var(--pa-danger-soft);
  background: rgba(224, 87, 107, 0.12);
  border-color: rgba(224, 87, 107, 0.6);
  animation: paPulse 1.3s ease-in-out infinite;
}

@keyframes paPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.62; }
}

.pa-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 13px 18px;
  border-top: 1px solid var(--pa-line);
  background: rgba(0, 0, 0, 0.22);
}

.pa-action-btn {
  padding: 7px 14px;
  border-radius: 9px;
  border: 1px solid transparent;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.13s var(--pa-ease), border-color 0.13s var(--pa-ease),
    color 0.13s var(--pa-ease);
}

.pa-btn-secondary {
  background: rgba(255, 255, 255, 0.06);
  border-color: var(--pa-line);
  color: var(--pa-text);
}

.pa-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--pa-line-strong);
}

.pa-btn-primary {
  background: var(--pa-accent-strong);
  color: #ffffff;
}

.pa-btn-primary:hover {
  background: var(--pa-accent);
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

/* Screen Reader Only Utility */
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

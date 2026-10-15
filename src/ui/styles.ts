export const SHADOW_STYLES = `
:host {
  all: initial;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  color: #f1f5f9;
  box-sizing: border-box;
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

.pa-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(15, 23, 42, 0.88);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 6px 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4), 0 0 1px rgba(255, 255, 255, 0.2);
}

.pa-drag-handle {
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  color: #94a3b8;
  padding: 4px;
  border-radius: 6px;
  transition: color 0.15s;
}

.pa-drag-handle:hover {
  color: #94a3b8;
}

.pa-drag-handle:active {
  cursor: grabbing;
}

.pa-separator {
  width: 1px;
  height: 22px;
  background: rgba(255, 255, 255, 0.12);
  margin: 0 2px;
}

.pa-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  background: transparent;
  border: 1px solid transparent;
  color: #cbd5e1;
  cursor: pointer;
  position: relative;
  transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}

.pa-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.05);
}

.pa-btn:active {
  transform: scale(0.94);
}

.pa-btn.active {
  background: #3b82f6;
  color: #ffffff;
  border-color: #60a5fa;
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.45);
}

.pa-btn.active-warn {
  background: #f59e0b;
  color: #ffffff;
}

.pa-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

.pa-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  background: #0f172a;
  color: #f8fafc;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  transition: opacity 0.15s ease, transform 0.15s ease;
  z-index: 100;
}

.pa-tooltip kbd {
  display: inline-block;
  padding: 1px 4px;
  margin-left: 4px;
  font-size: 10px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  color: #94a3b8;
}

.pa-btn:hover .pa-tooltip {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.pa-color-preview-btn {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  border: 2px solid #ffffff;
  cursor: pointer;
  position: relative;
  box-shadow: 0 0 4px rgba(0,0,0,0.4);
  transition: transform 0.15s;
}

.pa-color-preview-btn:hover {
  transform: scale(1.1);
}

.pa-popover {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.95);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  display: none;
  flex-direction: column;
  gap: 10px;
  z-index: 101;
  min-width: 180px;
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
  width: 24px;
  height: 24px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: transform 0.15s, border-color 0.15s;
}

.pa-color-swatch:hover {
  transform: scale(1.18);
}

.pa-color-swatch.active {
  border-color: #ffffff;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.5);
}

.pa-slider-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pa-slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: #94a3b8;
}

.pa-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.2);
  outline: none;
}

.pa-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  box-shadow: 0 0 6px rgba(59, 130, 246, 0.6);
}

.pa-anchor-pill {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 2147483646;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 30px;
  background: rgba(15, 23, 42, 0.9);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #f1f5f9;
  cursor: pointer;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
  transition: all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  user-select: none;
}

.pa-anchor-pill:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.3);
  border-color: #3b82f6;
}

.pa-anchor-pill .pa-pill-badge {
  background: #3b82f6;
  font-size: 10px;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 10px;
  color: #ffffff;
}

.pa-anchor-pill.active {
  background: #3b82f6;
  border-color: #60a5fa;
  box-shadow: 0 8px 24px rgba(59, 130, 246, 0.5);
}

.pa-text-input-wrapper {
  position: absolute;
  z-index: 2147483644;
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid #3b82f6;
  border-radius: 8px;
  padding: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
}

.pa-text-textarea {
  background: transparent;
  border: none;
  outline: none;
  color: #ffffff;
  font-family: inherit;
  font-weight: 600;
  resize: both;
  min-width: 140px;
  min-height: 40px;
}

.pa-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: paFadeIn 0.15s ease-out;
}

@keyframes paFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.pa-modal {
  background: #0f172a;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 16px;
  width: 90%;
  max-width: 540px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.6);
  overflow: hidden;
}

.pa-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.pa-modal-title {
  font-size: 16px;
  font-weight: 700;
  color: #ffffff;
  display: flex;
  align-items: center;
  gap: 8px;
}

.pa-modal-close {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
}

.pa-modal-close:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.08);
}

.pa-modal-body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.pa-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.pa-shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.pa-shortcut-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pa-shortcut-name {
  font-weight: 600;
  color: #f1f5f9;
  font-size: 13px;
}

.pa-shortcut-desc {
  font-size: 11px;
  color: #94a3b8;
}

.pa-shortcut-record-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 6px;
  padding: 4px 10px;
  color: #38bdf8;
  font-family: monospace;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  min-width: 80px;
  text-align: center;
}

.pa-shortcut-record-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: #38bdf8;
}

.pa-shortcut-record-btn.recording {
  background: #dc2626;
  border-color: #ef4444;
  color: #ffffff;
  animation: paPulse 1.2s infinite;
}

@keyframes paPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.pa-modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(0, 0, 0, 0.2);
}

.pa-action-btn {
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  border: none;
}

.pa-btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.pa-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}

.pa-btn-primary {
  background: #3b82f6;
  color: #ffffff;
}

.pa-btn-primary:hover {
  background: #2563eb;
}

/* Accessibility: Focus Visible Indicators (WCAG 2.4.7) */
:focus-visible {
  outline: 2px solid #38bdf8;
  outline-offset: 2px;
}

.pa-btn:focus-visible,
.pa-drag-handle:focus-visible,
.pa-color-preview-btn:focus-visible,
.pa-anchor-pill:focus-visible,
.pa-modal-close:focus-visible,
.pa-shortcut-record-btn:focus-visible,
.pa-action-btn:focus-visible {
  outline: 2px solid #38bdf8;
  outline-offset: 2px;
}

.pa-color-swatch:focus-visible {
  outline: 2px solid #ffffff;
  outline-offset: 2px;
}

.pa-slider:focus-visible {
  outline: 2px solid #38bdf8;
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

/* Respect Reduced Motion Preferences (WCAG 2.3.3) */
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

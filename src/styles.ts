// src/styles.ts

// Theme-aware styles for the file manager panel.
// DSH applies dark palette through body[data-ds-dark-theme].
export const CSS_STRING = `
:root {
  --fm-surface: var(--dsw-alias-bg-base, #f6f7fb);
  --fm-surface-muted: var(--dsw-specific-sidebar-fill, var(--dsw-alias-bg-base, #f6f7fb));
  --fm-surface-elevated: var(--dsw-alias-bg-layer-1, var(--dsw-alias-bg-base, #ffffff));
  --fm-border: var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.24));
  --fm-border-strong: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2, rgba(127, 127, 127, 0.3)));
  --fm-hover: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.12));
  --fm-shadow: 6px 0 24px rgba(15, 23, 42, 0.08);
  --fm-tree-file-ring: rgba(255, 255, 255, 0.7);
  --fm-file-default: #8b919c;
  --fm-file-code: #6f86a8;
  --fm-file-data: #7e8b75;
  --fm-file-doc: #8b7c72;
  --fm-file-image: #84789a;
  --fm-file-special: #9a806a;
  --fm-git-changed: #d59b47;
  --fm-git-untracked: #5ea7c9;
  --fm-git-ignored: #8b819e;
  --fm-git-ignored-text: color-mix(in srgb, var(--dsw-alias-label-secondary) 55%, var(--fm-git-ignored) 45%);
}

body[data-ds-dark-theme] {
  --fm-surface: #1a1c20;
  --fm-surface-muted: #202329;
  --fm-surface-elevated: #16181c;
  --fm-border: rgba(255, 255, 255, 0.09);
  --fm-border-strong: rgba(255, 255, 255, 0.13);
  --fm-hover: rgba(255, 255, 255, 0.045);
  --fm-shadow: 10px 0 30px rgba(0, 0, 0, 0.34);
  --fm-tree-file-ring: rgba(255, 255, 255, 0.12);
  --fm-file-default: #9096a0;
  --fm-file-code: #7e8ea7;
  --fm-file-data: #87907b;
  --fm-file-doc: #958378;
  --fm-file-image: #8d82a2;
  --fm-file-special: #aa8d73;
  --fm-git-changed: #e0aa58;
  --fm-git-untracked: #6ab8db;
  --fm-git-ignored: #9b90ae;
  --fm-git-ignored-text: color-mix(in srgb, var(--dsw-alias-label-secondary) 58%, var(--fm-git-ignored) 42%);
}

/* Toggle tab */
.fm-toggle {
  position: fixed;
  z-index: 100;
  width: 24px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--fm-surface-elevated);
  border: 1px solid var(--fm-border-strong);
  border-left: none;
  border-radius: 0 10px 10px 0;
  box-shadow: var(--fm-shadow);
  cursor: pointer;
  pointer-events: auto;
  transition: left 0.2s ease, background 0.15s, color 0.15s, box-shadow 0.15s;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.fm-toggle:hover {
  background: var(--fm-hover);
  color: var(--dsw-alias-label-primary);
}

/* Clip host sits only in the content column (right of sidebar).
   The drawer slides inside it, so translateX(-100%) is clipped and
   never paints over the left sidebar. */
.fm-panel-clip {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 300px;
  z-index: 99;
  overflow: hidden;
  pointer-events: none;
}
.fm-panel-clip.fm-panel-clip--open {
  pointer-events: auto;
}

/* Panel drawer (animates inside the clip host) */
.fm-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 300px;
  display: flex;
  flex-direction: column;
  background: linear-gradient(180deg, var(--fm-surface-elevated) 0%, var(--fm-surface) 100%);
  border-right: 1px solid var(--fm-border-strong);
  box-shadow: var(--fm-shadow);
  transform: translateX(-100%);
  transition: transform 0.2s ease;
  pointer-events: none;
}
.fm-panel::after {
  content: "";
  position: absolute;
  inset: 0;
  border-right: 1px solid var(--fm-border);
  box-shadow: inset -1px 0 0 rgba(255, 255, 255, 0.03);
  pointer-events: none;
}
.fm-panel.fm-panel--open {
  transform: translateX(0);
  pointer-events: auto;
}

/* Panel header */
.fm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--fm-border);
  background: var(--fm-surface-muted);
  flex-shrink: 0;
}
.fm-header-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.fm-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 14px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.fm-header-btn:hover {
  background: var(--fm-hover);
  border-color: var(--fm-border);
  color: var(--dsw-alias-label-primary);
}

/* Tree container */
.fm-tree {
  flex: 1;
  overflow: auto;
  padding: 10px 8px 12px;
  background: transparent;
}

/* Tree row */
.fm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: default;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.fm-row--dir {
  cursor: pointer;
}
.fm-row--dir:hover {
  background: var(--fm-hover);
  border-color: var(--fm-border);
  color: var(--dsw-alias-label-primary);
}
.fm-row-chevron {
  width: 16px;
  text-align: center;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
}
.fm-file-icon {
  position: relative;
  width: 11px;
  height: 13px;
  flex-shrink: 0;
  border: 1px solid var(--fm-border-strong);
  border-radius: 3px;
  background: color-mix(in srgb, var(--fm-surface-muted) 82%, white 18%);
  box-shadow: 0 0 0 1px var(--fm-tree-file-ring);
  color: var(--fm-file-default);
}
.fm-file-icon::before {
  content: "";
  position: absolute;
  left: 2px;
  right: 2px;
  top: 4px;
  height: 1px;
  background: currentColor;
  opacity: 0.65;
  box-shadow: 0 3px 0 color-mix(in srgb, currentColor 72%, transparent);
}
.fm-file-icon::after {
  content: "";
  position: absolute;
  left: -1px;
  top: -1px;
  bottom: -1px;
  width: 2px;
  border-radius: 3px 0 0 3px;
  background: currentColor;
  opacity: 0.9;
}
.fm-file-icon-fold {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 5px;
  height: 5px;
  background: linear-gradient(135deg, transparent 49%, var(--fm-border-strong) 50%, var(--fm-border-strong) 100%);
  border-top-right-radius: 3px;
}
.fm-file-icon--code {
  color: var(--fm-file-code);
}
.fm-file-icon--data {
  color: var(--fm-file-data);
}
.fm-file-icon--doc {
  color: var(--fm-file-doc);
}
.fm-file-icon--image {
  color: var(--fm-file-image);
}
.fm-file-icon--special {
  color: var(--fm-file-special);
}
.fm-file-icon--default {
  color: var(--fm-file-default);
}
.fm-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fm-row--ignored {
  color: var(--fm-git-ignored-text);
  opacity: 0.82;
}
.fm-row--ignored .fm-row-chevron {
  color: color-mix(in srgb, var(--fm-git-ignored-text) 72%, transparent);
}
.fm-git-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0.02em;
  border: 1px solid color-mix(in srgb, currentColor 28%, transparent);
  background: color-mix(in srgb, currentColor 16%, transparent);
}
.fm-git-badge--changed {
  color: var(--fm-git-changed);
}
.fm-git-badge--untracked {
  color: var(--fm-git-untracked);
}
.fm-git-badge--ignored {
  color: var(--fm-git-ignored);
}
.fm-git-badge--dir {
  min-width: 12px;
  width: 12px;
  height: 12px;
  padding: 0;
  font-size: 12px;
  border-radius: 999px;
}
.fm-row-children {
  margin-left: 16px;
}

/* States */
.fm-loading, .fm-error, .fm-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--dsw-alias-label-tertiary);
}
.fm-error {
  color: var(--dsw-alias-state-error-primary);
}
.fm-error button {
  margin-top: 8px;
  padding: 4px 12px;
  border: 1px solid var(--fm-border);
  border-radius: 6px;
  background: var(--fm-surface-muted);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.fm-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--dsw-alias-border-l2);
  border-top-color: var(--dsw-alias-brand-primary);
  border-radius: 50%;
  animation: fm-spin 0.8s linear infinite;
}
@keyframes fm-spin {
  to { transform: rotate(360deg); }
}

/* Scrollbar */
.fm-tree::-webkit-scrollbar {
  width: 8px;
}
.fm-tree::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-scrollbar-bg-l2);
  border-radius: 4px;
}

/* Preview dock (right of tree panel, draggable) */
.fm-preview-window {
  position: fixed;
  top: 12px;
  right: 12px;
  z-index: 2147483647;
  box-sizing: border-box;
  width: 700px;
  max-width: calc(100vw - 340px); /* account for panel + margin */
  height: 70vh;
  max-height: calc(100vh - 24px);
  border: 1px solid var(--fm-border-strong);
  border-radius: 10px;
  background: var(--fm-surface-elevated);
  box-shadow: 0 20px 40px rgba(15,23,42,0.3);
  display: flex;
  flex-direction: column;
  resize: both;
  overflow: hidden;
  pointer-events: auto;
}
.fm-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--fm-border);
  background: var(--fm-surface-muted);
  cursor: move;
  user-select: none;
  touch-action: none;
}
.fm-preview-toggle {
  display: inline-flex;
  flex-shrink: 0;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--fm-border);
  border-radius: 7px;
  background: var(--fm-surface-elevated);
}
.fm-preview-toggle button {
  padding: 4px 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 11px;
}
.fm-preview-toggle button:hover,
.fm-preview-toggle button.is-active {
  background: var(--fm-hover);
  color: var(--dsw-alias-label-primary);
}
.fm-preview-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsw-alias-label-primary);
}
.fm-preview-close {
  width: 28px;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 14px;
}
.fm-preview-close:hover {
  background: var(--fm-hover);
  border-color: var(--fm-border);
  color: var(--dsw-alias-label-primary);
}
.fm-preview-body {
  flex: 1;
  overflow: auto;
  padding: 12px;
}
.fm-markdown-content {
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.fm-markdown-content h1, .fm-markdown-content h2, .fm-markdown-content h3,
.fm-markdown-content h4, .fm-markdown-content h5, .fm-markdown-content h6 {
  margin: 0.8em 0 0.4em;
  line-height: 1.25;
}
.fm-markdown-content h1:first-child, .fm-markdown-content h2:first-child { margin-top: 0; }
.fm-markdown-content p, .fm-markdown-content ul, .fm-markdown-content ol, .fm-markdown-content blockquote { margin: 0.7em 0; }
.fm-markdown-content a { color: var(--dsw-alias-brand-primary); }
.fm-markdown-content img { max-width: 100%; height: auto; border-radius: 6px; }
.fm-markdown-content pre { overflow: auto; padding: 10px; border: 1px solid var(--fm-border); border-radius: 6px; background: var(--fm-surface-muted); }
.fm-markdown-content code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
.fm-markdown-content :not(pre) > code { padding: 2px 4px; border-radius: 4px; background: var(--fm-hover); }
.fm-markdown-content blockquote { padding-left: 10px; border-left: 3px solid var(--fm-border-strong); color: var(--dsw-alias-label-secondary); }
.fm-preview-warning, .fm-preview-render-error {
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid var(--fm-border);
  border-radius: 6px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.fm-preview-render-error { color: var(--dsw-alias-state-error-primary); }

/* Changed-preview confirmation banner (both themes via DSH alias tokens) */
.fm-preview-changed {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--fm-border);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-secondary, var(--fm-surface-muted)) 40%, var(--fm-surface-muted));
  flex-shrink: 0;
}
.fm-preview-changed-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 600;
  color: var(--dsw-alias-state-warn-label, var(--dsw-alias-label-primary));
}
.fm-preview-changed-actions {
  display: inline-flex;
  flex-shrink: 0;
  gap: 6px;
}
.fm-preview-changed-btn {
  padding: 4px 10px;
  border: 1px solid var(--fm-border);
  border-radius: 6px;
  background: var(--fm-surface-elevated);
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 11px;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.fm-preview-changed-btn:hover {
  background: var(--fm-hover);
  border-color: var(--fm-border-strong);
  color: var(--dsw-alias-label-primary);
}
.fm-preview-changed-btn--primary {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary-invert);
}
.fm-preview-changed-btn--primary:hover {
  border-color: transparent;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary) 85%, black);
}

.fm-modal-pre--highlighted .hljs-comment,
.fm-modal-pre--highlighted .hljs-quote {
  color: var(--dsw-alias-label-tertiary);
}
.fm-modal-pre--highlighted .hljs-keyword,
.fm-modal-pre--highlighted .hljs-selector-tag,
.fm-modal-pre--highlighted .hljs-literal {
  color: var(--dsw-alias-brand-primary);
}
.fm-modal-pre--highlighted .hljs-type,
.fm-modal-pre--highlighted .hljs-built_in {
  color: var(--fm-file-data);
}
.fm-modal-pre--highlighted .hljs-string,
.fm-modal-pre--highlighted .hljs-regexp,
.fm-modal-pre--highlighted .hljs-attr {
  color: var(--fm-git-untracked);
}
.fm-modal-pre--highlighted .hljs-number,
.fm-modal-pre--highlighted .hljs-symbol {
  color: var(--fm-file-image);
}
.fm-modal-pre--highlighted .hljs-title,
.fm-modal-pre--highlighted .hljs-name,
.fm-modal-pre--highlighted .hljs-function {
  color: var(--fm-file-code);
}
.fm-modal-pre--highlighted .hljs-params,
.fm-modal-pre--highlighted .hljs-property {
  color: var(--dsw-alias-label-secondary);
}
.fm-modal-pre--highlighted .hljs-punctuation {
  color: var(--dsw-alias-label-tertiary);
}
.fm-modal-pre--highlighted .hljs-operator {
  color: var(--fm-git-changed);
}
.fm-modal-pre--highlighted .hljs-meta,
.fm-modal-pre--highlighted .hljs-doctag {
  color: var(--fm-file-doc);
}
.fm-modal-pre--highlighted .hljs-variable {
  color: var(--fm-file-special);
}

/* Drop hint on the DSH composer card while a tree row is dragged over it. */
[data-composer-card].fm-drop-hint {
  outline: 2px dashed var(--dsw-alias-border-l3, rgba(127, 127, 127, 0.45));
  outline-offset: 2px;
  border-radius: 10px;
}

`;
// src/styles.ts

// All styles use DSH theme tokens (--dsw-*) for automatic dark/light support
export const CSS_STRING = `
/* Toggle tab */
.fm-toggle {
  position: fixed;
  z-index: 100;
  width: 24px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-overlay);
  border: 1px solid var(--dsw-alias-border-l2);
  border-left: none;
  border-radius: 0 8px 8px 0;
  cursor: pointer;
  pointer-events: auto;
  transition: left 0.2s ease, background 0.15s;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
}
.fm-toggle:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* Panel */
.fm-panel {
  position: fixed;
  top: 0;
  bottom: 0;
  width: 300px;
  z-index: 99;
  display: flex;
  flex-direction: column;
  background: var(--dsw-alias-bg-overlay);
  border-right: 1px solid var(--dsw-alias-border-l2);
  box-shadow: 4px 0 16px rgba(0,0,0,0.15);
  transform: translateX(-100%);
  transition: transform 0.2s ease;
  pointer-events: auto;
}
.fm-panel.fm-panel--open {
  transform: translateX(0);
}

/* Panel header */
.fm-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  flex-shrink: 0;
}
.fm-header-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.fm-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font-size: 14px;
}
.fm-header-btn:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}

/* Tree container */
.fm-tree {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

/* Tree row */
.fm-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: default;
  font-size: 13px;
  color: var(--dsw-alias-label-secondary);
  white-space: nowrap;
}
.fm-row--dir {
  cursor: pointer;
}
.fm-row--dir:hover {
  background: var(--dsw-alias-interactive-bg-hover);
}
.fm-row-chevron {
  width: 16px;
  text-align: center;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
}
.fm-row-icon {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.fm-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
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
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: transparent;
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
`;

# dsh-filemanager

Workspace file tree panel for DeepSeek Harness Web GUI.

A toggle tab at the sidebar edge opens a panel showing the directory tree of the current session's workspace. Clicking a file opens a dock panel on the right (above the chat) with its text content.

## Features

- Toggle tab tracks sidebar width (ResizeObserver)
- Lazy directory loading on expand
- Refresh button reloads entire tree
- Filters `node_modules` and `.git`; shows dotfiles
- Uses DSH theme tokens (auto dark/light)
- Git status badges for files and directories
- File preview:
  - Click a file → dock panel on the right, on top of the chat
  - Header with file name and close (✕); drag by header to move the panel; resizable; scrollable body
  - Text files only; content truncated at 5 MB with a truncation notice
  - Panel position and size are remembered per workspace (localStorage)

## Server API

- `GET /filemanager-fs/root?hint=<workspace>` — workspace root
- `GET /filemanager-fs/list?hint=<workspace>&path=<rel>` — directory listing with git status
- `GET /filemanager-fs/read?hint=<workspace>&path=<rel>` — text file content (up to 5 MB; `truncated: true` when cut)

All requests require the `x-dsh-filemanager: 1` header.

## Documentation

Behavioral source of truth lives in `docs/canon/` (doc-canon).

## Installation

1. Build the plugin:
   ```bash
   npm install
   npm run build
   ```

2. Add to DSH web profile:
   ```bash
   dsh plugin --profile web add /path/to/dsh-filemanager-plugin
   ```

3. Add to `~/.dsh/profiles/web/cordis.patch.yml`:
   ```yaml
   - insert:
       - id: filemanager
         name: 'dsh-filemanager'
   ```

4. Restart `dsh web` and refresh the browser.

# dsh-filemanager

Workspace file tree panel for DeepSeek Harness Web GUI.

A toggle tab at the sidebar edge opens a panel showing the directory tree of the current session's workspace. View-only: click on a file does nothing.

## Features

- Toggle tab tracks sidebar width (ResizeObserver)
- Lazy directory loading on expand
- Refresh button reloads entire tree
- Filters `node_modules` and `.git`; shows dotfiles
- Uses DSH theme tokens (auto dark/light)

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

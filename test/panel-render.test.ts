// test/panel-render.test.ts
// jsdom render tests for Panel.tsx. These guard the Panel decomposition
// (package 3): open/close, directory expansion, file preview open, and the
// context-menu delete flow must keep working as Panel's internals are moved
// into hooks/components. node:test + tsx, no jest globals: we install jsdom
// globals ourselves and drive React through @testing-library/react.
import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { JSDOM } from "jsdom";

// --- jsdom environment (must be installed before any React render) ---
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
const g = globalThis as Record<string, unknown> & {
  window: Window & typeof globalThis;
  document: Document;
};
g.window = dom.window as unknown as Window & typeof globalThis;
g.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.PointerEvent = dom.window.PointerEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.localStorage = dom.window.localStorage;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 0);
g.cancelAnimationFrame = (id: number) => clearTimeout(id);
g.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};
g.IS_REACT_ACT_ENVIRONMENT = true;

// Fetch router: returns canned JSON per endpoint. The SSE events endpoint gets
// an open stream (held by a controller) so the coordinator sees a live
// connection; abort (panel close / unmount) cancels it.
const SSE_HOLD: { abort: (() => void) | null } = { abort: null };
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
const FILES: Record<string, unknown> = {
  "": {
    root: "/workspace",
    name: "workspace",
    entries: [
      { name: "src", kind: "dir" },
      { name: "README.md", kind: "file" },
      { name: "main.ts", kind: "file" },
    ],
  },
  src: {
    entries: [{ name: "Panel.tsx", kind: "file" }],
  },
};
const fileContent = (path: string): unknown => ({
  name: path.split("/").pop() ?? path,
  path,
  content: `// ${path}\nconsole.log("hi");`,
  truncated: false,
});
g.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = String(input);
  if (url.includes("/filemanager-fs/root")) {
    return jsonResponse({ root: "/workspace", name: "workspace" });
  }
  if (url.includes("/filemanager-fs/list")) {
    const u = new URL(url, "http://localhost");
    const path = u.searchParams.get("path") ?? "";
    const bucket = (FILES as Record<string, { entries?: unknown }>)[path];
    return jsonResponse({ entries: bucket?.entries ?? [], truncated: false });
  }
  if (url.includes("/filemanager-fs/read")) {
    const u = new URL(url, "http://localhost");
    return jsonResponse(fileContent(u.searchParams.get("path") ?? ""));
  }
  if (url.includes("/filemanager-fs/delete-info")) {
    const u = new URL(url, "http://localhost");
    return jsonResponse({
      kind: "file",
      name: u.searchParams.get("path")?.split("/").pop() ?? "",
      path: u.searchParams.get("path") ?? "",
      isRoot: false,
      uncommitted: false,
    });
  }
  if (url.includes("/filemanager-fs/delete")) {
    return jsonResponse({ deleted: true, path: "" });
  }
  if (url.includes("/filemanager-fs/events")) {
    let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
      cancel() { controller = null; },
    });
    SSE_HOLD.abort = () => { try { controller?.close(); } catch {} };
    if (init?.signal) {
      init.signal.addEventListener("abort", () => SSE_HOLD.abort?.());
    }
    return new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });
  }
  throw new Error("unmocked fetch: " + url);
}) as typeof fetch;

// Import React testing lib + Panel AFTER globals are installed.
import React from "react";
const { render, screen, fireEvent, waitFor, cleanup, within } = await import("@testing-library/react");
const { Panel } = await import("../src/Panel.tsx");
const { createStore } = await import("../src/store.js");

after(() => {
  cleanup();
  SSE_HOLD.abort?.();
  dom.window.close();
});

const panelProps = () => ({
  open: true,
  sidebarLeft: 0,
  hint: "/workspace",
  onClose: () => {},
  store: createStore(),
});

const panelEl = (props: ReturnType<typeof panelProps>) =>
  React.createElement(Panel, props);

describe("Panel render", () => {
  it("shows root files after loading", async () => {
    render(panelEl(panelProps()));
    await waitFor(() => assert.ok(screen.getByText("README.md")));
    assert.ok(screen.getByText("src"));
    assert.ok(screen.getByText("main.ts"));
    cleanup();
  });

  it("expands a folder and lists its children", async () => {
    render(panelEl(panelProps()));
    await waitFor(() => assert.ok(screen.getByText("src")));
    fireEvent.click(screen.getByText("src"));
    await waitFor(() => assert.ok(screen.getByText("Panel.tsx")));
    cleanup();
  });

  it("opens the preview dock on file click and closes on Escape", async () => {
    render(panelEl(panelProps()));
    await waitFor(() => assert.ok(screen.getByText("README.md")));
    fireEvent.click(screen.getByText("README.md"));
    const dialog = await screen.findByRole("dialog");
    assert.ok(within(dialog).getByText("README.md"));
    // Esc closes the preview dialog
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
    cleanup();
  });

  it("runs the context-menu delete flow: preflight then confirm", async () => {
    let deleted: string | null = null;
    const originalFetch = g.fetch as typeof fetch;
    g.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await originalFetch(input, init);
      const url = String(input);
      if (url.includes("/filemanager-fs/delete")) deleted = "called";
      return res;
    }) as typeof fetch;

    render(panelEl(panelProps()));
    await waitFor(() => assert.ok(screen.getByText("main.ts")));
    // open context menu on the file row
    const row = screen.getByText("main.ts").closest('[role="treeitem"]');
    assert.ok(row);
    fireEvent.contextMenu(row as Element);
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByText(/Delete/));
    const alertdialog = await screen.findByRole("alertdialog");
    assert.ok(within(alertdialog).getByText("Delete main.ts?"));
    fireEvent.click(within(alertdialog).getByText("Delete"));
    await waitFor(() => assert.equal(deleted, "called"));
    g.fetch = originalFetch;
    cleanup();
  });

  it("re-expanding a collapsed folder shows files added while collapsed", async () => {
    // Clear persisted expansion state: an earlier test expanded "src" and the
    // store persists expanded paths per workspace in localStorage, which would
    // make this test's first click a collapse instead of an expand.
    try {
      localStorage.removeItem("dsh-filemanager-expanded:/workspace");
      localStorage.removeItem("dsh-filemanager-open");
    } catch {}
    const bucket = FILES as Record<string, { entries?: unknown }>;
    bucket.src = { entries: [{ name: "Panel.tsx", kind: "file" }] };
    render(panelEl(panelProps()));
    await waitFor(() => assert.ok(screen.getByText("src")));
    // expand src
    fireEvent.click(screen.getByText("src"));
    await waitFor(() => assert.ok(screen.getByText("Panel.tsx")));
    // collapse src (its watcher is dropped; children cached)
    fireEvent.click(screen.getByText("src"));
    await waitFor(() => assert.equal(screen.queryByText("Panel.tsx"), null));
    // a file is added on disk while src is collapsed
    bucket.src = {
      entries: [
        { name: "Panel.tsx", kind: "file" },
        { name: "NewFile.tsx", kind: "file" },
      ],
    };
    // re-expand: the tree must refetch, not serve the stale cached listing
    fireEvent.click(screen.getByText("src"));
    await waitFor(() => assert.ok(screen.getByText("NewFile.tsx")));
    cleanup();
  });
});

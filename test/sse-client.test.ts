// test/sse-client.test.ts
// Fetch-based SSE client (src/sse-client.ts): the events endpoint requires the
// x-dsh-filemanager header, which the native EventSource cannot send, so the
// client streams the SSE framing through fetch instead and mirrors the minimal
// EventSource surface the live-refresh coordinator consumes.
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createSseEventSource } from "../src/sse-client.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn: () => boolean, timeoutMs = 1500, intervalMs = 5): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await delay(intervalMs);
  }
}

const encoder = new TextEncoder();
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function stubFetch(impl: (url: string, init: RequestInit) => Response | Promise<Response>): void {
  globalThis.fetch = (async (input: unknown, init?: unknown) =>
    impl(String(input), (init ?? {}) as RequestInit)) as typeof fetch;
}

/** An SSE response whose stream stays open until the test closes it. */
function openSseStream(): {
  response: Response;
  push(chunk: string): void;
  end(): void;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const response = new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
  return {
    response,
    push(chunk: string) {
      controller.enqueue(encoder.encode(chunk));
    },
    end() {
      controller.close();
    },
  };
}

interface Recorded {
  events: Array<{ type: string; data?: string }>;
}

function makeRecorder(source: ReturnType<typeof createSseEventSource>): Recorded {
  const rec: Recorded = { events: [] };
  source.addEventListener("open", () => rec.events.push({ type: "open" }));
  source.addEventListener("changed", (event: any) =>
    rec.events.push({ type: "changed", data: String(event?.data ?? "") })
  );
  source.addEventListener("error", () => rec.events.push({ type: "error" }));
  return rec;
}

const URL = "/filemanager-fs/events?hint=/ws&paths=%5B%22%22%5D";

describe("createSseEventSource", () => {
  it("sends the x-dsh-filemanager security header on the fetch", async () => {
    let captured: RequestInit | null = null;
    stubFetch(async (_url, init) => {
      captured = init;
      return openSseStream().response;
    });
    const source = createSseEventSource(URL);
    const rec = makeRecorder(source);
    await waitFor(() => rec.events.some((e) => e.type === "open" || e.type === "error"));
    source.close();
    assert.ok(captured, "fetch must be called");
    assert.deepStrictEqual(captured.headers, { "x-dsh-filemanager": "1" });
  });

  it("fires open then dispatches parsed changed events", async () => {
    const sse = openSseStream();
    stubFetch(async () => sse.response);
    const source = createSseEventSource(URL);
    const rec = makeRecorder(source);
    await waitFor(() => rec.events.some((e) => e.type === "open"));
    sse.push(
      'event: changed\ndata: {"type":"changed","path":"src/Panel.tsx","kind":"change"}\n\n'
    );
    await waitFor(() => rec.events.some((e) => e.type === "changed"));
    source.close();
    assert.deepStrictEqual(
      rec.events.map((e) => e.type),
      ["open", "changed"]
    );
    assert.strictEqual(
      rec.events.find((e) => e.type === "changed")?.data,
      '{"type":"changed","path":"src/Panel.tsx","kind":"change"}'
    );
  });

  it("buffers a block split across chunk boundaries", async () => {
    const sse = openSseStream();
    stubFetch(async () => sse.response);
    const source = createSseEventSource(URL);
    const rec = makeRecorder(source);
    await waitFor(() => rec.events.some((e) => e.type === "open"));
    sse.push('event: changed\ndata: {"type":"changed","path":"src/Panel.t');
    sse.push('sx","kind":"change"}\n\n');
    await waitFor(() => rec.events.some((e) => e.type === "changed"));
    source.close();
    assert.strictEqual(
      rec.events.find((e) => e.type === "changed")?.data,
      '{"type":"changed","path":"src/Panel.tsx","kind":"change"}'
    );
  });

  it("dispatches multiple events from one chunk", async () => {
    const sse = openSseStream();
    stubFetch(async () => sse.response);
    const source = createSseEventSource(URL);
    const rec = makeRecorder(source);
    await waitFor(() => rec.events.some((e) => e.type === "open"));
    sse.push(
      'event: changed\ndata: {"type":"changed","path":"a","kind":"change"}\n\n' +
        'event: changed\ndata: {"type":"changed","path":"b","kind":"rename"}\n\n'
    );
    await waitFor(() => rec.events.filter((e) => e.type === "changed").length >= 2);
    source.close();
    assert.deepStrictEqual(
      rec.events.filter((e) => e.type === "changed").map((e) => e.data),
      [
        '{"type":"changed","path":"a","kind":"change"}',
        '{"type":"changed","path":"b","kind":"rename"}',
      ]
    );
  });

  it("fires error on a rejected response without opening", async () => {
    stubFetch(async () =>
      new Response(JSON.stringify({ error: "missing x-dsh-filemanager header" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      })
    );
    const source = createSseEventSource(URL);
    const rec = makeRecorder(source);
    await waitFor(() => rec.events.some((e) => e.type === "error"));
    source.close();
    assert.deepStrictEqual(rec.events, [{ type: "error" }]);
  });

  it("fires error on a non-event-stream content type", async () => {
    stubFetch(async () => new Response("ok", { status: 200, headers: { "content-type": "text/plain" } }));
    const source = createSseEventSource(URL);
    const rec = makeRecorder(source);
    await waitFor(() => rec.events.some((e) => e.type === "error"));
    source.close();
    assert.deepStrictEqual(rec.events, [{ type: "error" }]);
  });

  it("fires error when the server closes the stream unexpectedly", async () => {
    const sse = openSseStream();
    stubFetch(async () => sse.response);
    const source = createSseEventSource(URL);
    const rec = makeRecorder(source);
    await waitFor(() => rec.events.some((e) => e.type === "open"));
    sse.push('event: changed\ndata: {"type":"changed","path":"x","kind":"change"}\n\n');
    await waitFor(() => rec.events.some((e) => e.type === "changed"));
    sse.end();
    await waitFor(() => rec.events.some((e) => e.type === "error"));
    assert.deepStrictEqual(
      rec.events.map((e) => e.type),
      ["open", "changed", "error"]
    );
  });

  it("close() aborts the connection and suppresses further events", async () => {
    const sse = openSseStream();
    let signal: AbortSignal | null = null;
    stubFetch(async (_url, init) => {
      signal = (init.signal ?? null) as AbortSignal | null;
      return sse.response;
    });
    const source = createSseEventSource(URL);
    const rec = makeRecorder(source);
    await waitFor(() => rec.events.some((e) => e.type === "open"));
    source.close();
    assert.ok(signal, "fetch must receive an abort signal");
    assert.strictEqual(signal?.aborted, true);
    await delay(20);
    assert.deepStrictEqual(rec.events.map((e) => e.type), ["open"]);
  });
});

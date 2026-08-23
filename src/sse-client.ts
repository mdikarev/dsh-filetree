// src/sse-client.ts
// Fetch-based Server-Sent Events client for the events endpoint. The native
// EventSource cannot attach the x-dsh-filemanager security header the endpoint
// requires, so a plain EventSource is always rejected with 403 and the tree
// silently degrades to the polling fallback. This client streams the same
// "event:" / "data:" framing through fetch (which CAN set the header) and
// mirrors the minimal EventSource surface the live-refresh coordinator
// consumes: "open", named events ("changed"), and "error". Reconnection and
// backoff stay owned by the coordinator; a stream that ends without an
// explicit close() is reported as an error so the coordinator reconnects.
import type { LiveEventSource } from "./live-refresh.js";

const SECURITY_HEADER = { "x-dsh-filemanager": "1" };

/** True when the response is a 200 with an event-stream content type. */
function isEventStreamResponse(res: Response): boolean {
  return res.ok && (res.headers.get("content-type") ?? "").includes("text/event-stream");
}

/**
 * Create an SSE connection that sends the required security header. Returns
 * immediately; connection happens asynchronously. Events dispatched:
 * - "open" once the response is accepted (200 + text/event-stream)
 * - the SSE event name for each parsed block (the events endpoint sends
 *   "changed"), with event.data holding the raw "data:" line
 * - "error" exactly once for a rejected response, a failed fetch, an
 *   unexpected stream end, or a read failure. close() suppresses everything.
 */
export function createSseEventSource(url: string): LiveEventSource {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const controller = new AbortController();
  let closed = false;
  let errored = false;

  const dispatch = (type: string, event?: any): void => {
    const set = listeners.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(event ?? { type });
      } catch {
        // A listener error must not break the stream.
      }
    }
  };

  const fail = (): void => {
    if (closed || errored) return;
    errored = true;
    dispatch("error");
  };

  const run = async (): Promise<void> => {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: SECURITY_HEADER,
        cache: "no-store",
        signal: controller.signal,
      });
    } catch {
      fail();
      return;
    }
    if (closed) return;

    if (!isEventStreamResponse(res)) {
      fail();
      return;
    }
    if (closed) return;
    dispatch("open");

    const body = res.body;
    if (!body) {
      fail();
      return;
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventName = "message";
    let dataLines: string[] = [];

    const finishBlock = (): void => {
      if (dataLines.length > 0) {
        const data = dataLines.join("\n");
        dispatch(eventName, { type: eventName, data });
      }
      eventName = "message";
      dataLines = [];
    };

    const handleLine = (line: string): void => {
      if (line === "") {
        finishBlock();
        return;
      }
      if (line.startsWith(":")) return; // comment line
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") {
        eventName = value;
      } else if (field === "data") {
        dataLines.push(value);
      }
      // id:/retry: lines are ignored: reconnection is owned by the coordinator.
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let match = buffer.match(/\r?\n\r?\n/);
        while (match !== null && match.index !== undefined) {
          const block = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          for (const line of block.split(/\r?\n/)) handleLine(line);
          finishBlock();
          match = buffer.match(/\r?\n\r?\n/);
        }
      }
      // Trailing data without a terminating blank line is discarded, matching
      // the native EventSource behavior (an event dispatches only on a blank
      // line); the server always terminates its blocks.
    } catch {
      fail();
      return;
    }
    if (!closed) fail(); // stream ended without an explicit close
  };

  // Kick off the connection; it never blocks the caller.
  void run();

  return {
    addEventListener(type: string, handler: (event: any) => void): void {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
    },
    close(): void {
      if (closed) return;
      closed = true;
      controller.abort();
    },
  };
}

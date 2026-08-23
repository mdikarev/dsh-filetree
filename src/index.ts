import { createHandler } from "./fs-api.js";
import { resolve } from "node:path";

const ROUTE_PREFIX = "/filemanager-fs";

function resolveDefaultRoot(): string {
  return resolve(process.env.DSH_WORKSPACE ?? process.cwd());
}

export function apply(ctx: any): void {
  ctx.inject(["webServer"], (httpCtx: any) => {
    httpCtx.effect(
      () =>
        httpCtx.webServer.register({
          kind: "prefix",
          path: ROUTE_PREFIX,
          // Dispatches root/list/read and the additive SSE events action
          // (GET /filemanager-fs/events, implemented in src/fs-events.ts).
          handler: createHandler(resolveDefaultRoot()),
        }),
      "dsh-filemanager: /filemanager-fs file tree API"
    );
  });
}

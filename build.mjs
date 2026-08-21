import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));

// Host build: Node ESM
await build({
  entryPoints: ["src/index.ts"],
  outfile: "lib/index.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  external: Object.keys(pkg.peerDependencies ?? {}),
});

// Client build: Browser bundle wrapped for DSH ModuleLoader
const clientResult = await build({
  entryPoints: ["src/client.tsx"],
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "es2020",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime"],
  write: false,
});

const clientCode = clientResult.outputFiles[0].text;
const wrappedClient = `window.__ModuleLoader__.load({
  id: "dsh-filemanager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
${clientCode}
    return module.exports;
  }
});`;

await import("node:fs/promises").then((fs) =>
  fs.writeFile("lib/client.js", wrappedClient)
);

console.log("Build complete: lib/index.js, lib/client.js");

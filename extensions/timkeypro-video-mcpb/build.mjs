// Build the extension folder that `mcpb pack` zips:
//   server/index.mjs + server/lib/*.mjs  bundled server (esbuild), every file under MAX_FILE bytes
//   server/run-script.mjs               wrapper that runs the skill scripts unchanged
//   server/scripts/*.mjs                measure-style.mjs and apply-style.mjs, copied from the skill
//   icon.png                            copied from the web app
// It also writes version, tools and the prompt text into manifest.json from src/.
//
// Why the size cap: Claude Desktop 1.12603.x hangs without any error when it unzips a large deflated
// file from a .mcpb (anthropics/claude-code#67865, #68734). pack.mjs stores entries uncompressed,
// which avoids the hang; keeping every file small is the second guard.
import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT_ARGUMENTS, PROMPT_DESCRIPTION, PROMPT_NAME, PROMPT_TEMPLATE } from "./src/prompt.mjs";
import { TOOLS } from "./src/tools.mjs";

export const MAX_FILE = 100_000;
const here = dirname(fileURLToPath(import.meta.url));
const skill = join(here, "..", "..", "plugins", "timkeypro-video", "skills", "clone-edit-style", "scripts");
const icon = join(here, "..", "..", "..", "public", "logo-512.png");
const out = join(here, "server");
const pkg = JSON.parse(readFileSync(join(here, "package.json"), "utf8"));

async function bundle(extraEntries) {
  const entryPoints = { index: join(here, "src", "server.mjs") };
  extraEntries.forEach((p, i) => (entryPoints[`lib/part-${i + 1}`] = p));
  rmSync(out, { recursive: true, force: true });
  return esbuild.build({
    entryPoints,
    outdir: out,
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "node",
    target: "node18",
    minify: true,
    legalComments: "none",
    outExtension: { ".js": ".mjs" },
    chunkNames: "lib/chunk-[hash]",
    define: { __VERSION__: JSON.stringify(pkg.version) },
    metafile: true,
    logLevel: "warning",
  });
}

// esbuild splits shared code into chunks by which entry points reach it. Each round, the biggest module
// of every chunk that is over the cap becomes an extra entry point, which carves its subgraph out of
// that chunk. Repeat until every file fits.
const extra = [];
let result;
for (let round = 0; ; round++) {
  result = await bundle(extra);
  const over = Object.entries(result.metafile.outputs).filter(([, o]) => o.bytes > MAX_FILE * 0.9);
  if (!over.length) break;
  if (round > 40) throw new Error(`cannot split under ${MAX_FILE} bytes: ${over.map(([f, o]) => `${f} ${o.bytes}`).join(", ")}`);
  for (const [file, o] of over) {
    const biggest = Object.entries(o.inputs)
      .filter(([p]) => !extra.includes(join(here, p)) && !p.startsWith("src/"))
      .sort((a, b) => b[1].bytesInOutput - a[1].bytesInOutput)[0];
    if (!biggest) throw new Error(`${file} is ${o.bytes} bytes and has no module left to split out`);
    extra.push(join(here, biggest[0]));
  }
}

mkdirSync(join(out, "scripts"), { recursive: true });
copyFileSync(join(here, "src", "run-script.mjs"), join(out, "run-script.mjs"));
for (const f of ["measure-style.mjs", "apply-style.mjs"]) copyFileSync(join(skill, f), join(out, "scripts", f));
copyFileSync(icon, join(here, "icon.png"));

const manifestPath = join(here, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = pkg.version;
manifest.tools = TOOLS.map((t) => ({ name: t.name, description: t.description }));
manifest.prompts = [{ name: PROMPT_NAME, description: PROMPT_DESCRIPTION, arguments: PROMPT_ARGUMENTS.map((a) => a.name), text: PROMPT_TEMPLATE }];
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

// Every file that goes into the bundle must fit under the cap.
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : files.push(join(d, f))));
walk(out);
files.push(join(here, "icon.png"), manifestPath);
let tooBig = 0;
for (const f of files) {
  const size = statSync(f).size;
  if (size >= MAX_FILE) tooBig++;
  console.log(`${String(size).padStart(7)}  ${relative(here, f)}${size >= MAX_FILE ? "  TOO BIG" : ""}`);
}
if (tooBig) throw new Error(`${tooBig} file(s) are ${MAX_FILE} bytes or more`);
console.log(`built ${files.length} files, ${extra.length} split point(s), version ${pkg.version}`);

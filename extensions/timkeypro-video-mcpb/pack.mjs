// Validate, pack and re-store the bundle: node pack.mjs  ->  timkeypro-video.mcpb
// `mcpb pack` deflates every entry. Claude Desktop 1.12603.x hangs without an error on deflated entries
// above Node's stream highWaterMark (16 KiB on Windows, 64 KiB on macOS; anthropics/claude-code#67865),
// so the archive is rewritten with stored (uncompressed) entries, which install on every build.
// Needs zip, unzip and zipinfo (macOS and Linux have them).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// Importing build.mjs runs the build first, so the bundle never holds a stale server/ folder.
import { MAX_FILE } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const MCPB = ["--yes", "@anthropic-ai/mcpb@2.1.2"];
const build = join(here, "build");
const deflated = join(build, "deflated.mcpb");
const stage = join(build, "stage");
const final = join(here, "timkeypro-video.mcpb");
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: here, stdio: "inherit", ...opts });

rmSync(build, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
sh("npx", [...MCPB, "validate", "manifest.json"]);
sh("npx", [...MCPB, "pack", ".", deflated]);
sh("unzip", ["-q", deflated, "-d", stage]);
rmSync(final, { force: true });
sh("zip", ["-q", "-X", "-0", "-r", "-D", final, "."], { cwd: stage });

// Check the result: every entry stored, every file under the cap.
const list = execFileSync("zipinfo", ["-l", final], { encoding: "utf8" });
const rows = list.split("\n").filter((l) => /^[-d]r/.test(l));
let bad = 0;
for (const row of rows) {
  const cols = row.trim().split(/\s+/);
  const [size, method, name] = [Number(cols[3]), cols[6], cols.slice(9).join(" ")];
  const problem = method !== "stor" ? `method ${method}` : size >= MAX_FILE ? "too big" : "";
  if (problem) bad++;
  console.log(`${String(size).padStart(7)}  ${method}  ${name}${problem ? `  <- ${problem}` : ""}`);
}
if (bad) throw new Error(`${bad} entr(ies) are not stored or are too big`);
sh("npx", [...MCPB, "info", final]);
rmSync(build, { recursive: true, force: true });
console.log(`packed ${final} (${rows.length} files, all stored)`);

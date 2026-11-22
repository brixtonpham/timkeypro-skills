// Runs one of the clone-edit-style scripts unchanged: node run-script.mjs <script.mjs> [args...]
// The scripts handle paths with spaces and Windows npx themselves; this only sets argv[1] to the
// script's real path so its main() check matches, then imports it.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [script, ...rest] = process.argv.slice(2);
if (!script) {
  console.error("run-script: no script given");
  process.exit(2);
}
const real = resolve(script);
process.argv = [process.argv[0], real, ...rest];
await import(pathToFileURL(real).href);

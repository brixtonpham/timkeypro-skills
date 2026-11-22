// TimKeyPro video: a local stdio MCP server that runs the clone-edit-style scripts for Claude Desktop.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { augmentPath, checkTools } from "./env.mjs";
import {
  AUDIO_EXT, PHOTO_EXT, PathError, STYLES, VIDEO_EXT, WORK, inputPath, slugify, stamp, workDirPath,
} from "./paths.mjs";
import { INSTRUCTIONS, PROMPT_ARGUMENTS, PROMPT_DESCRIPTION, PROMPT_NAME, renderPrompt } from "./prompt.mjs";
import { TOOLS } from "./tools.mjs";

/* global __VERSION__ */
const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0-dev";
const HERE = dirname(fileURLToPath(import.meta.url));
const RUN_SCRIPT = join(HERE, "run-script.mjs");
const SCRIPTS = join(HERE, "scripts");
const CAPCUT = "capcut-cli@0.35.0";
const WIN = process.platform === "win32";
const MINUTES = 60_000;

class ToolError extends Error {}

// ---------- child processes ----------

function tail(text, n = 1500) {
  const t = String(text || "").trim();
  return t.length > n ? `...${t.slice(-n)}` : t;
}

/** Run a command without blocking the server; report progress while it runs and stop it on cancel. */
function runProcess(cmd, args, { extra, label, timeoutMs, shell = false }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const started = Date.now();
    const token = extra?._meta?.progressToken;
    const ticker =
      token !== undefined && extra?.sendNotification
        ? setInterval(() => {
            const s = Math.round((Date.now() - started) / 1000);
            extra
              .sendNotification({ method: "notifications/progress", params: { progressToken: token, progress: s, message: `${label}: ${s} s` } })
              .catch(() => {});
          }, 5000)
        : null;
    let killedFor = null;
    const kill = (why) => {
      killedFor = why;
      child.kill();
    };
    const timer = setTimeout(() => kill(`timed out after ${Math.round(timeoutMs / MINUTES)} min`), timeoutMs);
    const onAbort = () => kill("cancelled");
    extra?.signal?.addEventListener("abort", onAbort, { once: true });
    const done = (code, error) => {
      clearTimeout(timer);
      if (ticker) clearInterval(ticker);
      extra?.signal?.removeEventListener("abort", onAbort);
      resolve({ code, stdout, stderr: error ? `${stderr}\n${error.message}` : stderr, killedFor });
    };
    child.on("error", (e) => done(-1, e));
    child.on("close", (code) => done(code));
  });
}

async function runSkillScript(script, args, opts) {
  const r = await runProcess(process.execPath, [RUN_SCRIPT, join(SCRIPTS, script), ...args], opts);
  if (r.killedFor) throw new ToolError(`${script} ${r.killedFor}.`);
  if (r.code !== 0) throw new ToolError(tail(r.stderr || r.stdout) || `${script} failed (exit ${r.code}).`);
  return r.stdout;
}

function runNpx(args, opts) {
  if (WIN) {
    const quote = (a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '""')}"`);
    return runProcess(["npx", ...args.map(quote)].join(" "), [], { ...opts, shell: true });
  }
  return runProcess("npx", args, opts);
}

function lastJsonLine(text) {
  const lines = String(text).trim().split(/\r?\n/).reverse();
  for (const line of lines) {
    try {
      return JSON.parse(line);
    } catch {}
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---------- tools ----------

function frameImage(file) {
  // Longest side 512 px keeps 12 frames well under the size Claude Desktop accepts in one result.
  const r = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-i", file, "-vf", "scale='if(gt(iw,ih),min(512,iw),-2)':'if(gt(iw,ih),-2,min(512,ih))'", "-q:v", "5", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
    { maxBuffer: 16 * 1024 * 1024, windowsHide: true },
  );
  const data = r.status === 0 && r.stdout?.length ? r.stdout : readFileSync(file);
  return data.toString("base64");
}

async function measureStyle(args, extra) {
  const video = inputPath(args.video_path, "video_path", { exts: VIDEO_EXT });
  const model = args.whisper_model ? inputPath(args.whisper_model, "whisper_model", { exts: [".bin"] }) : null;
  const frames = Math.min(12, Math.max(1, Number.isInteger(args.max_frames) ? args.max_frames : 12));
  let slug;
  try {
    slug = slugify(basename(video, extname(video)));
  } catch {
    slug = "reference";
  }
  const out = join(WORK, `${slug}-${stamp()}`);
  mkdirSync(out, { recursive: true });
  const cli = [video, "--out", out, "--frames", String(frames)];
  if (model) cli.push("--whisper-model", model);
  await runSkillScript("measure-style.mjs", cli, { extra, label: "measuring", timeoutMs: 30 * MINUTES });

  const stylePath = join(out, "style.json");
  const style = JSON.parse(readFileSync(stylePath, "utf8"));
  const list = (style.frames || []).slice(0, 12).map((f) => ({ t: f.t, path: join(out, f.file) }));
  const content = [
    { type: "text", text: JSON.stringify({ work_dir: out, style_path: stylePath, frames: list, style }, null, 2) },
  ];
  list.forEach((f, i) => {
    content.push({ type: "text", text: `Frame ${i + 1} of ${list.length}, at ${f.t} s` });
    content.push({ type: "image", data: frameImage(f.path), mimeType: "image/jpeg" });
  });
  return { content };
}

function saveStyleFile(args) {
  const slug = slugify(args.name, "name");
  let style = args.style;
  if (typeof style === "string") {
    try {
      style = JSON.parse(style);
    } catch {
      throw new ToolError("style: not valid JSON.");
    }
  }
  if (!style || typeof style !== "object" || Array.isArray(style)) throw new ToolError("style: must be a style.json object.");
  if (!style.pacing || typeof style.pacing !== "object") throw new ToolError("style: has no pacing block (it comes from measure_style).");
  const cleanup = args.cleanup_work_dir ? workDirPath(args.cleanup_work_dir, "cleanup_work_dir") : null;
  const dir = join(STYLES, slug);
  const file = join(dir, "style.json");
  if (existsSync(file) && args.overwrite !== true) {
    throw new ToolError(`A style named "${slug}" already exists at ${file}. Pass overwrite: true to replace it, or choose another name.`);
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(style, null, 2) + "\n");
  if (cleanup) rmSync(cleanup, { recursive: true, force: true });
  return { saved: file, name: slug, removed_work_dir: cleanup };
}

function listStyleFiles() {
  if (!existsSync(STYLES)) return { styles_dir: STYLES, styles: [] };
  const styles = [];
  for (const name of readdirSync(STYLES).sort()) {
    const file = join(STYLES, name, "style.json");
    if (!existsSync(file)) continue;
    const entry = { name, path: file, modified: statSync(file).mtime.toISOString() };
    try {
      const s = JSON.parse(readFileSync(file, "utf8"));
      Object.assign(entry, {
        aspect: s.source?.aspect ?? null,
        duration_s: s.source?.duration_s ?? null,
        cuts_per_min: s.pacing?.cuts_per_min ?? null,
        captions_filled: Boolean(s.captions),
      });
    } catch {
      entry.error = "style.json is not valid JSON";
    }
    styles.push(entry);
  }
  return { styles_dir: STYLES, styles };
}

function optText(value, label, max = 200) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ToolError(`${label}: must be text.`);
  const t = value.trim();
  if (t.length > max) throw new ToolError(`${label}: at most ${max} characters.`);
  return t || null;
}

async function applyStyle(args, extra) {
  const stylePath = inputPath(args.style_path, "style_path", { exts: [".json"] });
  let style;
  try {
    style = JSON.parse(readFileSync(stylePath, "utf8"));
  } catch {
    throw new ToolError(`style_path: ${stylePath} is not valid JSON.`);
  }
  if (!style?.pacing) throw new ToolError(`style_path: ${stylePath} has no pacing block; it is not a style.json from measure_style.`);
  const voice = inputPath(args.voice_path, "voice_path", { exts: AUDIO_EXT });
  const broll = inputPath(args.broll_path, "broll_path", { kind: "any", exts: [...VIDEO_EXT, ...PHOTO_EXT] });
  const music = args.music_path ? inputPath(args.music_path, "music_path", { exts: AUDIO_EXT }) : null;
  const srt = args.srt_path ? inputPath(args.srt_path, "srt_path", { exts: [".srt"] }) : null;
  const model = args.whisper_model ? inputPath(args.whisper_model, "whisper_model", { exts: [".bin"] }) : null;
  const title = optText(args.title, "title");
  const name = optText(args.name, "name");
  const language = optText(args.language, "language", 8);
  if (language && !/^([a-z]{2,3}|auto)$/i.test(language)) throw new ToolError('language: use a code like "vi", "en" or "auto".');

  let slug;
  try {
    slug = slugify(name || basename(voice, extname(voice)));
  } catch {
    slug = "video";
  }
  const out = join(WORK, `apply-${slug}-${stamp()}`);
  const cli = [stylePath, "--voice", voice, "--broll", broll, "--out", out];
  if (name) cli.push("--name", name);
  if (title) cli.push("--title", title);
  if (music) cli.push("--music", music);
  if (srt) cli.push("--srt", srt);
  if (model) cli.push("--whisper-model", model);
  if (language) cli.push("--language", language);
  if (args.plan_only === true) cli.push("--plan-only");
  // Tests point this at a scratch folder so they never write into a real CapCut library.
  if (process.env.TKP_CAPCUT_DRAFTS) cli.push("--drafts", process.env.TKP_CAPCUT_DRAFTS);

  const stdout = await runSkillScript("apply-style.mjs", cli, { extra, label: "building", timeoutMs: 30 * MINUTES });
  const result = lastJsonLine(stdout);
  if (args.plan_only === true) {
    return { plan_only: true, work_dir: out, spec: result?.spec ?? join(out, "capcut-spec.json"), shots: result?.shots ?? null, checked: result?.checked === true };
  }
  const draft = result?.draft_path || result?.draftPath || result?.path || result?.out || null;
  if (!draft) return { work_dir: out, draft_path: null, compile_output: tail(stdout, 4000), lint: null };
  const lint = await runNpx(["--yes", CAPCUT, "lint", draft], { extra, label: "lint", timeoutMs: 5 * MINUTES });
  return {
    work_dir: out,
    draft_path: draft,
    compile: result,
    lint: { exit_code: lint.code, result: lastJsonLine(lint.stdout) ?? tail(lint.stdout || lint.stderr, 4000) },
  };
}

// ---------- server ----------

const json = (value) => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });

async function callTool(name, args, extra) {
  switch (name) {
    case "check_tools":
      return json(checkTools());
    case "measure_style":
      return measureStyle(args, extra);
    case "save_style_file":
      return json(saveStyleFile(args));
    case "list_style_files":
      return json(listStyleFiles());
    case "apply_style":
      return json(await applyStyle(args, extra));
    default:
      throw new ToolError(`Unknown tool: ${name}`);
  }
}

async function main() {
  augmentPath();
  const server = new Server({ name: "timkeypro-video", version: VERSION }, { capabilities: { tools: {}, prompts: {} }, instructions: INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const { name, arguments: args = {} } = req.params;
    try {
      return await callTool(name, args || {}, { ...extra, _meta: req.params._meta });
    } catch (err) {
      const refused = err instanceof PathError;
      if (!refused && !(err instanceof ToolError)) console.error(err);
      return { isError: true, content: [{ type: "text", text: `${refused ? "Refused" : "Error"}: ${err.message}` }] };
    }
  });
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: [{ name: PROMPT_NAME, description: PROMPT_DESCRIPTION, arguments: PROMPT_ARGUMENTS }],
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name !== PROMPT_NAME) throw new Error(`Unknown prompt: ${req.params.name}`);
    return { description: PROMPT_DESCRIPTION, messages: [{ role: "user", content: { type: "text", text: renderPrompt(req.params.arguments) } }] };
  });
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

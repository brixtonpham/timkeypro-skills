#!/usr/bin/env node
// End-to-end test of the packed extension: node tests/run-tests.mjs  (after `npm run pack`)
// Unpacks timkeypro-video.mcpb into a folder whose path holds spaces (as Claude Desktop's
// "Application Support/Claude/Claude Extensions" does), starts its server over stdio with HOME pointed at
// a scratch folder, and drives it with the MCP SDK client: initialize, tools/list, prompts/list,
// check_tools, measure_style on a synthetic video with known cuts, save/list styles, apply_style
// (plan only, a full draft into a scratch drafts folder, and the Windows npx path), and path refusals.
// Needs ffmpeg, ffprobe, npx and network access for the first capcut-cli download. Writes only under
// ~/.cache/claude/tmp/mcpb-test/ and deletes it at the end.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const bundle = join(root, "timkeypro-video.mcpb");
const base = join(homedir(), ".cache", "claude", "tmp", "mcpb-test");
const fakeHome = join(base, "home dir");
const extDir = join(base, "Application Support", "Claude Extensions", "timkeypro-video");
const inputs = join(base, "my videos");
const drafts = join(base, "capcut drafts");
let failed = 0;
const TIMEOUT = { timeout: 10 * 60_000 };

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${(r.stderr || r.stdout).slice(-500)}`);
  return r.stdout;
}
const textOf = (res) => res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
const jsonOf = (res) => JSON.parse(res.content[0].text);

async function connect(extraEnv = {}) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(extDir, "server", "index.mjs")],
    env: {
      PATH: process.env.PATH,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      // Reuse the real npm cache so capcut-cli is not downloaded again for the fake home.
      npm_config_cache: join(homedir(), ".npm"),
      TKP_CAPCUT_DRAFTS: drafts,
      ...extraEnv,
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "tkp-test", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

if (!existsSync(bundle)) throw new Error(`Build the bundle first (npm run pack): ${bundle} is missing`);
rmSync(base, { recursive: true, force: true });
for (const d of [fakeHome, extDir, inputs, drafts]) mkdirSync(d, { recursive: true });

try {
  sh("npx", ["--yes", "@anthropic-ai/mcpb@2.1.2", "unpack", bundle, extDir]);
  check("bundle unpacks with mcpb unpack", existsSync(join(extDir, "server", "index.mjs")));

  // Synthetic reference: 13 shots of known length (12 hard cuts) and a 128 BPM click track,
  // the same recipe as clone-edit-style/tests/selftest.mjs.
  const lens = [2, 1.5, 1, 2.5, 2, 1.2, 0.8, 3, 2, 1, 1.7, 2, 2];
  const sources = ["testsrc2=", "mandelbrot=", "smptebars=", "color=c=red:"];
  const ff = [];
  const parts = [];
  lens.forEach((len, i) => {
    ff.push("-f", "lavfi", "-t", String(len), "-i", `${sources[i % sources.length]}s=640x360:r=30`);
    parts.push(`[${i}:v]setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
  });
  const total = lens.reduce((a, b) => a + b, 0);
  ff.push("-f", "lavfi", "-i", "sine=f=1000:d=0.03,apad=whole_dur=0.46875");
  const graph = `${parts.join(";")};${lens.map((_, i) => `[v${i}]`).join("")}concat=n=${lens.length}:v=1:a=0[v];[${lens.length}:a]aloop=loop=-1:size=22500,atrim=0:${total}[a]`;
  const video = join(inputs, "reference video.mp4");
  sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...ff, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);
  const expected = [];
  lens.slice(0, -1).reduce((t, len) => (expected.push(Math.round((t + len) * 100) / 100), t + len), 0);
  const brollDir = join(inputs, "b-roll");
  mkdirSync(brollDir);
  sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", video, "-c", "copy", join(brollDir, "clip 1.mp4")]);
  const srt = join(inputs, "captions.srt");
  writeFileSync(srt, "1\n00:00:00,000 --> 00:00:02,000\nXin chào các bạn\n\n2\n00:00:02,000 --> 00:00:04,000\nhôm nay mình thử\n");

  const client = await connect();

  // initialize, tools/list, prompts/list
  const info = client.getServerVersion();
  check("initialize: server name", info?.name === "timkeypro-video", `${info?.name} ${info?.version}`);
  check("initialize: instructions", /user's language/.test(client.getInstructions() || ""), `${(client.getInstructions() || "").length} chars`);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  check("tools/list", JSON.stringify(tools) === JSON.stringify(["apply_style", "check_tools", "list_style_files", "measure_style", "save_style_file"]), tools.join(", "));
  const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  check("manifest lists the same tools", JSON.stringify(manifest.tools.map((t) => t.name).sort()) === JSON.stringify(tools));
  const prompts = (await client.listPrompts()).prompts;
  check("prompts/list", prompts.length === 1 && prompts[0].name === "clone_edit_style", prompts.map((p) => p.name).join(", "));
  const prompt = await client.getPrompt({ name: "clone_edit_style", arguments: { video } });
  const ptext = prompt.messages[0].content.text;
  check("prompts/get fills the video and names the tools", ptext.includes(video) && /measure_style/.test(ptext) && /apply_style/.test(ptext), `${ptext.length} chars`);
  check("manifest prompt text matches the server", manifest.prompts[0].text.replace("${arguments.video}", video) === ptext);

  // check_tools
  const tools0 = jsonOf(await client.callTool({ name: "check_tools", arguments: {} }));
  check("check_tools finds ffmpeg, ffprobe, npx", tools0.ffmpeg.found && tools0.ffprobe.found && tools0.npx.found, `ffmpeg ${tools0.ffmpeg.path}, npx ${tools0.npx.path}`);
  check("check_tools gives install commands", Boolean(tools0.ffmpeg.install.macos && tools0.ffmpeg.install.windows && tools0.whisper_model.install.windows));
  check("check_tools ready flags", tools0.ready.measure_style && tools0.ready.apply_style, JSON.stringify(tools0.ready));

  // measure_style
  const measured = await client.callTool({ name: "measure_style", arguments: { video_path: video, max_frames: 4 } }, undefined, TIMEOUT);
  check("measure_style succeeds", !measured.isError, measured.isError ? textOf(measured).slice(0, 300) : "");
  const m = jsonOf(measured);
  const got = m.style.pacing.cut_times_s;
  const matched = expected.filter((t) => got.some((g) => Math.abs(g - t) <= 0.05)).length;
  check("measure_style finds every hard cut", matched === expected.length && got.length === expected.length, `${matched}/${expected.length} matched, ${got.length} found`);
  check("measure_style tempo", Math.abs(m.style.audio.beat.bpm - 128) <= 2, `${m.style.audio.beat.bpm} BPM`);
  const images = measured.content.filter((c) => c.type === "image");
  const sizes = images.map((i) => Buffer.from(i.data, "base64").length);
  check("measure_style returns 4 frames as JPEG images", images.length === 4 && images.every((i) => i.mimeType === "image/jpeg"), `${sizes.join(", ")} bytes`);
  check("frames are on disk under ~/TimKeyPro/work", m.frames.every((f) => existsSync(f.path) && f.path.startsWith(join(fakeHome, "TimKeyPro", "work"))));

  // save_style_file + list_style_files
  const style = {
    ...m.style,
    captions: { present: true, position: { x: 0.5, y: 0.85 }, font_size_pct_h: 0.06, fill: "#FFFFFF", outline: { color: "#000000", px: 4 }, box: null, words_per_chunk: 3 },
    zoom: { punch_in_per_min: 3, scale: 1.15 },
  };
  const saved = await client.callTool({ name: "save_style_file", arguments: { name: "Kể chuyện nhanh", style, cleanup_work_dir: m.work_dir } });
  const s = jsonOf(saved);
  check("save_style_file writes the slug path and removes the frames", !saved.isError && s.saved === join(fakeHome, "TimKeyPro", "styles", "ke-chuyen-nhanh", "style.json") && existsSync(s.saved) && !existsSync(m.work_dir), s.saved);
  const again = await client.callTool({ name: "save_style_file", arguments: { name: "Kể chuyện nhanh", style } });
  check("save_style_file will not overwrite by default", again.isError === true, textOf(again).slice(0, 120));
  const listed = jsonOf(await client.callTool({ name: "list_style_files", arguments: {} }));
  check("list_style_files", listed.styles.length === 1 && listed.styles[0].name === "ke-chuyen-nhanh" && listed.styles[0].cuts_per_min > 0, JSON.stringify(listed.styles[0]));

  // apply_style, plan only: the spec must pass capcut-cli compile --check
  const plan = await client.callTool({ name: "apply_style", arguments: { style_path: s.saved, voice_path: video, broll_path: brollDir, srt_path: srt, title: "Thử nghiệm", plan_only: true } }, undefined, TIMEOUT);
  const p = plan.isError ? {} : jsonOf(plan);
  check("apply_style plan_only: spec passes --check", p.checked === true && existsSync(p.spec), plan.isError ? textOf(plan).slice(0, 400) : `${p.shots} shots, ${p.spec}`);
  const spec = p.spec ? JSON.parse(readFileSync(p.spec, "utf8")) : null;
  check("spec has b-roll, voice, title and captions", Boolean(spec && spec.tracks.some((t) => t.name === "Voice") && spec.operations.some((o) => o.op === "captions")));

  // apply_style, full draft into a scratch drafts folder, then lint
  const full = await client.callTool({ name: "apply_style", arguments: { style_path: s.saved, voice_path: video, broll_path: brollDir, srt_path: srt, name: "TKP test draft" } }, undefined, TIMEOUT);
  const f = full.isError ? {} : jsonOf(full);
  check("apply_style writes a draft and returns draft_path", Boolean(f.draft_path && existsSync(f.draft_path) && f.draft_path.startsWith(drafts)), full.isError ? textOf(full).slice(0, 400) : f.draft_path ?? f.compile_output);
  check("apply_style returns the lint result", f.lint && typeof f.lint.exit_code === "number", f.lint ? `exit ${f.lint.exit_code}: ${JSON.stringify(f.lint.result).slice(0, 200)}` : "none");

  // path refusals
  const refused = async (name, args, label) => {
    const r = await client.callTool({ name, arguments: args });
    check(`refuses ${label}`, r.isError === true && /^Refused:/.test(textOf(r)), textOf(r).slice(0, 160));
  };
  await refused("measure_style", { video_path: "videos/clip.mp4" }, "a relative path");
  await refused("measure_style", { video_path: "/etc/hosts" }, "a file that is not a video");
  await refused("apply_style", { style_path: "/etc/passwd", voice_path: video, broll_path: brollDir }, "a style path that is not .json");
  await refused("save_style_file", { name: "x", style, cleanup_work_dir: inputs }, "deleting a folder outside ~/TimKeyPro/work");
  await refused("save_style_file", { name: "x", style, cleanup_work_dir: join(fakeHome, "TimKeyPro", "work", "..", "..") }, "escaping ~/TimKeyPro/work with ..");
  await refused("measure_style", { video_path: "~/missing.mp4" }, "a path that does not exist");
  await client.close();

  // The Windows path (npx through a shell, quoted arguments), exercised on this machine.
  const winClient = await connect({ TKP_NPX_VIA_SHELL: "1" });
  const winPlan = await winClient.callTool({ name: "apply_style", arguments: { style_path: s.saved, voice_path: video, broll_path: brollDir, srt_path: srt, plan_only: true } }, undefined, TIMEOUT);
  check("apply_style with npx through a shell (Windows path)", !winPlan.isError && jsonOf(winPlan).checked === true, winPlan.isError ? textOf(winPlan).slice(0, 300) : "");
  await winClient.close();
} finally {
  rmSync(base, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

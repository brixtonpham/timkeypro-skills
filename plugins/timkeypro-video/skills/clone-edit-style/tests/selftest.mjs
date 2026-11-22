#!/usr/bin/env node
// Self-test with known answers: builds a synthetic video with 12 hard cuts at known times and a
// 128 BPM click track, measures it, then plans (but does not write) a CapCut draft from it.
// Needs ffmpeg, ffprobe and npx. Run: node tests/selftest.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const scripts = join(here, "..", "scripts");
const base = join(homedir(), ".cache", "timkeypro-selftest");
mkdirSync(base, { recursive: true });
const work = mkdtempSync(join(base, "run-"));
let failed = 0;

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.slice(0, 3).join(" ")} failed: ${(r.stderr || r.stdout).slice(-500)}`);
  return r.stdout;
}
function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

// Shot lengths in seconds; cuts fall at their running sums.
const lens = [2, 1.5, 1, 2.5, 2, 1.2, 0.8, 3, 2, 1, 1.7, 2, 2];
const sources = ["testsrc2=", "mandelbrot=", "smptebars=", "color=c=red:"];
const inputs = [];
const parts = [];
lens.forEach((len, i) => {
  inputs.push("-f", "lavfi", "-t", String(len), "-i", `${sources[i % sources.length]}s=640x360:r=30`);
  parts.push(`[${i}:v]setpts=PTS-STARTPTS,format=yuv420p[v${i}]`);
});
const total = lens.reduce((a, b) => a + b, 0);
const click = lens.length;
inputs.push("-f", "lavfi", "-i", "sine=f=1000:d=0.03,apad=whole_dur=0.46875");
const graph = `${parts.join(";")};${lens.map((_, i) => `[v${i}]`).join("")}concat=n=${lens.length}:v=1:a=0[v];[${click}:a]aloop=loop=-1:size=22500,atrim=0:${total}[a]`;
const video = join(work, "synthetic.mp4");
sh("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", graph, "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", video]);

const expected = [];
lens.slice(0, -1).reduce((t, len) => (expected.push(Math.round((t + len) * 100) / 100), t + len), 0);

sh("node", [join(scripts, "measure-style.mjs"), video, "--out", join(work, "style"), "--frames", "4"]);
const style = JSON.parse(readFileSync(join(work, "style", "style.json"), "utf8"));
const got = style.pacing.cut_times_s;
const matched = expected.filter((t) => got.some((g) => Math.abs(g - t) <= 0.05)).length;
check("finds every hard cut", matched === expected.length && got.length === expected.length, `${matched}/${expected.length} matched, ${got.length} found`);
check("cuts per minute", Math.abs(style.pacing.cuts_per_min - (expected.length * 60) / total) < 0.2, String(style.pacing.cuts_per_min));
check("tempo of the click track", Math.abs(style.audio.beat.bpm - 128) <= 2, `${style.audio.beat.bpm} BPM, confidence ${style.audio.beat.confidence}`);
check("frames written", style.frames.length === 4, String(style.frames.length));

// Plan a draft from the measured style with the synthetic video as both voice and b-roll.
style.source.aspect = "16:9";
style.captions = { position: { x: 0.5, y: 0.85 }, fill: "#FFFFFF", outline: { color: "#000000", px: 4 } };
writeFileSync(join(work, "style", "style.json"), JSON.stringify(style));
const srt = join(work, "c.srt");
writeFileSync(srt, "1\n00:00:00,000 --> 00:00:02,000\nXin chào các bạn\n\n2\n00:00:02,000 --> 00:00:02,200\nnhé\n");
const out = sh("node", [join(scripts, "apply-style.mjs"), join(work, "style", "style.json"), "--voice", video, "--broll", video, "--srt", srt, "--out", join(work, "apply"), "--plan-only"]);
const plan = JSON.parse(out.trim().split("\n").pop());
check("capcut-cli accepts the spec", plan.ok === true && plan.checked === true, `${plan.shots} shots`);

const { mergeShortCues, splitLongCues } = await import(join(scripts, "apply-style.mjs"));
const long = "1\n00:00:00,000 --> 00:00:06,000\nĐây là ngách giao điểm cực ngon cho anh em làm tài chính cá nhân và AI cùng lúc\n";
const split = splitLongCues(long, 24).split("\n\n").filter(Boolean);
const lines = split.map((b) => b.split("\n")[2]);
const lastEnd = split[split.length - 1].split("\n")[1].split("--> ")[1];
check("long caption cues are split", split.length >= 3 && lines.every((l) => l.length <= 24) && lastEnd === "00:00:06,000", `${split.length} cues, longest ${Math.max(...lines.map((l) => l.length))} chars`);
const merged = mergeShortCues(readFileSync(srt, "utf8"));
check("short caption cues are merged", merged.split("-->").length === 2, merged.replace(/\n/g, " | "));

// Every preset in styles/ is internally consistent, plans to its own pacing and compiles in capcut-cli.
const { planShots, buildSpec } = await import(join(scripts, "apply-style.mjs"));
const stylesDir = join(here, "..", "styles");
const presetProblems = [];
const presetSlugs = readdirSync(stylesDir).filter((d) => existsSync(join(stylesDir, d, "style.json")));
for (const slug of presetSlugs) {
  const p = JSON.parse(readFileSync(join(stylesDir, slug, "style.json"), "utf8"));
  const bad = (msg) => presetProblems.push(`${slug}: ${msg}`);
  const { p10, median, p90 } = p.pacing.shot_len_s;
  const hookCuts = p.hook.cuts_0_5s;
  if (p.source.kind !== "preset" || !/not measured/.test(p.source.note)) bad("source must say kind preset, not measured");
  if (!(p10 < median && median < p90)) bad(`shot lengths not ordered: ${p10} ${median} ${p90}`);
  if (Math.abs(p.pacing.cuts_per_min - 60 / median) > 0.1 * (60 / median)) bad(`cuts_per_min ${p.pacing.cuts_per_min} vs 60/median ${(60 / median).toFixed(1)}`);
  if (hookCuts !== p.pacing.hook_0_5s.cuts || 5 / (hookCuts + 1) < 0.6) bad(`hook cuts ${hookCuts} do not fit in 5 s`);
  if (!["9:16", "16:9"].includes(p.source.aspect)) bad(`aspect ${p.source.aspect}`);
  const shots = planShots(p, p.source.duration_s);
  const mean = shots.reduce((a, b) => a + b, 0) / shots.length;
  if (Math.abs(mean - median) > 0.25 * median) bad(`planned mean shot ${mean.toFixed(2)} s vs median ${median}`);
  let t = 0;
  const hookShots = shots.filter((len) => ((t += len), t - len < 5 - 0.01)).length;
  if (hookShots !== hookCuts + 1) bad(`hook has ${hookShots} shots, expected ${hookCuts + 1}`);
  const spec = buildSpec(p, { voice: video, voiceLen: total, broll: [{ path: video, photo: false, length: total }], srt, name: `Preset ${slug}`, title: "Tiêu đề thử" });
  const specFile = join(work, `preset-${slug}.json`);
  writeFileSync(specFile, JSON.stringify(spec));
  const r = spawnSync("npx", ["--yes", "capcut-cli@0.35.0", "compile", specFile, "--check"], { encoding: "utf8" });
  if (r.status !== 0) bad(`capcut-cli --check failed: ${(r.stderr || r.stdout).slice(-300)}`);
}
check("presets plan and compile", presetSlugs.length === 5 && presetProblems.length === 0, presetProblems.join("; ") || `${presetSlugs.length} presets`);

rmSync(work, { recursive: true, force: true });
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);

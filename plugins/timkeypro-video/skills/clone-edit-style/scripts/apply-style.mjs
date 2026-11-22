#!/usr/bin/env node
// Turn a style.json (from measure-style.mjs, completed by Claude) plus the user's own voice and
// b-roll into a capcut-cli compile spec, then build an editable CapCut draft from it.
// Needs ffprobe; whisper-cli for captions (or pass --srt); capcut-cli (npx capcut-cli).
//
// Usage:
//   node apply-style.mjs <style.json> --voice voice.mp3 --broll <dir|file> [--broll <file> ...]
//        [--name "My video"] [--title "Hook text"] [--music bgm.mp3] [--srt captions.srt]
//        [--whisper-model PATH] [--drafts DIR] [--out DIR] [--plan-only]

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";

const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const PHOTO_EXT = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function parseArgs(argv) {
  const a = { broll: [] };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === "--voice") a.voice = next();
    else if (k === "--broll") a.broll.push(next());
    else if (k === "--name") a.name = next();
    else if (k === "--title") a.title = next();
    else if (k === "--music") a.music = next();
    else if (k === "--srt") a.srt = next();
    else if (k === "--whisper-model") a.whisperModel = next();
    else if (k === "--language") a.language = next();
    else if (k === "--drafts") a.drafts = next();
    else if (k === "--out") a.out = next();
    else if (k === "--plan-only") a.planOnly = true;
    else if (k === "-h" || k === "--help") a.help = true;
    else if (!a.style) a.style = k;
  }
  return a;
}

function run(cmd, args, { allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) throw new Error(`${cmd} failed (exit ${r.status}): ${(r.stderr || r.stdout).slice(-800)}`);
  return r;
}

function duration(file) {
  const r = run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  const d = Number(r.stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`Cannot read the length of ${file}`);
  return d;
}

function round(n, d = 3) {
  return Math.round(n * 10 ** d) / 10 ** d;
}

// Deterministic pseudo-random numbers, so the same inputs give the same cut list.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function listBroll(inputs) {
  const files = [];
  for (const input of inputs) {
    const p = resolve(input);
    if (!existsSync(p)) throw new Error(`B-roll not found: ${p}`);
    if (statSync(p).isDirectory()) {
      for (const f of readdirSync(p).sort()) {
        const ext = extname(f).toLowerCase();
        if (VIDEO_EXT.has(ext) || PHOTO_EXT.has(ext)) files.push(join(p, f));
      }
    } else files.push(p);
  }
  if (!files.length) throw new Error("No b-roll clips or photos found (.mp4 .mov .webm .jpg .png ...).");
  return files.map((path) => {
    const photo = PHOTO_EXT.has(extname(path).toLowerCase());
    return { path, photo, length: photo ? Infinity : duration(path) };
  });
}

function canvas(aspect) {
  if (aspect === "9:16") return { width: 1080, height: 1920, ratio: "9:16" };
  if (aspect === "1:1") return { width: 1080, height: 1080, ratio: "1:1" };
  if (aspect === "4:5") return { width: 1080, height: 1350, ratio: "4:5" };
  return { width: 1920, height: 1080, ratio: "16:9" };
}

// Shot lengths that follow the reference: a faster hook, then lengths drawn between p10 and p90
// around the median, scaled so the average matches the measured cuts per minute.
export function planShots(style, total, seed = 7) {
  const pace = style.pacing || {};
  const lens = pace.shot_len_s || {};
  const cpm = pace.cuts_per_min || 0;
  const targetMean = cpm > 0 ? 60 / cpm : lens.median || 4;
  const lo = Math.max(0.6, lens.p10 ?? targetMean * 0.5);
  const hi = Math.max(lo + 0.2, Math.min(lens.p90 ?? targetMean * 1.8, 30));
  const hookCuts = style.hook?.cuts_0_5s ?? pace.hook_0_5s?.cuts ?? 0;
  const rand = rng(seed);
  const shots = [];
  let t = 0;
  if (hookCuts > 0 && total > 6) {
    const hookLen = Math.min(5, total) / (hookCuts + 1);
    for (let i = 0; i <= hookCuts; i++) {
      shots.push(round(hookLen));
      t += hookLen;
    }
  }
  while (t < total - 0.05) {
    // Triangular draw around the target mean, clamped to the measured spread.
    const u = (rand() + rand()) / 2;
    let len = lo + (hi - lo) * u;
    len = len * 0.5 + targetMean * 0.5;
    len = Math.min(Math.max(len, lo), hi);
    if (total - (t + len) < lo) len = total - t; // fold a too-short tail into the last shot
    shots.push(round(len));
    t += len;
  }
  return shots;
}

function srtFromWhisper(voice, model, maxChars, language, workDir) {
  if (!model) throw new Error("Captions need --whisper-model (a whisper.cpp ggml model) or --srt.");
  const wav = join(workDir, "voice-16k.wav");
  run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", voice, "-ac", "1", "-ar", "16000", wav]);
  const base = join(workDir, "captions");
  run("whisper-cli", ["-m", model, "-f", wav, "-l", language || "auto", "-osrt", "-of", base, "-ml", String(maxChars), "-sow", "-np"]);
  const limit = Math.max(maxChars, 24);
  const merged = mergeShortCues(splitLongCues(readFileSync(`${base}.srt`, "utf8"), limit), 0.6, 20, limit);
  writeFileSync(`${base}.srt`, merged);
  return `${base}.srt`;
}

const toSec = (ts) => {
  const [h, m, rest] = ts.split(":");
  const [s, ms] = rest.split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
};
const toTs = (sec) => {
  const ms = Math.round(sec * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

function parseCues(srt) {
  return srt
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((block) => block.trim().split("\n"))
    .filter((lines) => lines.length >= 3 && lines[1].includes("-->"))
    .map((lines) => {
      const [a, b] = lines[1].split("-->").map((s) => toSec(s.trim()));
      return { start: a, end: b, text: lines.slice(2).join(" ").trim() };
    })
    .filter((c) => c.text);
}

function writeCues(cues) {
  return cues.map((c, i) => `${i + 1}\n${toTs(c.start)} --> ${toTs(c.end)}\n${c.text}\n`).join("\n");
}

// Whisper can ignore its length limit and return a whole sentence as one cue. Split such a cue into
// word groups of at most `maxChars` characters and share its time out by character count.
export function splitLongCues(srt, maxChars = 32) {
  const out = [];
  for (const c of parseCues(srt)) {
    if (c.text.length <= maxChars) {
      out.push(c);
      continue;
    }
    const groups = [];
    let cur = "";
    for (const w of c.text.split(/\s+/)) {
      if (cur && (cur + " " + w).length > maxChars) {
        groups.push(cur);
        cur = w;
      } else cur = cur ? `${cur} ${w}` : w;
    }
    if (cur) groups.push(cur);
    const totalChars = groups.reduce((s, g) => s + g.length, 0);
    let t = c.start;
    groups.forEach((g, i) => {
      const end = i === groups.length - 1 ? c.end : t + ((c.end - c.start) * g.length) / totalChars;
      out.push({ start: t, end, text: g });
      t = end;
    });
  }
  return writeCues(out);
}

// Whisper sometimes emits a cue of a fraction of a second; nobody can read it. Join any cue shorter
// than `minSec` (or faster than 20 characters a second) to the next one.
export function mergeShortCues(srt, minSec = 0.6, maxCps = 20, maxChars = Infinity) {
  const cues = srt
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((block) => block.trim().split("\n"))
    .filter((lines) => lines.length >= 3 && lines[1].includes("-->"))
    .map((lines) => {
      const [a, b] = lines[1].split("-->").map((s) => toSec(s.trim()));
      return { start: a, end: b, text: lines.slice(2).join(" ").trim() };
    })
    .filter((c) => c.text);
  const out = [];
  for (let i = 0; i < cues.length; i++) {
    const c = { ...cues[i] };
    while (
      i + 1 < cues.length &&
      (c.end - c.start < minSec || c.text.length / Math.max(c.end - c.start, 0.01) > maxCps) &&
      // A fast cue may stay fast rather than grow past the length limit; a sub-0.3 s flash always joins.
      (c.text.length + 1 + cues[i + 1].text.length <= maxChars || c.end - c.start < 0.3)
    ) {
      const n = cues[++i];
      c.end = n.end;
      c.text = `${c.text} ${n.text}`;
    }
    out.push(c);
  }
  // A short cue at the very end has no next cue: join it to the one before.
  const last = out[out.length - 1];
  if (
    out.length > 1 &&
    (last.end - last.start < minSec || last.text.length / Math.max(last.end - last.start, 0.01) > maxCps) &&
    (out[out.length - 2].text.length + 1 + last.text.length <= maxChars || last.end - last.start < 0.3)
  ) {
    const prev = out[out.length - 2];
    prev.end = last.end;
    prev.text = `${prev.text} ${last.text}`;
    out.pop();
  }
  return out.map((c, i) => `${i + 1}\n${toTs(c.start)} --> ${toTs(c.end)}\n${c.text}\n`).join("\n");
}

function hex(c, fallback) {
  return typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : fallback;
}

export function buildSpec(style, opts) {
  const { voice, voiceLen, broll, music, srt, name, title } = opts;
  const cv = canvas(style.source?.aspect);
  const shots = planShots(style, voiceLen);
  const zoom = style.zoom || {};
  const punchEvery = zoom.punch_in_per_min > 0 ? Math.max(1, Math.round((60 / (zoom.punch_in_per_min || 1)) / (voiceLen / shots.length))) : 0;
  const zoomScale = zoom.scale > 1 && zoom.scale < 2 ? zoom.scale : 1.12;

  const videoItems = [];
  const cursor = new Map(); // how far into each clip we have used, so clips are not repeated at once
  let t = 0;
  shots.forEach((len, i) => {
    const clip = broll[i % broll.length];
    const used = cursor.get(clip.path) || 0;
    const item = { start: round(t), duration: round(len), path: clip.path };
    if (clip.photo) item.type = "photo";
    else {
      const start = used + len <= clip.length ? used : 0;
      if (len > clip.length) item.speed = round(clip.length / len, 3); // slow a short clip to fill the shot
      else item.sourceStart = round(start);
      cursor.set(clip.path, start + len);
    }
    if (punchEvery && i % punchEvery === punchEvery - 1) item.scale = round(zoomScale, 2);
    videoItems.push(item);
    t += len;
  });

  const cap = style.captions || {};
  const pos = cap.position || { x: 0.5, y: cv.ratio === "9:16" ? 0.72 : 0.85 };
  // CapCut positions run from -1 (left/top) to 1 (right/bottom) around the centre.
  const x = round((pos.x ?? 0.5) * 2 - 1, 3);
  const y = round((pos.y ?? 0.8) * 2 - 1, 3);
  const fontSize = Math.round(Math.min(Math.max((cap.font_size_pct_h ?? 0.05) * 160, 5), 20));
  const textStyle = {
    color: hex(cap.fill, "#FFFFFF"),
    borderColor: hex(cap.outline?.color, "#000000"),
    borderWidth: round(Math.min(Math.max((cap.outline?.px ?? 4) / 40, 0), 0.2), 3),
    borderAlpha: cap.outline ? 1 : 0,
  };
  if (cap.box?.color) Object.assign(textStyle, { bgColor: hex(cap.box.color, "#000000"), bgAlpha: cap.box.alpha ?? 0.6, bgStyle: 1 });

  const tracks = [
    { type: "video", name: "B-roll", items: videoItems },
    { type: "audio", name: "Voice", items: [{ start: 0, path: voice, duration: round(voiceLen), volume: 1 }] },
  ];
  if (music) {
    // Music sits under the voice at the measured level (default -20 dB → 0.1 linear).
    const db = style.audio?.music_db_under_voice ?? -20;
    tracks.push({ type: "audio", name: "Music", items: [{ start: 0, path: music, duration: round(voiceLen), volume: round(10 ** (db / 20), 3) }] });
  }
  const titleText = title || style.hook?.title_text || null;
  // The style reference is the hook title when there is one, else a 0.1 s blank-looking dot at the end.
  tracks.push({
    type: "text",
    name: "Title",
    items: [
      titleText
        ? { ref: "capstyle", start: 0, duration: round(Math.min(2.5, voiceLen)), text: titleText, fontSize: fontSize + 2, color: textStyle.color, x, y: round(Math.max(-0.8, y - 0.9), 3) }
        : { ref: "capstyle", start: round(Math.max(0, voiceLen - 0.1)), duration: 0.1, text: ".", fontSize, color: textStyle.color, x, y },
    ],
  });

  const operations = [
    { op: "text-style", target: "capstyle", style: { ...textStyle, fontSize } },
    { op: "captions", path: srt, trackName: "Captions", styleRef: "capstyle" },
  ];
  return { name, width: cv.width, height: cv.height, fps: 30, ratio: cv.ratio, tracks, operations };
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.style || !a.voice || !a.broll.length) {
    console.log("Usage: node apply-style.mjs <style.json> --voice voice.mp3 --broll <dir|file> [--name N] [--title T] [--music bgm.mp3] [--srt f.srt | --whisper-model M] [--drafts DIR] [--out DIR] [--plan-only]");
    process.exit(a.help ? 0 : 2);
  }
  const style = JSON.parse(readFileSync(resolve(a.style), "utf8"));
  const voice = resolve(a.voice);
  if (!existsSync(voice)) throw new Error(`Voice file not found: ${voice}`);
  const out = resolve(a.out || "tkp-apply");
  mkdirSync(out, { recursive: true });
  const voiceLen = duration(voice);
  const broll = listBroll(a.broll);
  const wordsPerChunk = style.captions?.words_per_chunk ?? 3;
  const srt = a.srt ? resolve(a.srt) : srtFromWhisper(voice, a.whisperModel, Math.max(8, wordsPerChunk * 7), a.language, out);
  const name = a.name || `TKP ${basename(voice, extname(voice))}`;
  const spec = buildSpec(style, { voice, voiceLen, broll, music: a.music && resolve(a.music), srt, name, title: a.title });
  const specFile = join(out, "capcut-spec.json");
  writeFileSync(specFile, JSON.stringify(spec, null, 2) + "\n");

  const capcut = ["--yes", "capcut-cli@0.35.0"];
  run("npx", [...capcut, "compile", specFile, "--check"]);
  if (a.planOnly) {
    console.log(JSON.stringify({ ok: true, spec: specFile, shots: spec.tracks[0].items.length, checked: true }));
    return;
  }
  const args = [...capcut, "compile", specFile];
  if (a.drafts) args.push("--drafts", resolve(a.drafts));
  const r = run("npx", args);
  console.log(r.stdout.trim());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (err) {
    console.error(`apply-style: ${err.message}`);
    process.exit(1);
  }
}

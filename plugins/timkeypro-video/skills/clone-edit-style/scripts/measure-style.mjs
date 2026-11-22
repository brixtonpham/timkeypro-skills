#!/usr/bin/env node
// Measure the edit style of one reference video and write style.json plus a few frames
// for Claude to read the parts a script cannot measure (captions, zooms, b-roll, grade).
// Needs only ffmpeg and ffprobe on PATH (whisper-cli is optional). Never copies the video.
//
// Usage: node measure-style.mjs <video> [--out DIR] [--threshold 0.3] [--whisper-model PATH]
//   With no --threshold it tries 0.3, then 0.12 when 0.3 finds no cut (soft transitions).

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join, resolve, basename } from "node:path";

const VERSION = "tkp-style@1";

function parseArgs(argv) {
  const args = { video: null, out: null, threshold: null, whisperModel: null, frames: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") args.out = argv[++i];
    else if (a === "--threshold") args.threshold = Number(argv[++i]);
    else if (a === "--whisper-model") args.whisperModel = argv[++i];
    else if (a === "--frames") args.frames = Number(argv[++i]);
    else if (a === "-h" || a === "--help") args.help = true;
    else if (!args.video) args.video = a;
  }
  return args;
}

function run(cmd, args, { input, maxBuffer = 512 * 1024 * 1024, allowFail = false } = {}) {
  const r = spawnSync(cmd, args, { input, maxBuffer, encoding: input ? undefined : "buffer" });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0 && !allowFail) {
    throw new Error(`${cmd} failed (exit ${r.status}): ${r.stderr.toString().slice(-600)}`);
  }
  return r;
}

function round(n, d = 2) {
  return Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null;
}

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function probe(video) {
  const r = run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", video]);
  const j = JSON.parse(r.stdout.toString());
  const v = j.streams.find((s) => s.codec_type === "video");
  if (!v) throw new Error("No video stream in this file.");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const [num, den] = (v.avg_frame_rate || "0/1").split("/").map(Number);
  const duration = Number(j.format.duration || v.duration);
  let w = v.width;
  let h = v.height;
  const rot = Number(v.tags?.rotate ?? v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0);
  if (Math.abs(rot) === 90) [w, h] = [h, w];
  return { duration, width: w, height: h, fps: den ? num / den : null, hasAudio: Boolean(a) };
}

function aspectLabel(w, h) {
  const r = w / h;
  if (Math.abs(r - 16 / 9) < 0.05) return "16:9";
  if (Math.abs(r - 9 / 16) < 0.05) return "9:16";
  if (Math.abs(r - 1) < 0.05) return "1:1";
  if (Math.abs(r - 4 / 5) < 0.05) return "4:5";
  return `${w}:${h}`;
}

function detectCuts(video, threshold) {
  // Scene score on a small copy of each frame: fast and good enough for hard cuts.
  const r = run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", video, "-an",
    "-vf", `scale=320:-2,select='gt(scene,${threshold})',showinfo`,
    "-f", "null", "-",
  ]);
  const cuts = [];
  for (const line of r.stderr.toString().split("\n")) {
    const m = line.match(/pts_time:([\d.]+)/);
    if (m) cuts.push(Number(m[1]));
  }
  // Two "cuts" within 0.25 s are one transition (flash, fast fade).
  const merged = [];
  for (const t of cuts) if (!merged.length || t - merged[merged.length - 1] > 0.25) merged.push(t);
  return merged;
}

// Soft transitions (fades, dissolves, slides) score far below a hard cut, so a template video can show 0
// cuts at 0.3 and plan as one slowed-down shot. With no --threshold given and no cut at 0.3, use 0.12;
// a middle step (0.2) finds only the sharpest fades. A real one-take video still finds none at 0.12.
const THRESHOLD_STEPS = [0.3, 0.12];
function findCuts(video, duration, threshold) {
  if (threshold != null) return { cuts: detectCuts(video, threshold), threshold, stepped: false };
  let cuts = [];
  for (const t of THRESHOLD_STEPS) {
    cuts = detectCuts(video, t);
    if (cuts.length || duration < 20) return { cuts, threshold: t, stepped: t !== THRESHOLD_STEPS[0] };
  }
  return { cuts, threshold: THRESHOLD_STEPS[0], stepped: false };
}

function pacing(cuts, duration) {
  const bounds = [0, ...cuts, duration];
  const shots = [];
  for (let i = 1; i < bounds.length; i++) shots.push(bounds[i] - bounds[i - 1]);
  const sorted = [...shots].sort((a, b) => a - b);
  const windows = [];
  for (let start = 0; start < duration; start += 30) {
    const end = Math.min(start + 30, duration);
    const n = cuts.filter((t) => t >= start && t < end).length;
    windows.push(round((n * 60) / Math.max(end - start, 1), 1));
  }
  return {
    cuts: cuts.length,
    cuts_per_min: round((cuts.length * 60) / duration, 1),
    shot_len_s: {
      p10: round(quantile(sorted, 0.1)),
      median: round(quantile(sorted, 0.5)),
      p90: round(quantile(sorted, 0.9)),
      longest: round(sorted[sorted.length - 1]),
    },
    curve_cpm_per_30s: windows,
    hook_0_5s: { cuts: cuts.filter((t) => t < 5).length },
    cut_times_s: cuts.map((t) => round(t)),
  };
}

function loudness(video) {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], {
    allowFail: true,
  });
  const text = r.stderr.toString();
  const summary = text.slice(text.lastIndexOf("Summary:"));
  const num = (re) => {
    const m = summary.match(re);
    return m ? Number(m[1]) : null;
  };
  return {
    integrated_lufs: num(/I:\s+(-?[\d.]+) LUFS/),
    range_lu: num(/LRA:\s+(-?[\d.]+) LU/),
    true_peak_dbfs: num(/Peak:\s+(-?[\d.]+) dBFS/),
  };
}

function decodeMono(video, rate) {
  const r = run("ffmpeg", ["-hide_banner", "-nostats", "-i", video, "-vn", "-ac", "1", "-ar", String(rate), "-f", "s16le", "-"]);
  const buf = r.stdout;
  const out = new Float32Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(i * 2) / 32768;
  return out;
}

// Tempo from the autocorrelation of an onset envelope (spectral-flux-free: energy rise per hop).
// A talking voice also has a rhythm, so `confidence` says how clearly one tempo stands out.
function tempo(samples, rate, cuts) {
  const hop = Math.round(rate / 100); // 100 envelope frames per second
  const frames = Math.floor(samples.length / hop);
  if (frames < 600) return { bpm: null, confidence: 0, cut_on_beat_ratio: null, note: "audio shorter than 6 s" };
  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) s += samples[i] * samples[i];
    energy[f] = Math.log1p(1000 * s / hop);
  }
  const onset = new Float32Array(frames);
  for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= frames;
  for (let f = 0; f < frames; f++) onset[f] -= mean;

  const fps = 100;
  const minLag = Math.round((60 * fps) / 180);
  const maxLag = Math.round((60 * fps) / 60);
  const ac = [];
  let zero = 0;
  for (let f = 0; f < frames; f++) zero += onset[f] * onset[f];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let f = lag; f < frames; f++) s += onset[f] * onset[f - lag];
    // Favour tempos near 120 BPM a little, as most beat trackers do, to avoid half/double picks.
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2 / 0.5 ** 2);
    ac.push({ lag, value: s / zero, score: (s / zero) * prior });
  }
  ac.sort((a, b) => b.score - a.score);
  const best = ac[0];
  const values = ac.map((x) => x.value).sort((a, b) => a - b);
  const median = quantile(values, 0.5);
  const confidence = Math.max(0, Math.min(1, (best.value - median) / 0.15));
  const bpm = (60 * fps) / best.lag;

  // Beat phase: the offset whose beat grid collects the most onset energy.
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let phase = 0; phase < best.lag; phase++) {
    let s = 0;
    for (let f = phase; f < frames; f += best.lag) s += onset[f];
    if (s > bestSum) {
      bestSum = s;
      bestPhase = phase;
    }
  }
  const period = best.lag / fps;
  const phase = bestPhase / fps;
  const onBeat = cuts.filter((t) => {
    const d = ((t - phase) % period + period) % period;
    return Math.min(d, period - d) <= 0.08;
  }).length;
  return {
    bpm: round(bpm, 0),
    confidence: round(confidence),
    cut_on_beat_ratio: cuts.length ? round(onBeat / cuts.length) : null,
    // Chance level: a random cut lands within ±80 ms of a beat this often.
    chance_ratio: round(Math.min(1, 0.16 / period)),
  };
}

function speech(video, model, workDir) {
  if (!model || !existsSync(model)) return null;
  const wav = join(workDir, "speech.wav");
  run("ffmpeg", ["-hide_banner", "-nostats", "-y", "-i", video, "-vn", "-ac", "1", "-ar", "16000", wav]);
  const base = join(workDir, "speech");
  const r = run("whisper-cli", ["-m", model, "-f", wav, "-l", "auto", "-oj", "-of", base, "-np"], { allowFail: true });
  if (r.status !== 0) return { error: r.stderr.toString().slice(-300) };
  const json = JSON.parse(readFileSync(`${base}.json`, "utf8"));
  const segs = json.transcription || [];
  const text = segs.map((s) => s.text).join(" ").trim();
  const words = text.split(/\s+/).filter(Boolean).length;
  const spoken = segs.reduce((acc, s) => acc + (s.offsets.to - s.offsets.from) / 1000, 0);
  return {
    language: json.result?.language ?? null,
    words,
    words_per_min_spoken: spoken ? round((words * 60) / spoken, 0) : null,
    speech_share_of_runtime: null, // filled by the caller, which knows the duration
    spoken_s: round(spoken, 1),
    first_line: segs[0]?.text?.trim() ?? null,
  };
}

// Brightness and saturation per sampled frame, from ffmpeg signalstats (YUV, 8-bit scale).
function colour(video, duration) {
  const step = Math.max(duration / 24, 0.5);
  const r = run("ffmpeg", [
    "-hide_banner", "-nostats", "-i", video, "-an",
    "-vf", `fps=1/${step.toFixed(3)},scale=160:-2,signalstats,metadata=print`,
    "-f", "null", "-",
  ]);
  const y = [];
  const sat = [];
  const hue = [];
  for (const line of r.stderr.toString().split("\n")) {
    let m = line.match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
    if (m) y.push(Number(m[1]));
    m = line.match(/lavfi\.signalstats\.SATAVG=([\d.]+)/);
    if (m) sat.push(Number(m[1]));
    m = line.match(/lavfi\.signalstats\.HUEAVG=([\d.]+)/);
    if (m) hue.push(Number(m[1]));
  }
  const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return {
    brightness_0_255: round(avg(y), 0),
    saturation_0_181: round(avg(sat), 0),
    samples: y.length,
  };
}

function extractFrames(video, cuts, duration, outDir, maxFrames) {
  mkdirSync(outDir, { recursive: true });
  // The hook gets 3 frames; the rest spread over the shots, one per shot middle.
  const times = new Set([0.5, 1.5, 3.0].filter((t) => t < duration));
  const bounds = [0, ...cuts, duration];
  const mids = [];
  for (let i = 1; i < bounds.length; i++) mids.push((bounds[i - 1] + bounds[i]) / 2);
  const stride = Math.max(1, Math.ceil(mids.length / Math.max(1, maxFrames - times.size)));
  for (let i = 0; i < mids.length && times.size < maxFrames; i += stride) times.add(round(mids[i], 2));
  // Few shots (one long take): spread the rest evenly so captions and zooms are still visible.
  const spare = maxFrames - times.size;
  for (let k = 1; k <= spare; k++) times.add(round(5 + ((duration - 5) * k) / (spare + 1), 2));
  const list = [...times].sort((a, b) => a - b);
  const files = [];
  list.forEach((t, i) => {
    const file = join(outDir, `frame_${String(i + 1).padStart(2, "0")}_${t.toFixed(1)}s.jpg`);
    run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", file]);
    files.push({ t, file });
  });
  return files;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.video) {
    console.log("Usage: node measure-style.mjs <video> [--out DIR] [--threshold 0.3] [--whisper-model PATH] [--frames 12]");
    process.exit(args.help ? 0 : 2);
  }
  const video = resolve(args.video);
  if (!existsSync(video)) throw new Error(`File not found: ${video}`);
  const out = resolve(args.out || `style-${basename(video).replace(/\.[^.]+$/, "")}`);
  mkdirSync(out, { recursive: true });
  const work = join(out, ".work");
  mkdirSync(work, { recursive: true });

  const info = probe(video);
  const { cuts, threshold, stepped } = findCuts(video, info.duration, args.threshold);
  const pace = { ...pacing(cuts, info.duration), scene_threshold: threshold };
  if (stepped) pace.threshold_note = `No cuts at 0.3, so the threshold was lowered to ${threshold}: the reference changes scenes with soft transitions (fades, dissolves). Check the frames: fast camera moves can also pass this threshold.`;
  const audio = info.hasAudio ? loudness(video) : null;
  const beat = info.hasAudio ? tempo(decodeMono(video, 22050), 22050, cuts) : null;
  const sp = info.hasAudio ? speech(video, args.whisperModel, work) : null;
  if (sp && sp.spoken_s) sp.speech_share_of_runtime = round(sp.spoken_s / info.duration);
  const grade = colour(video, info.duration);
  const frames = extractFrames(video, cuts, info.duration, join(out, "frames"), args.frames);
  rmSync(work, { recursive: true, force: true });

  const style = {
    source: {
      duration_s: round(info.duration, 1),
      aspect: aspectLabel(info.width, info.height),
      resolution: `${info.width}x${info.height}`,
      fps: round(info.fps, 2),
      measured_with: VERSION,
      measured_at: new Date().toISOString(),
      note: "Measurements only. No footage, music or voice from the reference is kept.",
    },
    pacing: pace,
    audio: audio && { ...audio, ...(beat ? { beat } : {}) },
    speech: sp,
    grade: { measured: grade, lut_hint: null },
    // Filled by Claude from the frames (see SKILL.md, step 3).
    captions: null,
    zoom: null,
    broll: null,
    transitions: null,
    hook: { cuts_0_5s: pace.hook_0_5s.cuts, pattern: null, title_card: null },
    frames: frames.map((f) => ({ t: f.t, file: f.file.slice(out.length + 1) })),
  };
  const file = join(out, "style.json");
  writeFileSync(file, JSON.stringify(style, null, 2) + "\n");
  console.log(JSON.stringify({ ok: true, style: file, frames: frames.length, cuts: pace.cuts, cuts_per_min: pace.cuts_per_min }));
}

try {
  main();
} catch (err) {
  console.error(`measure-style: ${err.message}`);
  process.exit(1);
}

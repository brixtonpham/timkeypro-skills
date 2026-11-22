// Finding the command-line tools the skill scripts need. Claude Desktop starts extensions with a short
// PATH (on macOS often without Homebrew), so the usual install folders are added before anything runs.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { HOME, ROOT } from "./paths.mjs";

const WIN = process.platform === "win32";

export const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin";
export const MODEL_DIRS = [join(HOME, ".cache", "whisper-cpp"), join(ROOT, "models")];

function extraPathDirs() {
  const dirs = [join(ROOT, "bin"), join(ROOT, "whisper"), join(ROOT, "whisper", "Release")];
  if (WIN) {
    const local = process.env.LOCALAPPDATA || join(HOME, "AppData", "Local");
    dirs.push(join(local, "Microsoft", "WinGet", "Links"), join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"));
    if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, "npm"));
  } else {
    dirs.push("/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", join(HOME, ".volta", "bin"), join(HOME, ".local", "share", "mise", "shims"));
  }
  return dirs;
}

/** Add the usual install folders to PATH once, for this process and every child it starts. */
export function augmentPath() {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  const current = (process.env[key] || "").split(delimiter).filter(Boolean);
  const add = extraPathDirs().filter((d) => !current.includes(d) && existsSync(d));
  process.env[key] = [...current, ...add].join(delimiter);
}

/** Full path of a command on PATH, or null. */
export function which(cmd) {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
  const exts = WIN ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";").map((e) => e.toLowerCase()) : [""];
  for (const dir of (process.env[key] || "").split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const p = join(dir, cmd + ext);
      try {
        if (statSync(p).isFile()) return p;
      } catch {}
    }
  }
  return null;
}

function firstLine(cmd, args) {
  // .cmd files (npx on Windows) only start through a shell; quote the path, it may hold spaces.
  const viaShell = WIN && /\.(cmd|bat)$/i.test(cmd);
  const r = spawnSync(viaShell ? `"${cmd}"` : cmd, args, { encoding: "utf8", timeout: 15000, shell: viaShell });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || r.stderr || "").trim().split(/\r?\n/)[0] || null;
}

export function findModels() {
  const models = [];
  for (const dir of MODEL_DIRS) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/^ggml-.*\.bin$/i.test(f)) continue;
      const p = join(dir, f);
      const size = statSync(p).size;
      // A partly downloaded model is much smaller than the real one (the turbo q5_0 model is ~550 MB).
      models.push({ path: p, size_mb: Math.round(size / 1e6), looks_complete: size > 30e6 });
    }
  }
  return models;
}

const INSTALL = {
  node: { macos: "brew install node", windows: "winget install OpenJS.NodeJS.LTS" },
  ffmpeg: { macos: "brew install ffmpeg", windows: "winget install Gyan.FFmpeg" },
  whisper_cli: {
    macos: "brew install whisper-cpp",
    windows:
      "Download whisper-bin-x64.zip from https://github.com/ggml-org/whisper.cpp/releases and unzip it to %USERPROFILE%\\TimKeyPro\\whisper",
  },
  whisper_model: {
    macos: `mkdir -p ~/.cache/whisper-cpp && curl -L -o ~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin ${MODEL_URL}`,
    windows: `New-Item -ItemType Directory -Force "$HOME\\.cache\\whisper-cpp"; curl.exe -L -o "$HOME\\.cache\\whisper-cpp\\ggml-large-v3-turbo-q5_0.bin" ${MODEL_URL}`,
  },
};

export function checkTools() {
  const tool = (cmd, args, install, neededFor) => {
    const path = which(cmd);
    return { found: Boolean(path), path, version: path ? firstLine(path, args) : null, needed_for: neededFor, install };
  };
  const models = findModels();
  const report = {
    platform: process.platform,
    server_runtime: {
      node: process.version,
      bundled_with_claude: Boolean(process.versions.electron),
    },
    node: tool("node", ["--version"], INSTALL.node, "npx (the CapCut step downloads capcut-cli with npx)"),
    npx: tool("npx", ["--version"], INSTALL.node, "apply_style (runs capcut-cli@0.35.0)"),
    ffmpeg: tool("ffmpeg", ["-version"], INSTALL.ffmpeg, "measure_style and apply_style"),
    ffprobe: tool("ffprobe", ["-version"], INSTALL.ffmpeg, "measure_style and apply_style"),
    whisper_cli: tool("whisper-cli", ["--help"], INSTALL.whisper_cli, "speech measurement and automatic captions (optional)"),
    whisper_model: {
      found: models.some((m) => m.looks_complete),
      models,
      searched: MODEL_DIRS,
      size_note: "ggml-large-v3-turbo-q5_0.bin is about 550 MB",
      needed_for: "speech measurement and automatic captions (optional)",
      install: INSTALL.whisper_model,
    },
    folders: { styles: join(ROOT, "styles"), work: join(ROOT, "work") },
  };
  // whisper-cli --help exits non-zero on some builds: being found is enough.
  if (report.whisper_cli.found && !report.whisper_cli.version) report.whisper_cli.version = "found";
  report.ready = {
    measure_style: report.ffmpeg.found && report.ffprobe.found,
    apply_style: report.ffmpeg.found && report.ffprobe.found && report.npx.found,
    captions_from_voice: report.whisper_cli.found && report.whisper_model.found,
  };
  return report;
}

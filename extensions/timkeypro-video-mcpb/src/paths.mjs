// Path rules for every tool. Inputs must be absolute paths (or start with ~) to an existing file
// or folder of the expected kind. Everything the server writes goes under ~/TimKeyPro.
import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const HOME = homedir();
export const ROOT = join(HOME, "TimKeyPro");
export const STYLES = join(ROOT, "styles");
export const WORK = join(ROOT, "work");

export const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"];
export const AUDIO_EXT = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ...VIDEO_EXT];
export const PHOTO_EXT = [".jpg", ".jpeg", ".png", ".webp"];

export class PathError extends Error {}

function expandUser(p) {
  if (p === "~") return HOME;
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(HOME, p.slice(2));
  return p;
}

function real(p) {
  try {
    return realpathSync.native(p);
  } catch {
    return resolve(p);
  }
}

/** True when `p` is `root` or inside it, after following symlinks. */
export function isInside(p, root) {
  const rel = relative(real(root), real(p));
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/**
 * Check one input path the user gave.
 * kind: "file" | "dir" | "any"; exts: allowed extensions for files (lower case, with the dot).
 */
export function inputPath(value, label, { kind = "file", exts = null } = {}) {
  if (typeof value !== "string" || !value.trim()) throw new PathError(`${label}: a path is required.`);
  if (value.includes("\0")) throw new PathError(`${label}: invalid path.`);
  const p = expandUser(value.trim());
  if (!isAbsolute(p)) {
    throw new PathError(
      `${label}: "${value}" is not an absolute path. Only absolute paths (for example /Users/you/Videos/clip.mp4 ` +
        `or C:\\Users\\you\\Videos\\clip.mp4) or files under ${ROOT} are accepted.`,
    );
  }
  const abs = resolve(p);
  if (!existsSync(abs)) throw new PathError(`${label}: not found: ${abs}`);
  const st = statSync(abs);
  if (kind === "dir" && !st.isDirectory()) throw new PathError(`${label}: ${abs} is not a folder.`);
  if (kind === "file" && !st.isFile()) throw new PathError(`${label}: ${abs} is not a file.`);
  if (st.isFile() && exts && !exts.includes(extname(abs).toLowerCase())) {
    throw new PathError(`${label}: ${abs} is not one of the accepted file types (${exts.join(" ")}).`);
  }
  return abs;
}

/** A folder the server made under ~/TimKeyPro/work (returned by measure_style). */
export function workDirPath(value, label) {
  const abs = inputPath(value, label, { kind: "dir" });
  if (!isInside(abs, WORK) || real(abs) === real(WORK)) {
    throw new PathError(`${label}: ${abs} is outside ${WORK}. Only folders made by measure_style can be removed.`);
  }
  return abs;
}

/** "Kể chuyện nhanh!" -> "ke-chuyen-nhanh" */
export function slugify(name, label = "name") {
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  if (!slug) throw new PathError(`${label}: use at least one letter or digit.`);
  return slug;
}

export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

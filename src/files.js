const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const DOWNLOADS_DIR = path.join(__dirname, "..", "downloads");

const VIDEO_EXTS = [".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".flv"];
const AUDIO_EXTS = [".mp3", ".m4a", ".aac", ".opus", ".ogg", ".wav", ".flac", ".wma"];

function ensureDownloadsDir() {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

function fileTypeOf(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (VIDEO_EXTS.includes(ext)) return "video";
  if (AUDIO_EXTS.includes(ext)) return "audio";
  return "file";
}

function isListableMediaFile(filename) {
  if (filename.startsWith(".")) return false;
  if (filename.endsWith(".part") || filename.endsWith(".ytdl")) return false;
  if (/\.[fy]\d+\./.test(filename)) return false;
  return fileTypeOf(filename) === "video" || fileTypeOf(filename) === "audio";
}

function safeSegmentPath(baseDir, name) {
  if (typeof name !== "string" || name.length === 0) return null;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return null;
  const base = path.basename(name);
  if (base !== name || base === "." || base === "..") return null;
  const root = path.resolve(baseDir);
  const abs = path.resolve(root, base);
  if (abs === root || !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function safeItemPath(folderName) {
  return safeSegmentPath(DOWNLOADS_DIR, folderName);
}

function safeMediaPath(folderName, filename) {
  const dir = safeSegmentPath(DOWNLOADS_DIR, folderName);
  if (!dir) return null;
  return safeSegmentPath(dir, filename);
}

async function listItems() {
  ensureDownloadsDir();
  const entries = await fsp.readdir(DOWNLOADS_DIR, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(DOWNLOADS_DIR, entry.name);
    let fileEntries;
    try {
      fileEntries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    let size = 0;
    let hasVideo = false;
    let hasAudio = false;
    let latest = null;
    for (const fe of fileEntries) {
      if (!fe.isFile() || !isListableMediaFile(fe.name)) continue;
      const stat = await fsp.stat(path.join(dir, fe.name));
      size += stat.size;
      if (fileTypeOf(fe.name) === "video") hasVideo = true;
      else hasAudio = true;
      if (!latest || stat.mtime > latest) latest = stat.mtime;
    }
    if (!latest) continue;
    items.push({
      folder: entry.name,
      title: entry.name,
      hasVideo,
      hasAudio,
      size,
      modified: latest.toISOString(),
    });
  }
  items.sort((a, b) => new Date(b.modified) - new Date(a.modified));
  return items;
}

async function getItem(folderName) {
  const dir = safeItemPath(folderName);
  if (!dir) return null;
  let fileEntries;
  try {
    fileEntries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  const files = [];
  for (const fe of fileEntries) {
    if (!fe.isFile() || !isListableMediaFile(fe.name)) continue;
    const stat = await fsp.stat(path.join(dir, fe.name));
    files.push({
      name: fe.name,
      size: stat.size,
      modified: stat.mtime.toISOString(),
      type: fileTypeOf(fe.name),
    });
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  let info = null;
  try {
    info = await fsp.readFile(path.join(dir, "INFO.md"), "utf8");
  } catch {
    info = null;
  }
  let script = null;
  try {
    script = JSON.parse(await fsp.readFile(path.join(dir, "script.json"), "utf8"));
  } catch {
    script = null;
  }
  return { folder: folderName, title: folderName, files, info, script };
}

async function deleteItem(folderName) {
  const dir = safeItemPath(folderName);
  if (!dir) return { error: 400 };
  if (!fs.existsSync(dir)) return { error: 404 };
  await fsp.rm(dir, { recursive: true });
  return { ok: true };
}

function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function formatTimestamp(seconds) {
  const s = Math.floor(Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function buildInfoMd({ title, url, uploader, duration, uploadDate, quality, note, downloadedAt, files }) {
  const lines = [`# ${title}`, ""];
  if (url) lines.push(`- 원본 URL: ${url}`);
  if (uploader) lines.push(`- 채널: ${uploader}`);
  const durationText = formatDuration(duration);
  if (durationText) lines.push(`- 길이: ${durationText}`);
  if (uploadDate) lines.push(`- 업로드일: ${uploadDate}`);
  if (quality) lines.push(`- 화질: ${quality}`);
  if (note) lines.push(`- 비고: ${note}`);
  lines.push(`- 다운로드일: ${downloadedAt || new Date().toISOString().slice(0, 10)}`);
  if (files && files.length > 0) {
    lines.push("", "## 파일", "");
    for (const f of files) lines.push(`- \`${f.name}\` (${formatSize(f.size)})`);
  }
  lines.push("");
  return lines.join("\n");
}

async function migrateLegacyFiles() {
  ensureDownloadsDir();
  const entries = await fsp.readdir(DOWNLOADS_DIR, { withFileTypes: true });
  let migrated = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !isListableMediaFile(entry.name)) continue;
    const ext = path.extname(entry.name);
    const title = entry.name.slice(0, -ext.length).trim() || entry.name;
    const folder = path.join(DOWNLOADS_DIR, title);
    if (fs.existsSync(folder)) {
      console.warn(`[마이그레이션 생략] 같은 이름의 폴더가 이미 있습니다: ${title}`);
      continue;
    }
    const source = path.join(DOWNLOADS_DIR, entry.name);
    const stat = await fsp.stat(source);
    const targetName = (fileTypeOf(entry.name) === "video" ? "video" : "audio") + ext.toLowerCase();
    await fsp.mkdir(folder);
    await fsp.rename(source, path.join(folder, targetName));
    const content = buildInfoMd({
      title,
      note: "폴더 구조 적용 이전에 다운로드되어 원본 URL을 알 수 없습니다.",
      downloadedAt: stat.mtime.toISOString().slice(0, 10),
      files: [{ name: targetName, size: stat.size }],
    });
    await fsp.writeFile(path.join(folder, "INFO.md"), content, "utf8");
    migrated += 1;
    console.log(`[마이그레이션] ${entry.name} → ${title}/${targetName}`);
  }
  return migrated;
}

module.exports = {
  DOWNLOADS_DIR,
  VIDEO_EXTS,
  AUDIO_EXTS,
  ensureDownloadsDir,
  fileTypeOf,
  isListableMediaFile,
  safeItemPath,
  safeMediaPath,
  listItems,
  getItem,
  deleteItem,
  buildInfoMd,
  migrateLegacyFiles,
  formatDuration,
  formatTimestamp,
};

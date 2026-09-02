const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { DOWNLOADS_DIR, buildInfoMd, isListableMediaFile } = require("./files");

const jobs = new Map();
const queue = [];
let currentJobId = null;

const deps = { ytDlp: null, ffmpeg: null };

const PROGRESS_PREFIX = "@PROG|";
const POSTPROCESS_PREFIX = "@POSTPROC|";
const META_PREFIX = "@META\t";
const DOWNLOAD_TEMPLATE =
  "download:@PROG|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s";
const POSTPROCESS_TEMPLATE = "postprocess:@POSTPROC|%(progress.status)s";
const META_PRINT =
  "before_dl:@META\t%(webpage_url)s\t%(uploader)s\t%(duration)s\t%(upload_date)s";

function runCheck(cmd, args) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      resolve(null);
      return;
    }
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", (code) => resolve(code === 0 ? out.split("\n")[0].trim() : null));
  });
}

async function checkDependencies() {
  deps.ytDlp = await runCheck("yt-dlp", ["--version"]);
  deps.ffmpeg = await runCheck("ffmpeg", ["-version"]);
  return deps;
}

function startDownload(url, type, quality = "best") {
  const job = {
    id: crypto.randomUUID(),
    url,
    type,
    quality,
    status: "waiting",
    phase: "prepare",
    step: null,
    progress: 0,
    downloadedBytes: 0,
    totalBytes: null,
    speed: null,
    eta: null,
    filename: null,
    folder: null,
    meta: null,
    error: null,
    message: null,
    alreadyDownloaded: false,
    lastFileFinished: false,
    files: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(job.id, job);
  queue.push(job.id);
  processQueue();
  return job;
}

function getJob(id) {
  return jobs.get(id) || null;
}

function getQueuePosition(job) {
  const index = queue.indexOf(job.id);
  return index === -1 ? null : index + 1;
}

function processQueue() {
  if (currentJobId !== null || queue.length === 0) return;
  currentJobId = queue.shift();
  runJob(jobs.get(currentJobId));
}

function makeLineHandler(onLine) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString();
    let index;
    while ((index = buffer.search(/[\r\n]/)) !== -1) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.trim()) onLine(line);
    }
  };
}

function baseArgs() {
  return [
    "--newline",
    "--no-playlist",
    "--no-overwrites",
    "--windows-filenames",
    "--progress",
    "--progress-template", DOWNLOAD_TEMPLATE,
    "--progress-template", POSTPROCESS_TEMPLATE,
    "--print", META_PRINT,
    "--print", "after_move:filepath",
  ];
}

async function runJob(job) {
  job.status = "downloading";
  job.phase = "prepare";
  job.startedAt = new Date().toISOString();
  job.alreadyDownloaded = true;

  const videoOut = path.join(DOWNLOADS_DIR, "%(title)s", "video.%(ext)s");
  const audioOut = path.join(DOWNLOADS_DIR, "%(title)s", "audio.%(ext)s");

  try {
    if (job.type === "video") {
      job.step = "video";
      job.message = "영상 다운로드 중...";
      const height = parseInt(job.quality, 10);
      const format = Number.isFinite(height) && height > 0
        ? `bv*[height<=${height}]+ba/b[height<=${height}]`
        : "bv*+ba/b";
      resetStepProgress(job);
      const videoResult = await runYtDlp(job, [...baseArgs(), "-f", format, "--merge-output-format", "mp4", "-o", videoOut, job.url]);
      job.alreadyDownloaded = job.alreadyDownloaded && !videoResult.downloaded;
      job.step = "audio";
      job.message = "음성 다운로드 중...";
      resetStepProgress(job);
      const audioResult = await runYtDlp(job, [...baseArgs(), "-x", "--audio-format", "mp3", "-o", audioOut, job.url]);
      job.alreadyDownloaded = job.alreadyDownloaded && !audioResult.downloaded;
    } else {
      job.step = "audio";
      job.message = "음성 다운로드 중...";
      resetStepProgress(job);
      const audioResult = await runYtDlp(job, [...baseArgs(), "-x", "--audio-format", "mp3", "-o", audioOut, job.url]);
      job.alreadyDownloaded = job.alreadyDownloaded && !audioResult.downloaded;
    }
    job.message = "정보 파일 생성 중...";
    await writeInfoFile(job);
    finishJob(job, "completed", {
      message: job.alreadyDownloaded ? "이미 다운로드되어 있는 항목입니다." : null,
    });
  } catch (err) {
    finishJob(job, "failed", { error: (err && err.message) || "다운로드에 실패했습니다." });
  }
}

function resetStepProgress(job) {
  job.files = [];
  job.lastFileFinished = false;
  job.progress = 0;
  job.downloadedBytes = 0;
  job.totalBytes = null;
  job.speed = null;
  job.eta = null;
}

function runYtDlp(job, args) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("yt-dlp", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    } catch (err) {
      reject(new Error(spawnErrorMessage(err)));
      return;
    }

    let lastErrorLine = null;
    const run = { sawDownloading: false };
    const root = path.resolve(DOWNLOADS_DIR) + path.sep;

    const onStdoutLine = (line) => {
      if (line.startsWith("ERROR:")) {
        lastErrorLine = line;
        return;
      }

      if (line.startsWith(META_PREFIX)) {
        handleMetaLine(job, line);
        return;
      }

      if (line.startsWith(PROGRESS_PREFIX)) {
        handleProgressLine(job, line, run);
        return;
      }

      if (!line.startsWith("[")) {
        const abs = path.resolve(line.trim());
        if (abs.startsWith(root) && fs.existsSync(abs)) {
          job.folder = path.dirname(abs);
          job.filename = path.basename(job.folder);
        }
      }
    };

    const onStderrLine = (line) => {
      if (line.startsWith("ERROR:")) {
        lastErrorLine = line;
        return;
      }
      if (line.startsWith(POSTPROCESS_PREFIX) && line.slice(POSTPROCESS_PREFIX.length).trim() === "started") {
        job.phase = "postprocess";
        job.message = "후처리 중...";
      }
    };

    child.stdout.on("data", makeLineHandler(onStdoutLine));
    child.stderr.on("data", makeLineHandler(onStderrLine));

    child.on("error", (err) => {
      reject(new Error(spawnErrorMessage(err)));
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ downloaded: run.sawDownloading });
      } else {
        reject(new Error(mapError(lastErrorLine)));
      }
    });
  });
}

function parseNumber(value) {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function handleMetaLine(job, line) {
  const fields = line.slice(META_PREFIX.length).split("\t");
  const duration = parseNumber(fields[2]);
  const rawDate = fields[3] && fields[3] !== "NA" ? String(fields[3]).trim() : "";
  job.meta = {
    url: fields[0] && fields[0] !== "NA" ? fields[0] : null,
    uploader: fields[1] && fields[1] !== "NA" ? fields[1] : null,
    duration,
    uploadDate: /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : null,
  };
}

function handleProgressLine(job, line, run) {
  const fields = line.slice(PROGRESS_PREFIX.length).split("|");
  const status = (fields[0] || "").trim();
  const downloaded = parseNumber(fields[1]);
  const totalBytes = parseNumber(fields[2]);
  const totalEstimate = parseNumber(fields[3]);
  const speed = parseNumber(fields[4]);
  const eta = parseNumber(fields[5]);

  job.speed = speed;
  job.eta = eta;
  job.phase = "downloading";

  if (status === "finished") {
    if (job.files.length === 0) job.files.push({ downloaded: 0, total: null });
    const file = job.files[job.files.length - 1];
    if (file.total == null && totalBytes != null) file.total = totalBytes;
    if (file.total != null) file.downloaded = file.total;
    else if (downloaded != null) file.downloaded = downloaded;
    job.lastFileFinished = true;
    updateTotals(job);
    return;
  }

  run.sawDownloading = true;
  if (job.lastFileFinished) {
    job.files.push({ downloaded: 0, total: null });
    job.lastFileFinished = false;
  }
  if (job.files.length === 0) job.files.push({ downloaded: 0, total: null });
  const file = job.files[job.files.length - 1];
  if (downloaded != null) file.downloaded = downloaded;
  if (totalBytes != null) file.total = totalBytes;
  else if (totalEstimate != null && file.total == null) file.total = totalEstimate;
  updateTotals(job);
}

function updateTotals(job) {
  let sumDownloaded = 0;
  let sumTotal = 0;
  let known = job.files.length > 0;
  for (const f of job.files) {
    sumDownloaded += f.downloaded || 0;
    if (f.total == null) known = false;
    else sumTotal += f.total;
  }
  job.downloadedBytes = sumDownloaded;
  job.totalBytes = known ? sumTotal : null;
  if (known && sumTotal > 0) {
    job.progress = Math.min(100, Math.round((sumDownloaded / sumTotal) * 100));
  }
}

async function writeInfoFile(job) {
  if (!job.folder) return;
  const infoPath = path.join(job.folder, "INFO.md");
  if (job.alreadyDownloaded && fs.existsSync(infoPath)) return;
  const names = (await fsp.readdir(job.folder)).filter((n) => isListableMediaFile(n)).sort();
  const files = [];
  for (const name of names) {
    const stat = await fsp.stat(path.join(job.folder, name));
    files.push({ name, size: stat.size });
  }
  const content = buildInfoMd({
    title: path.basename(job.folder),
    url: (job.meta && job.meta.url) || job.url,
    uploader: job.meta && job.meta.uploader,
    duration: job.meta && job.meta.duration,
    uploadDate: job.meta && job.meta.uploadDate,
    quality: qualityLabel(job),
    files,
  });
  await fsp.writeFile(path.join(job.folder, "INFO.md"), content, "utf8");
}

function qualityLabel(job) {
  if (job.type === "audio") return "음성만 (MP3)";
  const height = parseInt(job.quality, 10);
  if (Number.isFinite(height) && height > 0) return `${height}p (MP4 + MP3)`;
  return "최고 화질 (MP4 + MP3)";
}

function finishJob(job, status, extra = {}) {
  if (job.status === "completed" || job.status === "failed") return;
  job.status = status;
  if (status === "completed") job.progress = 100;
  Object.assign(job, extra);
  job.finishedAt = new Date().toISOString();
  if (currentJobId === job.id) currentJobId = null;
  processQueue();
}

function spawnErrorMessage(err) {
  if (err && err.code === "ENOENT") {
    return "yt-dlp 실행 파일을 찾을 수 없습니다. yt-dlp 설치 후 다시 시도해 주세요.";
  }
  return `yt-dlp 실행 오류: ${err && err.message ? err.message : "알 수 없는 오류"}`;
}

function mapError(line) {
  if (!line) return "다운로드에 실패했습니다.";
  const text = line.replace(/^ERROR:\s*/, "").trim();
  if (/is not a valid URL|unable to parse/i.test(text)) return "잘못된 URL 형식입니다.";
  if (/unsupported url/i.test(text)) return "지원하지 않는 사이트 또는 URL입니다.";
  if (/video unavailable|removed by the uploader|has been removed/i.test(text)) {
    return "재생할 수 없거나 삭제된 영상입니다.";
  }
  if (/ffmpeg/i.test(text)) return "ffmpeg가 설치되어 있지 않아 처리하지 못했습니다. ffmpeg를 설치해 주세요.";
  if (/timed out|connection|network|unable to download/i.test(text)) {
    return "네트워크 오류로 다운로드에 실패했습니다.";
  }
  if (/private video|members-only|sign in|log in|login required/i.test(text)) {
    return "접근이 제한된 콘텐츠이거나 로그인이 필요합니다.";
  }
  if (/too many requests|429|rate limit/i.test(text)) {
    return "요청이 많아 일시적으로 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return text.length > 200 ? `${text.slice(0, 200)}...` : text;
}

module.exports = {
  deps,
  checkDependencies,
  startDownload,
  getJob,
  getQueuePosition,
  mapError,
  makeLineHandler,
  spawnErrorMessage,
};

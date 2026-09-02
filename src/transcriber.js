const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { safeItemPath, fileTypeOf, formatTimestamp } = require("./files");

const jobs = new Map();
let currentJobId = null;

const VENV_PYTHON = path.join(__dirname, "..", ".venv-whisper", "bin", "python3");
const VENV_MODULE = "mlx_whisper.cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL || "mlx-community/whisper-small-mlx";
const TRANSCRIBE_TIMEOUT = 30 * 60 * 1000;

const deps = { engine: null, command: null, module: null, model: WHISPER_MODEL };

function commandModuleArgs(module) {
  return module ? ["-m", module] : [];
}

function commandWorks(command, module) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, [...commandModuleArgs(module), "--help"], {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } catch {
      resolve(false);
      return;
    }
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function checkTranscriber() {
  const candidates = [
    { engine: "mlx_whisper", command: process.env.WHISPER_COMMAND || "mlx_whisper", module: null },
    { engine: "mlx_whisper", command: VENV_PYTHON, module: VENV_MODULE },
    { engine: "openai_whisper", command: "whisper", module: null },
  ];
  for (const candidate of candidates) {
    if (await commandWorks(candidate.command, candidate.module)) {
      deps.engine = candidate.engine;
      deps.command = candidate.command;
      deps.module = candidate.module;
      return deps;
    }
  }
  deps.engine = null;
  deps.command = null;
  deps.module = null;
  return deps;
}

async function findMediaFile(dir) {
  const names = await fsp.readdir(dir);
  const audio = names.find((n) => fileTypeOf(n) === "audio") || names.find((n) => /^audio\.[a-z0-9]+$/i.test(n));
  if (audio) return audio;
  const video = names.find((n) => fileTypeOf(n) === "video");
  return video || null;
}

async function startTranscribe(folderName) {
  const dir = safeItemPath(folderName);
  if (!dir) return { error: 400, message: "잘못된 요청입니다." };
  if (!fs.existsSync(dir)) return { error: 404, message: "항목이 존재하지 않습니다." };
  const mediaName = await findMediaFile(dir);
  if (!mediaName) return { error: 400, message: "이 항목에는 변환할 미디어 파일이 없습니다." };
  if (!deps.engine) {
    return {
      error: 400,
      message: "Whisper 엔진을 찾을 수 없습니다. README의 설치 안내를 참고해 주세요.",
    };
  }
  if (currentJobId) return { error: 409, message: "이미 스크립트 변환 작업이 진행 중입니다." };

  const job = {
    id: crypto.randomUUID(),
    folder: folderName,
    mediaFile: mediaName,
    status: "transcribing",
    startedAt: new Date().toISOString(),
    error: null,
  };
  jobs.set(job.id, job);
  currentJobId = job.id;
  runTranscribe(job, dir, mediaName);
  return { job };
}

function getJob(id) {
  return jobs.get(id) || null;
}

async function runTranscribe(job, dir, mediaName) {
  const mediaPath = path.join(dir, mediaName);
  let tmpDir = null;
  try {
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), "ytr-whisper-"));
    await runEngine(mediaPath, tmpDir);
    const data = await readEngineOutput(tmpDir);
    const segments = parseSegments(data);
    if (!segments) {
      throw new Error("스크립트를 추출하지 못했습니다. (음성이 너무 짧거나 말이 없을 수 있습니다)");
    }
    const script = {
      engine: deps.engine,
      model: WHISPER_MODEL,
      language: data && data.language ? data.language : null,
      generatedAt: new Date().toISOString(),
      segments,
    };
    await fsp.writeFile(path.join(dir, "script.json"), JSON.stringify(script, null, 2), "utf8");
    await fsp.writeFile(path.join(dir, "SCRIPT.md"), buildScriptMd(script, path.basename(dir)), "utf8");
    job.status = "completed";
  } catch (err) {
    job.status = "failed";
    job.error = (err && err.message) || "스크립트 변환에 실패했습니다.";
  } finally {
    if (tmpDir) {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    if (currentJobId === job.id) currentJobId = null;
  }
}

function engineArgs(engine, mediaPath, outDir) {
  if (engine === "openai_whisper") {
    const shortModel = WHISPER_MODEL.replace(/^.*\//, "").replace(/-mlx.*$/, "");
    return [mediaPath, "--model", shortModel, "--output_dir", outDir, "--output_format", "json"];
  }
  return [
    mediaPath,
    "--model", WHISPER_MODEL,
    "--output-dir", outDir,
    "--output-name", "transcript",
    "--output-format", "json",
  ];
}

function runEngine(mediaPath, outDir) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(deps.command, [
        ...commandModuleArgs(deps.module),
        ...engineArgs(deps.engine, mediaPath, outDir),
      ], {
        stdio: ["ignore", "ignore", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    } catch (err) {
      reject(new Error(spawnErrorMessage(err)));
      return;
    }

    const stderrLines = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TRANSCRIBE_TIMEOUT);

    child.stderr.on("data", (chunk) => {
      for (const line of chunk.toString().split(/\r?\n/)) {
        if (!line.trim() || isNoiseLine(line)) continue;
        stderrLines.push(line);
        if (stderrLines.length > 30) stderrLines.shift();
      }
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(spawnErrorMessage(err)));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error("변환이 너무 오래 걸려 중단했습니다."));
      } else if (code === 0) {
        resolve();
      } else {
        reject(new Error(mapTranscribeError(stderrLines)));
      }
    });
  });
}

function isNoiseLine(line) {
  if (/\d+%\|/.test(line)) return true;
  if (/^\[\d{2}:\d{2}/.test(line)) return true;
  if (/it\/s|B\/s|ETA/.test(line)) return true;
  return false;
}

async function readEngineOutput(tmpDir) {
  const names = await fsp.readdir(tmpDir);
  const jsonName = names.find((n) => n.endsWith(".json"));
  if (!jsonName) throw new Error("변환 결과 파일을 찾지 못했습니다.");
  const raw = await fsp.readFile(path.join(tmpDir, jsonName), "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("변환 결과를 해석하지 못했습니다.");
  }
}

function parseSegments(data) {
  if (!data || !Array.isArray(data.segments)) return null;
  const segments = [];
  for (const s of data.segments) {
    const start = Number(s.start);
    const end = Number(s.end);
    const text = String(s.text || "").trim();
    if (!Number.isFinite(start) || !Number.isFinite(end) || !text) continue;
    segments.push({ start, end, text });
  }
  return segments.length > 0 ? segments : null;
}

function buildScriptMd(script, title) {
  const lines = [`# 스크립트 — ${title}`, ""];
  lines.push(`- 엔진: ${script.engine} (${script.model})`);
  if (script.language) lines.push(`- 언어: ${script.language}`);
  lines.push(`- 생성일: ${script.generatedAt.slice(0, 10)}`);
  lines.push("", "## 내용", "");
  for (const seg of script.segments) {
    lines.push(`- **[${formatTimestamp(seg.start)}]** ${seg.text}`);
  }
  lines.push("");
  return lines.join("\n");
}

function spawnErrorMessage(err) {
  if (err && err.code === "ENOENT") {
    return "Whisper 실행 파일을 찾을 수 없습니다.";
  }
  return `Whisper 실행 오류: ${err && err.message ? err.message : "알 수 없는 오류"}`;
}

function mapTranscribeError(lines) {
  const last = lines[lines.length - 1];
  if (!last) return "스크립트 변환에 실패했습니다.";
  if (/ffmpeg/i.test(last)) return "ffmpeg 오류로 음성을 읽지 못했습니다.";
  if (/Invalid username|401|gated|authentication/i.test(last)) {
    return "Whisper 모델을 내려받지 못했습니다. WHISPER_MODEL 설정을 확인해 주세요.";
  }
  return last.length > 200 ? `${last.slice(0, 200)}...` : last;
}

module.exports = {
  deps,
  checkTranscriber,
  startTranscribe,
  getJob,
};

const fs = require("fs");
const path = require("path");
const express = require("express");
const files = require("./files");
const downloader = require("./downloader");
const inspector = require("./inspector");
const transcriber = require("./transcriber");
const annotations = require("./annotations");

const PORT = Number(process.env.PORT) || 3000;

function getUrl(body) {
  const { url } = body || {};
  if (typeof url !== "string" || !url.trim()) {
    return { error: "URL을 입력해 주세요." };
  }
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { error: "http 또는 https URL만 지원합니다." };
    }
  } catch {
    return { error: "올바른 URL 형식이 아닙니다." };
  }
  return { url: trimmed };
}

async function main() {
  files.ensureDownloadsDir();
  await files.migrateLegacyFiles();

  const deps = await downloader.checkDependencies();
  if (!deps.ytDlp) {
    console.error("[오류] yt-dlp를 찾을 수 없습니다. 설치 후 다시 실행해 주세요.");
    console.error("  macOS: brew install yt-dlp");
    console.error("  기타: https://github.com/yt-dlp/yt-dlp");
    process.exit(1);
  }
  console.log(`yt-dlp ${deps.ytDlp}`);
  if (!deps.ffmpeg) {
    console.warn("[경고] ffmpeg를 찾을 수 없습니다. 오디오 추출과 영상 병합에 필요합니다.");
    console.warn("  macOS: brew install ffmpeg");
  } else {
    console.log(`ffmpeg ${deps.ffmpeg}`);
  }

  await transcriber.checkTranscriber();
  if (transcriber.deps.engine) {
    console.log(`Whisper: ${transcriber.deps.engine} (${transcriber.deps.command}) · 모델 ${transcriber.deps.model}`);
  } else {
    console.warn("[경고] Whisper 엔진을 찾을 수 없습니다. 스크립트 추출을 사용할 수 없습니다.");
    console.warn("  설치: python3 -m venv .venv-whisper && .venv-whisper/bin/pip install mlx-whisper");
  }

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.post("/api/inspect", async (req, res) => {
    const urlCheck = getUrl(req.body);
    if (urlCheck.error) return res.status(400).json({ error: urlCheck.error });
    try {
      res.json(await inspector.inspect(urlCheck.url));
    } catch (err) {
      res.status(400).json({ error: err && err.message ? err.message : "영상 정보를 가져오지 못했습니다." });
    }
  });

  app.post("/api/download", (req, res) => {
    const { type, quality } = req.body || {};
    const urlCheck = getUrl(req.body);
    if (urlCheck.error) return res.status(400).json({ error: urlCheck.error });
    if (type !== "video" && type !== "audio") {
      return res.status(400).json({ error: "다운로드 형식은 video 또는 audio 중 하나입니다." });
    }
    let qualityValue = "best";
    if (quality != null) {
      if (typeof quality !== "string" || (quality !== "best" && !/^\d{1,4}$/.test(quality))) {
        return res.status(400).json({ error: "잘못된 화질 옵션입니다." });
      }
      qualityValue = quality;
    }
    if (type === "audio" && !downloader.deps.ffmpeg) {
      return res.status(400).json({ error: "ffmpeg가 설치되어 있지 않아 오디오 추출을 할 수 없습니다. brew install ffmpeg 로 설치해 주세요." });
    }
    const job = downloader.startDownload(urlCheck.url, type, qualityValue);
    res.status(202).json({ id: job.id, status: job.status });
  });

  app.get("/api/downloads", async (req, res, next) => {
    try {
      res.json(await files.listItems());
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/item/:folder", async (req, res, next) => {
    try {
      const item = await files.getItem(req.params.folder);
      if (!item) return res.status(404).json({ error: "항목을 찾을 수 없습니다." });
      res.json({
        ...item,
        annotations: await annotations.readAnnotations(req.params.folder),
        transcriber: { available: !!transcriber.deps.engine, engine: transcriber.deps.engine },
      });
    } catch (err) {
      next(err);
    }
  });

  app.post("/api/annotations", async (req, res) => {
    const { folder } = req.body || {};
    if (typeof folder !== "string" || !folder.trim()) {
      return res.status(400).json({ error: "폴더를 지정해 주세요." });
    }
    const result = await annotations.addAnnotation({ ...req.body, folder: folder.trim() });
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.status(201).json({ annotation: result.annotation });
  });

  app.delete("/api/annotations", async (req, res) => {
    const { folder, id } = req.body || {};
    if (typeof folder !== "string" || !folder.trim() || typeof id !== "string" || !id.trim()) {
      return res.status(400).json({ error: "폴더와 주석 id를 지정해 주세요." });
    }
    const result = await annotations.removeAnnotation({ folder: folder.trim(), id: id.trim() });
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.json({ ok: true });
  });

  app.post("/api/transcribe", async (req, res) => {
    const { folder } = req.body || {};
    if (typeof folder !== "string" || !folder.trim()) {
      return res.status(400).json({ error: "폴더를 지정해 주세요." });
    }
    const result = await transcriber.startTranscribe(folder.trim());
    if (result.error) return res.status(result.error).json({ error: result.message });
    res.status(202).json({ id: result.job.id, status: result.job.status });
  });

  app.get("/api/transcribe/:id", (req, res) => {
    const job = transcriber.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "해당 변환 작업을 찾을 수 없습니다." });
    res.json({
      id: job.id,
      folder: job.folder,
      status: job.status,
      error: job.error,
      startedAt: job.startedAt,
    });
  });

  app.get("/api/download/:id", (req, res) => {
    const job = downloader.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "해당 다운로드 작업을 찾을 수 없습니다." });
    res.json({
      id: job.id,
      status: job.status,
      phase: job.phase,
      progress: job.progress,
      downloadedBytes: job.downloadedBytes,
      totalBytes: job.totalBytes,
      speed: job.speed,
      eta: job.eta,
      type: job.type,
      filename: job.filename,
      error: job.error,
      message: job.message,
      queuePosition: downloader.getQueuePosition(job),
    });
  });

  app.delete("/api/downloads/:folder", async (req, res, next) => {
    try {
      const result = await files.deleteItem(req.params.folder);
      if (result.error === 400) return res.status(400).json({ error: "잘못된 요청입니다." });
      if (result.error === 404) return res.status(404).json({ error: "항목이 존재하지 않습니다." });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/media/:folder/:filename", (req, res) => {
    const abs = files.safeMediaPath(req.params.folder, req.params.filename);
    if (!abs) return res.status(400).json({ error: "잘못된 파일 요청입니다." });
    if (!fs.existsSync(abs)) return res.status(404).json({ error: "파일이 존재하지 않습니다." });
    res.sendFile(abs);
  });

  app.use((req, res) => {
    res.status(404).json({ error: "찾을 수 없는 경로입니다." });
  });

  app.use((err, req, res, next) => {
    if (err && err.type === "entity.parse.failed") {
      return res.status(400).json({ error: "잘못된 요청 본문입니다." });
    }
    console.error("[서버 오류]", err);
    res.status(500).json({ error: "서버 내부 오류가 발생했습니다." });
  });

  app.listen(PORT, () => {
    console.log(`YoutubeReader 실행 중: http://localhost:${PORT}`);
    console.log(`다운로드 폴더: ${files.DOWNLOADS_DIR}`);
  });
}

main();

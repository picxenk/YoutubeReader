const { spawn } = require("child_process");
const { mapError, makeLineHandler, spawnErrorMessage } = require("./downloader");

const INSPECT_TIMEOUT = 30000;
const MAX_QUALITY_OPTIONS = 8;

function inspect(url) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn("yt-dlp", ["-J", "--no-playlist", url], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    } catch (err) {
      reject(new Error(spawnErrorMessage(err)));
      return;
    }

    let stdout = "";
    let lastErrorLine = null;
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(reject, new Error("영상 정보를 가져오는 데 시간이 너무 오래 걸립니다."));
    }, INSPECT_TIMEOUT);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", makeLineHandler((line) => {
      if (line.startsWith("ERROR:")) lastErrorLine = line;
    }));

    child.on("error", (err) => settle(reject, new Error(spawnErrorMessage(err))));

    child.on("close", (code) => {
      if (code !== 0) {
        settle(reject, new Error(toInspectError(lastErrorLine)));
        return;
      }
      try {
        settle(resolve, buildInfo(JSON.parse(stdout)));
      } catch {
        settle(reject, new Error("영상 정보를 해석하지 못했습니다."));
      }
    });
  });
}

function toInspectError(line) {
  const message = mapError(line);
  if (message === "네트워크 오류로 다운로드에 실패했습니다.") {
    return "네트워크 오류로 영상 정보를 가져오지 못했습니다.";
  }
  if (message === "다운로드에 실패했습니다.") {
    return "영상 정보를 가져오지 못했습니다.";
  }
  return message;
}

function buildInfo(info) {
  const duration = info.duration || null;
  const formats = (info.formats || []).filter((f) => {
    if (!f.format_id) return false;
    if ((f.ext || "") === "mhtml") return false;
    if (String(f.format_note || "").includes("storyboard")) return false;
    const hasVideo = f.vcodec && f.vcodec !== "none";
    const hasAudio = f.acodec && f.acodec !== "none";
    return hasVideo || hasAudio;
  });

  const estimateSize = (f) => {
    if (!f) return null;
    if (f.filesize != null) return f.filesize;
    if (f.filesize_approx != null) return f.filesize_approx;
    if (f.tbr != null && duration) return Math.round((f.tbr * 1000 / 8) * duration);
    return null;
  };
  const sumSizes = (a, b) => (a == null || b == null ? null : a + b);

  const audioFormats = formats.filter((f) => (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none");
  const videoFormats = formats.filter((f) => f.vcodec && f.vcodec !== "none" && f.height);

  const audioRank = (f) => (String(f.acodec || "").startsWith("opus") ? 0 : 1);
  const bestAudio = audioFormats.length
    ? audioFormats.slice().sort((a, b) => audioRank(a) - audioRank(b) || (b.abr || b.tbr || 0) - (a.abr || a.tbr || 0))[0]
    : null;

  const VCODEC_ORDER = ["av01", "vp9", "h265", "h264", "vp8", "h263"];
  const vcodecKey = (f) => {
    const v = String(f.vcodec || "").split(".")[0];
    if (v === "avc1") return "h264";
    if (v === "vp09") return "vp9";
    return v;
  };
  const vcodecRank = (f) => {
    const index = VCODEC_ORDER.indexOf(vcodecKey(f));
    return index === -1 ? VCODEC_ORDER.length : index;
  };
  const score = (f) => (f.fps || 0) * 1e9 + (VCODEC_ORDER.length - vcodecRank(f)) * 1e6 + (f.tbr || 0);

  const byHeight = new Map();
  for (const f of videoFormats) {
    const current = byHeight.get(f.height);
    if (!current || score(f) > score(current)) byHeight.set(f.height, f);
  }
  const heights = [...byHeight.keys()].sort((a, b) => b - a).slice(0, MAX_QUALITY_OPTIONS);

  const options = [];
  for (const height of heights) {
    const f = byHeight.get(height);
    const progressive = f.acodec && f.acodec !== "none";
    const size = progressive ? estimateSize(f) : sumSizes(estimateSize(f), estimateSize(bestAudio));
    const fpsNote = f.fps && f.fps >= 50 ? `${Math.round(f.fps)}fps` : "";
    options.push({
      value: String(height),
      type: "video",
      label: fpsNote ? `${height}p ${fpsNote}` : `${height}p`,
      detail: "MP4 + MP3",
      size,
    });
  }

  if (options.length === 0) {
    options.push({ value: "best", type: "video", label: "자동 선택", detail: "MP4 + MP3", size: null });
  }

  options.push({
    value: "audio",
    type: "audio",
    label: "음성만",
    detail: "MP3",
    size: estimateSize(bestAudio),
  });

  return {
    title: info.title || "",
    uploader: info.uploader || info.channel || "",
    duration: info.duration || null,
    thumbnail: info.thumbnail || null,
    options,
  };
}

module.exports = { inspect };

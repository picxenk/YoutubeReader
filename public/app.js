const inspectForm = document.getElementById("inspect-form");
const urlInput = document.getElementById("url-input");
const inspectButton = document.getElementById("inspect-button");
const videoInfoEl = document.getElementById("video-info");
const videoThumbnail = document.getElementById("video-thumbnail");
const videoTitle = document.getElementById("video-title");
const videoSub = document.getElementById("video-sub");
const optionsEl = document.getElementById("options");
const downloadButton = document.getElementById("download-button");
const statusEl = document.getElementById("status");
const fileListEl = document.getElementById("file-list");
const fileCountEl = document.getElementById("file-count");
const tabButtons = document.querySelectorAll(".tab");
const tabDownloader = document.getElementById("tab-downloader");
const tabViewer = document.getElementById("tab-viewer");
const viewerEmpty = document.getElementById("viewer-empty");
const viewerContent = document.getElementById("viewer-content");
const selectionMenuEl = document.getElementById("selection-menu");
const selectionMenuActions = selectionMenuEl.querySelector(".selection-menu-actions");
const selectionMenuNote = selectionMenuEl.querySelector(".selection-menu-note");
const noteInput = document.getElementById("note-input");

const POLL_INTERVAL = 400;
const JOB_STORAGE_KEY = "currentJobId";
const SYNC_STORAGE_KEY = "syncScroll";

let currentJobId = sessionStorage.getItem(JOB_STORAGE_KEY);
let pollTimer = null;
let inspectedUrl = null;
let inspectedOptions = [];
let viewedFolder = null;
let viewedTitle = null;
let viewedAnnotations = [];
let selectedSegments = null;
let lastMenuPos = { x: 0, y: 0 };
let transcribeJobId = null;
let transcribeTimer = null;

const STATUS_LABEL = {
  waiting: "대기 중",
  downloading: "다운로드 중",
  completed: "완료",
  failed: "실패",
};

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value);
  return div.innerHTML;
}

function formatSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return null;
  return `${formatSize(bytesPerSecond)}/s`;
}

function formatEta(seconds) {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function formatTimestamp(seconds) {
  if (!Number.isFinite(seconds)) return "--:--";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function youtubeTimeUrl(sourceUrl, seconds) {
  if (!sourceUrl) return null;
  let u;
  try {
    u = new URL(sourceUrl);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (host !== "youtu.be" && !/(^|\.)youtube\.com$/.test(host)) return null;
  u.searchParams.set("t", `${Math.floor(Number(seconds) || 0)}s`);
  return u.toString();
}

function mediaUrl(folder, name) {
  return `/media/${encodeURIComponent(folder)}/${encodeURIComponent(name)}`;
}

function switchTab(name) {
  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  tabDownloader.classList.toggle("hidden", name !== "downloader");
  tabViewer.classList.toggle("hidden", name !== "viewer");
}

tabButtons.forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

inspectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const url = urlInput.value.trim();
  if (!url) {
    showStatusError("URL을 입력해 주세요.");
    return;
  }
  hideVideoInfo();
  inspectButton.disabled = true;
  inspectButton.textContent = "확인 중...";
  showStatusInfo("영상 정보 확인 중...");
  try {
    const res = await fetch("/api/inspect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      showStatusError(data.error || "영상 정보를 가져오지 못했습니다.");
      return;
    }
    statusEl.classList.add("hidden");
    renderVideoInfo(url, data);
  } catch {
    showStatusError("서버에 연결할 수 없습니다.");
  } finally {
    inspectButton.disabled = false;
    inspectButton.textContent = "확인";
  }
});

function renderVideoInfo(url, info) {
  inspectedUrl = url;
  inspectedOptions = info.options || [];
  videoTitle.textContent = info.title || "(제목 없음)";
  const subParts = [];
  if (info.uploader) subParts.push(info.uploader);
  const duration = formatEta(info.duration);
  if (duration) subParts.push(duration);
  videoSub.textContent = subParts.join(" · ");
  if (info.thumbnail) {
    videoThumbnail.onerror = () => {
      videoThumbnail.style.display = "none";
    };
    videoThumbnail.src = info.thumbnail;
    videoThumbnail.style.display = "";
  } else {
    videoThumbnail.removeAttribute("src");
    videoThumbnail.style.display = "none";
  }
  renderOptions(inspectedOptions);
  videoInfoEl.classList.remove("hidden");
}

function renderOptions(options) {
  optionsEl.innerHTML = "";
  options.forEach((opt, index) => {
    const label = document.createElement("label");
    label.className = "option";
    if (index === 0) label.classList.add("selected");
    const sizeText = opt.size != null ? formatSize(opt.size) : "크기 미상";
    label.innerHTML = `
      <input type="radio" name="quality" value="${escapeHtml(opt.value)}" ${index === 0 ? "checked" : ""} />
      <span class="option-label">${escapeHtml(opt.label)}</span>
      <span class="option-detail">${escapeHtml(opt.detail || "")}</span>
      <span class="option-size">${sizeText}</span>
    `;
    optionsEl.appendChild(label);
  });
}

function hideVideoInfo() {
  videoInfoEl.classList.add("hidden");
  inspectedUrl = null;
  inspectedOptions = [];
}

urlInput.addEventListener("input", () => {
  if (inspectedUrl && urlInput.value.trim() !== inspectedUrl) {
    hideVideoInfo();
  }
});

optionsEl.addEventListener("change", () => {
  optionsEl.querySelectorAll(".option").forEach((el) => {
    el.classList.toggle("selected", el.querySelector("input").checked);
  });
});

downloadButton.addEventListener("click", async () => {
  if (!inspectedUrl) return;
  const selected = document.querySelector('input[name="quality"]:checked');
  if (!selected) {
    showStatusError("화질을 선택해 주세요.");
    return;
  }
  const option = inspectedOptions.find((o) => o.value === selected.value);
  if (!option) return;
  downloadButton.disabled = true;
  showStatusInfo("요청 중...");
  try {
    const res = await fetch("/api/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: inspectedUrl, type: option.type, quality: option.value }),
    });
    const data = await res.json();
    if (!res.ok) {
      showStatusError(data.error || "다운로드를 시작할 수 없습니다.");
      return;
    }
    currentJobId = data.id;
    sessionStorage.setItem(JOB_STORAGE_KEY, currentJobId);
    hideVideoInfo();
    startPolling();
  } catch {
    showStatusError("서버에 연결할 수 없습니다.");
  } finally {
    downloadButton.disabled = false;
  }
});

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(pollJob, POLL_INTERVAL);
  pollJob();
}

function clearJob() {
  clearInterval(pollTimer);
  sessionStorage.removeItem(JOB_STORAGE_KEY);
  currentJobId = null;
}

async function pollJob() {
  if (!currentJobId) {
    clearInterval(pollTimer);
    return;
  }
  let res;
  try {
    res = await fetch(`/api/download/${currentJobId}`);
  } catch {
    return;
  }
  if (res.status === 404) {
    clearJob();
    showStatusError("작업 정보를 찾을 수 없습니다.");
    return;
  }
  const job = await res.json();
  if (job.status === "completed") {
    renderJobStatus(job);
    clearJob();
    refreshList();
  } else if (job.status === "failed") {
    clearJob();
    showStatusError(job.error || "다운로드에 실패했습니다.");
  } else {
    renderJobStatus(job);
  }
}

function renderJobStatus(job) {
  statusEl.classList.remove("hidden", "error");
  const label = STATUS_LABEL[job.status] || job.status;
  let html = `<div class="status-line"><span class="status-text">${label}</span>`;

  if (job.status === "waiting" && job.queuePosition) {
    html += `<span class="status-sub">대기열 ${job.queuePosition}번째</span>`;
  }

  if (job.status === "downloading") {
    const percent = job.totalBytes ? `${Math.min(100, Math.max(0, job.progress || 0))}%` : null;
    const details = [];
    if (percent) details.push(percent);
    if (job.totalBytes) details.push(`${formatSize(job.downloadedBytes || 0)} / ${formatSize(job.totalBytes)}`);
    else if (job.downloadedBytes) details.push(formatSize(job.downloadedBytes));
    const speed = formatSpeed(job.speed);
    if (speed) details.push(speed);
    const eta = formatEta(job.eta);
    if (eta) details.push(`ETA ${eta}`);
    if (details.length) html += `<span class="status-sub">${details.join(" · ")}</span>`;
  }

  if (job.message) html += `<span class="status-sub">${escapeHtml(job.message)}</span>`;
  html += `</div>`;

  if (job.status === "downloading") {
    if (job.totalBytes) {
      const p = Math.min(100, Math.max(0, job.progress || 0));
      html += `<div class="progress"><div class="progress-bar" style="width:${p}%"></div></div>`;
    } else {
      html += `<div class="progress indeterminate"><div class="progress-bar"></div></div>`;
    }
  }

  if (job.status === "completed") {
    html += `<div class="progress"><div class="progress-bar" style="width:100%"></div></div>`;
    if (job.filename) html += `<div class="status-sub">저장됨: ${escapeHtml(job.filename)}</div>`;
  }

  statusEl.innerHTML = html;
}

function showStatusError(message) {
  statusEl.classList.remove("hidden");
  statusEl.classList.add("error");
  statusEl.textContent = message;
}

function showStatusInfo(message) {
  statusEl.classList.remove("hidden", "error");
  statusEl.textContent = message;
}

async function refreshList() {
  let res;
  try {
    res = await fetch("/api/downloads");
  } catch {
    return;
  }
  renderFileList(await res.json());
}

function renderFileList(items) {
  fileListEl.innerHTML = "";
  fileCountEl.textContent = items.length > 0 ? `(${items.length})` : "";
  if (items.length === 0) {
    fileListEl.innerHTML = '<div class="empty">다운로드된 항목이 없습니다.</div>';
    return;
  }
  for (const item of items) {
    const el = document.createElement("div");
    el.className = "item";
    const badges = [
      item.hasVideo ? '<span class="badge video">MP4</span>' : "",
      item.hasAudio ? '<span class="badge audio">MP3</span>' : "",
    ].join("");
    const icon = item.hasVideo ? "▶" : "♪";
    const iconType = item.hasVideo ? "video" : "audio";
    el.innerHTML = `
      <div class="item-row">
        <div class="item-icon ${iconType}">${icon}</div>
        <div class="item-info">
          <div class="item-name" title="${escapeHtml(item.folder)}">${escapeHtml(item.title)}</div>
          <div class="item-meta">${badges}${formatSize(item.size)} · ${formatDate(item.modified)}</div>
        </div>
        <div class="item-actions">
          <button class="read" type="button">읽기</button>
          <button class="delete" type="button">삭제</button>
        </div>
      </div>
    `;
    el.querySelector(".read").addEventListener("click", () => openViewer(item.folder));
    el.querySelector(".delete").addEventListener("click", () => deleteItem(item.folder, item.title));
    fileListEl.appendChild(el);
  }
}

async function openViewer(folder) {
  let res;
  try {
    res = await fetch(`/api/item/${encodeURIComponent(folder)}`);
  } catch {
    alert("서버에 연결할 수 없습니다.");
    return;
  }
  if (!res.ok) {
    alert("항목을 불러올 수 없습니다.");
    return;
  }
  const item = await res.json();
  viewedFolder = folder;
  renderViewer(item);
  switchTab("viewer");
}

function renderViewer(item) {
  viewedTitle = item.title;
  viewedFolder = item.folder;
  viewedAnnotations = Array.isArray(item.annotations) ? item.annotations : [];
  const videoFile = item.files.find((f) => f.type === "video");
  const audioFile = item.files.find((f) => f.type === "audio");
  const hasScript = !!(item.script && Array.isArray(item.script.segments) && item.script.segments.length > 0);
  let html = '<button id="viewer-back" type="button">← 목록으로</button>';
  if (videoFile) {
    html += `
      <div class="viewer-video-wrap">
        <video class="viewer-video" controls preload="metadata" src="${mediaUrl(item.folder, videoFile.name)}"></video>
        ${hasScript ? syncToggleHtml() : ""}
      </div>
    `;
  }
  if (audioFile) {
    html += `
      <div class="viewer-audio">
        <div class="viewer-audio-head">
          ${hasScript && !videoFile ? syncToggleHtml() : ""}
          <span class="viewer-audio-label">오디오 · ${escapeHtml(audioFile.name)}</span>
        </div>
        <audio controls preload="metadata" src="${mediaUrl(item.folder, audioFile.name)}"></audio>
      </div>
    `;
  }
  if (item.info) {
    html += `<div class="viewer-info">${renderMarkdown(item.info)}</div>`;
  } else {
    html += `
      <div class="viewer-info">
        <h2>${escapeHtml(item.title)}</h2>
        <ul>${item.files.map((f) => `<li><code>${escapeHtml(f.name)}</code> (${formatSize(f.size)})</li>`).join("")}</ul>
      </div>
    `;
  }
  html += renderScriptSection(item);
  viewerContent.innerHTML = html;
  viewerContent.classList.remove("hidden");
  viewerEmpty.classList.add("hidden");
  document.getElementById("viewer-back").addEventListener("click", () => switchTab("downloader"));
  wireScriptInteractions(item);
}

function renderScriptSection(item) {
  const transcriberAvailable = item.transcriber && item.transcriber.available;
  const script = item.script;
  let html = '<div class="viewer-script" id="viewer-script">';
  html += '<div class="viewer-script-head"><h3>스크립트</h3>';
  if (script) {
    html += `
      <div class="viewer-script-actions">
        <button id="annotations-view-button" class="transcribe-again" type="button">하이라이트·메모</button>
        <button id="transcribe-button" class="transcribe-again" type="button">재추출</button>
      </div>
    `;
  }
  html += "</div>";
  html += '<div id="annotations-panel" class="annotations-panel hidden"></div>';
  if (!script) {
    if (transcriberAvailable) {
      html += '<div class="script-empty">스크립트가 없습니다. 음성 파일에서 Whisper로 추출할 수 있습니다.</div>';
      html += '<button id="transcribe-button" type="button">스크립트 추출</button>';
    } else {
      html += '<div class="script-empty">Whisper 엔진이 설치되어 있지 않아 스크립트 추출을 사용할 수 없습니다. README를 참고해 주세요.</div>';
    }
  }
  html += '<div id="script-status" class="script-status hidden"></div>';
  if (script && Array.isArray(script.segments)) {
    for (const seg of script.segments) {
      const ytUrl = youtubeTimeUrl(item.sourceUrl, seg.start);
      const timeHtml = ytUrl
        ? `<a class="segment-time" href="${escapeHtml(ytUrl)}" target="_blank" rel="noreferrer" title="유튜브에서 이 시간부터 열기">${formatTimestamp(seg.start)}</a>`
        : `<span class="segment-time">${formatTimestamp(seg.start)}</span>`;
      html += `
        <div class="segment" data-start="${seg.start}" data-end="${seg.end}">
          <div class="segment-line">
            <button class="segment-play" type="button" title="이 위치에서 재생">▶</button>
            ${timeHtml}
            <span class="segment-text">${escapeHtml(seg.text)}</span>
          </div>
        </div>
      `;
    }
  }
  html += "</div>";
  return html;
}

function syncToggleHtml() {
  return `
    <label class="sync-toggle" title="재생 중 스크립트를 따라갑니다">
      <input type="checkbox" id="sync-toggle" /> Sync
    </label>
  `;
}

function wireScriptInteractions(item) {
  const transcribeButton = document.getElementById("transcribe-button");
  if (transcribeButton) {
    transcribeButton.addEventListener("click", () => startTranscription(item.folder));
  }
  const viewButton = document.getElementById("annotations-view-button");
  if (viewButton) {
    viewButton.addEventListener("click", () => {
      const panel = document.getElementById("annotations-panel");
      if (panel.classList.contains("hidden")) {
        panel.innerHTML = renderMarkdown(buildAnnotationsMd());
        panel.classList.remove("hidden");
      } else {
        panel.classList.add("hidden");
      }
    });
  }
  if (!item.script || !Array.isArray(item.script.segments) || item.script.segments.length === 0) return;
  const mediaEl = viewerContent.querySelector("video") || viewerContent.querySelector("audio");
  if (!mediaEl) return;

  const segments = [...viewerContent.querySelectorAll(".segment")].map((el) => ({
    el,
    start: parseFloat(el.dataset.start),
    end: parseFloat(el.dataset.end),
  }));

  const syncToggle = document.getElementById("sync-toggle");
  let programmaticSeek = false;
  let activeIndex = -1;

  if (syncToggle) {
    syncToggle.checked = localStorage.getItem(SYNC_STORAGE_KEY) === "1";
    syncToggle.addEventListener("change", () => {
      localStorage.setItem(SYNC_STORAGE_KEY, syncToggle.checked ? "1" : "0");
      if (syncToggle.checked) {
        scrollToSegment(findSegmentIndexForTime(mediaEl.currentTime));
      }
    });
  }

  viewerContent.querySelectorAll(".segment-play, span.segment-time").forEach((el) => {
    el.addEventListener("click", () => {
      const segment = el.closest(".segment");
      const start = parseFloat(segment.dataset.start);
      if (!Number.isFinite(start)) return;
      programmaticSeek = true;
      mediaEl.currentTime = start;
      mediaEl.play().catch(() => {});
    });
  });

  function findSegmentIndexForTime(time) {
    for (let i = 0; i < segments.length; i++) {
      if (time >= segments[i].start && time < segments[i].end) return i;
    }
    for (let i = 0; i < segments.length; i++) {
      if (segments[i].start > time) return i;
    }
    return segments.length - 1;
  }

  function setActiveIndex(index) {
    if (index === activeIndex) return;
    activeIndex = index;
    segments.forEach((s, i) => s.el.classList.toggle("active", i === index));
  }

  function scrollToSegment(index) {
    if (index < 0 || index >= segments.length) return;
    segments[index].el.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  mediaEl.addEventListener("timeupdate", () => {
    const index = findSegmentIndexForTime(mediaEl.currentTime);
    const changed = index !== activeIndex;
    setActiveIndex(index);
    if (changed && syncToggle && syncToggle.checked) {
      scrollToSegment(index);
    }
  });

  mediaEl.addEventListener("seeking", () => {
    if (programmaticSeek) {
      programmaticSeek = false;
      return;
    }
    const index = findSegmentIndexForTime(mediaEl.currentTime);
    setActiveIndex(index);
    scrollToSegment(index);
  });

  applyAnnotationsToSegments();
}

function applyAnnotationsToSegments() {
  viewerContent.querySelectorAll(".segment").forEach((el) => {
    const start = parseFloat(el.dataset.start);
    const end = parseFloat(el.dataset.end);
    const matching = viewedAnnotations.filter((a) => a.start < end && a.end > start);
    el.classList.toggle("highlighted", matching.some((a) => a.type === "highlight"));
    el.querySelectorAll(".segment-note").forEach((n) => n.remove());
    for (const a of matching.filter((x) => x.type === "note")) {
      const box = document.createElement("div");
      box.className = "segment-note";
      const text = document.createElement("span");
      text.className = "segment-note-text";
      text.textContent = a.note;
      const del = document.createElement("button");
      del.className = "segment-note-delete";
      del.type = "button";
      del.title = "메모 삭제";
      del.textContent = "×";
      del.addEventListener("click", async () => {
        try {
          const res = await fetch("/api/annotations", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder: viewedFolder, id: a.id }),
          });
          if (!res.ok) return;
        } catch {
          return;
        }
        viewedAnnotations = viewedAnnotations.filter((x) => x.id !== a.id);
        applyAnnotationsToSegments();
        refreshAnnotationsPanel();
      });
      box.appendChild(text);
      box.appendChild(del);
      el.appendChild(box);
    }
  });
}

function refreshAnnotationsPanel() {
  const panel = document.getElementById("annotations-panel");
  if (panel && !panel.classList.contains("hidden")) {
    panel.innerHTML = renderMarkdown(buildAnnotationsMd());
  }
}

function buildAnnotationsMd() {
  const lines = [`# 하이라이트·메모 — ${viewedTitle || ""}`, ""];
  if (viewedAnnotations.length === 0) {
    lines.push("아직 하이라이트나 메모가 없습니다.", "");
    return lines.join("\n");
  }
  const sorted = viewedAnnotations.slice().sort((a, b) => a.start - b.start);
  for (const a of sorted) {
    lines.push(`## [${formatTimestamp(a.start)}] ${a.type === "highlight" ? "하이라이트" : "메모"}`, "");
    if (a.text) lines.push(`> ${a.text.split("\n").join(" ")}`, "");
    if (a.type === "note" && a.note) lines.push(`**메모:** ${a.note.split("\n").join(" ")}`, "");
  }
  return lines.join("\n");
}

function wireScriptSelection() {
  document.addEventListener("mousedown", (event) => {
    if (!event.target.closest(".selection-menu")) {
      hideSelectionMenu();
    }
  });

  document.addEventListener("mouseup", (event) => {
    if (event.target.closest(".selection-menu")) return;
    if (event.target.closest(".segment-play, .segment-time")) return;
    const segments = snapSelectionToSegments();
    if (segments) {
      showSelectionMenu(segments, event.clientX, event.clientY);
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.target.closest(".selection-menu")) return;
    if (event.target.matches && event.target.matches("input, textarea")) return;
    const isArrow = event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key);
    const isSelectAll = (event.metaKey || event.ctrlKey) && (event.key === "a" || event.key === "A");
    if (!isArrow && !isSelectAll) return;
    const segments = snapSelectionToSegments();
    if (segments) {
      showSelectionMenuAtSelection(segments);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideSelectionMenu();
  });

  window.addEventListener("scroll", () => hideSelectionMenu(), { passive: true });

  selectionMenuEl.addEventListener("mousedown", (event) => event.preventDefault());

  selectionMenuEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    if (action === "highlight") {
      saveSelectionAnnotation("highlight");
    } else if (action === "note") {
      openNoteEditor();
    } else if (action === "note-save") {
      saveSelectionAnnotation("note", noteInput.value);
    } else if (action === "note-cancel") {
      showSelectionMenuActions();
    } else if (action === "remove") {
      removeSelectionAnnotations();
    }
  });

  document.addEventListener("copy", (event) => {
    const segments = getScriptSelectionSegments();
    if (!segments) return;
    const lines = segments.map((s) => s.text).filter(Boolean);
    if (lines.length === 0) return;
    const first = segments[0];
    const last = segments[segments.length - 1];
    lines.push(`[${formatTimestamp(first.start)} : ${formatTimestamp(last.end)} - ${viewedTitle || ""}]`);
    event.clipboardData.setData("text/plain", lines.join("\n"));
    event.preventDefault();
  });
}

function showSelectionMenu(segments, x, y) {
  selectedSegments = segments;
  lastMenuPos = { x, y };
  showSelectionMenuActions();
  const hasExisting = viewedAnnotations.some(
    (a) => a.start < segments[segments.length - 1].end && a.end > segments[0].start
  );
  selectionMenuEl.querySelector('[data-action="remove"]').classList.toggle("hidden", !hasExisting);
  selectionMenuEl.classList.remove("hidden");
  positionSelectionMenu(x, y);
}

function showSelectionMenuAtSelection(segments) {
  let x = lastMenuPos.x;
  let y = lastMenuPos.y;
  const selection = window.getSelection();
  if (selection && selection.rangeCount > 0) {
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (rect && (rect.width > 0 || rect.height > 0)) {
      x = rect.left + Math.min(rect.width / 2, 100);
      y = rect.top;
    }
  }
  showSelectionMenu(segments, x, y);
}

function showSelectionMenuActions() {
  selectionMenuActions.classList.remove("hidden");
  selectionMenuNote.classList.add("hidden");
  positionSelectionMenu(lastMenuPos.x, lastMenuPos.y);
}

function openNoteEditor() {
  selectionMenuActions.classList.add("hidden");
  selectionMenuNote.classList.remove("hidden");
  noteInput.value = "";
  positionSelectionMenu(lastMenuPos.x, lastMenuPos.y);
  noteInput.focus();
}

function hideSelectionMenu() {
  selectionMenuEl.classList.add("hidden");
  selectedSegments = null;
}

function positionSelectionMenu(x, y) {
  const rect = selectionMenuEl.getBoundingClientRect();
  const width = rect.width || 180;
  const height = rect.height || 40;
  let left = x - width / 2;
  let top = y - height - 12;
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
  selectionMenuEl.style.left = `${left}px`;
  selectionMenuEl.style.top = `${top}px`;
}

async function saveSelectionAnnotation(type, note) {
  const segments = selectedSegments;
  if (!segments || segments.length === 0 || !viewedFolder) return;
  if (type === "note" && (!note || !note.trim())) {
    alert("메모 내용을 입력해 주세요.");
    return;
  }
  const body = {
    folder: viewedFolder,
    type,
    start: segments[0].start,
    end: segments[segments.length - 1].end,
    text: segments.map((s) => s.text).join(" "),
  };
  if (type === "note") body.note = note.trim();
  try {
    const res = await fetch("/api/annotations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "저장에 실패했습니다.");
      return;
    }
    viewedAnnotations.push(data.annotation);
    applyAnnotationsToSegments();
    refreshAnnotationsPanel();
  } catch {
    alert("서버에 연결할 수 없습니다.");
    return;
  }
  hideSelectionMenu();
  window.getSelection().removeAllRanges();
}

async function removeSelectionAnnotations() {
  const segments = selectedSegments;
  if (!segments || segments.length === 0 || !viewedFolder) return;
  const start = segments[0].start;
  const end = segments[segments.length - 1].end;
  const targets = viewedAnnotations.filter((a) => a.start < end && a.end > start);
  for (const a of targets) {
    try {
      await fetch("/api/annotations", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: viewedFolder, id: a.id }),
      });
    } catch {
      /* 계속 진행 */
    }
  }
  viewedAnnotations = viewedAnnotations.filter((a) => !targets.includes(a));
  applyAnnotationsToSegments();
  refreshAnnotationsPanel();
  hideSelectionMenu();
  window.getSelection().removeAllRanges();
}

function getScriptSelectionSegments() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const scriptEl = document.querySelector(".viewer-script");
  if (!scriptEl) return null;
  const range = selection.getRangeAt(0);
  if (!scriptEl.contains(range.startContainer) || !scriptEl.contains(range.endContainer)) return null;
  const inNoteBox = (node) => {
    const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    return !!(el && el.closest(".segment-note"));
  };
  if (inNoteBox(range.startContainer) || inNoteBox(range.endContainer)) return null;
  const segments = [...scriptEl.querySelectorAll(".segment")]
    .filter((el) => range.intersectsNode(el))
    .map((el) => {
      const textEl = el.querySelector(".segment-text");
      return {
        el,
        text: textEl ? textEl.textContent.trim() : "",
        start: parseFloat(el.dataset.start),
        end: parseFloat(el.dataset.end),
      };
    });
  return segments.length > 0 ? segments : null;
}

function snapSelectionToSegments() {
  const segments = getScriptSelectionSegments();
  if (!segments) return null;
  const firstText = segments[0].el.querySelector(".segment-text");
  const lastText = segments[segments.length - 1].el.querySelector(".segment-text");
  if (!firstText || !lastText) return null;
  const selection = window.getSelection();
  const range = document.createRange();
  range.setStartBefore(firstText);
  range.setEndAfter(lastText);
  selection.removeAllRanges();
  selection.addRange(range);
  return segments;
}

async function startTranscription(folder) {
  const button = document.getElementById("transcribe-button");
  if (button) button.disabled = true;
  try {
    const res = await fetch("/api/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder }),
    });
    const data = await res.json();
    if (!res.ok) {
      showScriptError(data.error || "스크립트 추출을 시작할 수 없습니다.");
      return;
    }
    transcribeJobId = data.id;
    startTranscribePolling(folder);
  } catch {
    showScriptError("서버에 연결할 수 없습니다.");
  }
}

function startTranscribePolling(folder) {
  clearInterval(transcribeTimer);
  renderScriptStatus({ status: "transcribing", startedAt: new Date().toISOString() });
  transcribeTimer = setInterval(async () => {
    if (!transcribeJobId) {
      clearInterval(transcribeTimer);
      return;
    }
    let res;
    try {
      res = await fetch(`/api/transcribe/${transcribeJobId}`);
    } catch {
      return;
    }
    if (res.status === 404) {
      clearInterval(transcribeTimer);
      showScriptError("작업 정보를 찾을 수 없습니다.");
      return;
    }
    const job = await res.json();
    if (job.status === "completed") {
      clearInterval(transcribeTimer);
      await openViewer(folder);
      const scriptEl = document.getElementById("viewer-script");
      if (scriptEl) scriptEl.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (job.status === "failed") {
      clearInterval(transcribeTimer);
      showScriptError(job.error || "스크립트 변환에 실패했습니다.");
    } else {
      renderScriptStatus(job);
    }
  }, 1000);
}

function renderScriptStatus(job) {
  const el = document.getElementById("script-status");
  if (!el) return;
  const elapsed = job.startedAt
    ? Math.max(0, Math.round((Date.now() - new Date(job.startedAt).getTime()) / 1000))
    : 0;
  el.classList.remove("hidden", "error");
  el.innerHTML = `
    <div class="status-line">
      <span class="status-text">변환 중</span>
      <span class="status-sub">Whisper 로컬 변환 · 경과 ${formatEta(elapsed) || "0:00"}</span>
    </div>
    <div class="progress indeterminate"><div class="progress-bar"></div></div>
  `;
}

function showScriptError(message) {
  const el = document.getElementById("script-status");
  const button = document.getElementById("transcribe-button");
  if (button) button.disabled = false;
  if (!el) {
    alert(message);
    return;
  }
  el.classList.remove("hidden");
  el.classList.add("error");
  el.textContent = message;
}

function resetViewer() {
  viewedFolder = null;
  viewerContent.innerHTML = "";
  viewerContent.classList.add("hidden");
  viewerEmpty.classList.remove("hidden");
}

function renderMarkdown(md) {
  const inline = (text) => {
    let s = escapeHtml(text);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    s = s.replace(/(^|[^"=\]>])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>');
    return s;
  };
  let html = "";
  let inList = false;
  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };
  for (const rawLine of String(md).split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      closeList();
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      html += `<h3>${inline(line.slice(3))}</h3>`;
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      html += `<h2>${inline(line.slice(2))}</h2>`;
      continue;
    }
    if (line.startsWith("- ")) {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${inline(line.slice(2))}</li>`;
      continue;
    }
    if (line.startsWith("> ")) {
      closeList();
      html += `<blockquote>${inline(line.slice(2))}</blockquote>`;
      continue;
    }
    closeList();
    html += `<p>${inline(line)}</p>`;
  }
  closeList();
  return html;
}

async function deleteItem(folder, title) {
  if (!confirm(`'${title}' 항목을 삭제할까요?\n(폴더 안의 모든 파일이 함께 삭제됩니다)`)) return;
  try {
    const res = await fetch(`/api/downloads/${encodeURIComponent(folder)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "삭제에 실패했습니다.");
      return;
    }
    if (viewedFolder === folder) resetViewer();
    await refreshList();
  } catch {
    alert("서버에 연결할 수 없습니다.");
  }
}

if (currentJobId) startPolling();
wireScriptSelection();
refreshList();

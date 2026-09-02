const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { safeItemPath, formatTimestamp } = require("./files");

async function readAnnotations(folderName) {
  const dir = safeItemPath(folderName);
  if (!dir) return [];
  try {
    const data = JSON.parse(await fsp.readFile(path.join(dir, "notes.json"), "utf8"));
    return Array.isArray(data.annotations) ? data.annotations : [];
  } catch {
    return [];
  }
}

async function writeAnnotations(folderName, annotations) {
  const dir = safeItemPath(folderName);
  if (!dir) throw new Error("잘못된 요청입니다.");
  await fsp.writeFile(path.join(dir, "notes.json"), JSON.stringify({ annotations }, null, 2), "utf8");
  await fsp.writeFile(path.join(dir, "NOTES.md"), buildNotesMd(annotations, folderName), "utf8");
}

async function addAnnotation({ folder, type, start, end, text, note }) {
  const dir = safeItemPath(folder);
  if (!dir) return { error: 400, message: "잘못된 요청입니다." };
  if (!fs.existsSync(dir)) return { error: 404, message: "항목이 존재하지 않습니다." };
  if (type !== "highlight" && type !== "note") return { error: 400, message: "잘못된 주석 유형입니다." };
  const startNum = Number(start);
  const endNum = Number(end);
  if (!Number.isFinite(startNum) || !Number.isFinite(endNum) || endNum < startNum) {
    return { error: 400, message: "잘못된 시간 범위입니다." };
  }
  if (type === "note" && (typeof note !== "string" || !note.trim())) {
    return { error: 400, message: "메모 내용을 입력해 주세요." };
  }
  const annotations = await readAnnotations(folder);
  const annotation = {
    id: crypto.randomUUID(),
    type,
    start: startNum,
    end: endNum,
    text: typeof text === "string" ? text.trim() : "",
    note: type === "note" ? note.trim() : null,
    createdAt: new Date().toISOString(),
  };
  annotations.push(annotation);
  await writeAnnotations(folder, annotations);
  return { annotation };
}

async function removeAnnotation({ folder, id }) {
  const dir = safeItemPath(folder);
  if (!dir) return { error: 400, message: "잘못된 요청입니다." };
  const annotations = await readAnnotations(folder);
  const next = annotations.filter((a) => a.id !== id);
  if (next.length === annotations.length) return { error: 404, message: "해당 주석을 찾을 수 없습니다." };
  await writeAnnotations(folder, next);
  return { ok: true };
}

function buildNotesMd(annotations, title) {
  const lines = [`# 하이라이트·메모 — ${title}`, ""];
  if (!annotations || annotations.length === 0) {
    lines.push("아직 하이라이트나 메모가 없습니다.", "");
    return lines.join("\n");
  }
  const sorted = annotations.slice().sort((a, b) => a.start - b.start);
  for (const a of sorted) {
    lines.push(`## [${formatTimestamp(a.start)}] ${a.type === "highlight" ? "하이라이트" : "메모"}`, "");
    if (a.text) {
      lines.push(`> ${a.text.split("\n").join(" ")}`, "");
    }
    if (a.type === "note" && a.note) {
      lines.push(`**메모:** ${a.note.split("\n").join(" ")}`, "");
    }
  }
  return lines.join("\n");
}

module.exports = {
  readAnnotations,
  addAnnotation,
  removeAnnotation,
  buildNotesMd,
};

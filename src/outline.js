const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { safeItemPath } = require("./files");

const MAX_INDENTS = 2000;

async function readOutline(folderName) {
  const dir = safeItemPath(folderName);
  if (!dir) return { indents: [] };
  try {
    const data = JSON.parse(await fsp.readFile(path.join(dir, "outline.json"), "utf8"));
    const indents = Array.isArray(data.indents) ? normalizeIndents(data.indents) : [];
    return { indents: indents || [] };
  } catch {
    return { indents: [] };
  }
}

async function saveOutline(folderName, indents) {
  const dir = safeItemPath(folderName);
  if (!dir) return { error: 400, message: "잘못된 요청입니다." };
  if (!fs.existsSync(dir)) return { error: 404, message: "항목이 존재하지 않습니다." };
  if (!Array.isArray(indents)) return { error: 400, message: "잘못된 들여쓰기 목록입니다." };
  if (indents.length > MAX_INDENTS) {
    return { error: 400, message: `들여쓰기 범위는 ${MAX_INDENTS}개까지 저장할 수 있습니다.` };
  }
  const normalized = normalizeIndents(indents);
  if (!normalized) return { error: 400, message: "잘못된 들여쓰기 범위입니다." };
  await fsp.writeFile(path.join(dir, "outline.json"), JSON.stringify({ indents: normalized }, null, 2), "utf8");
  return { indents: normalized };
}

function normalizeIndents(indents) {
  const ranges = [];
  for (const r of indents) {
    if (!r || typeof r !== "object") return null;
    const start = Number(r.start);
    const end = Number(r.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
    ranges.push({ start, end });
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

module.exports = {
  readOutline,
  saveOutline,
  normalizeIndents,
};

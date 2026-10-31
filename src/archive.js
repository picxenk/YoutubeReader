const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { safeItemPath, ARCHIVE_FILE } = require("./files");

async function setArchived(folderName, archived) {
  const dir = safeItemPath(folderName);
  if (!dir) return { error: 400, message: "잘못된 요청입니다." };
  if (!fs.existsSync(dir)) return { error: 404, message: "항목이 존재하지 않습니다." };
  if (typeof archived !== "boolean") return { error: 400, message: "archived 값은 true 또는 false여야 합니다." };
  const file = path.join(dir, ARCHIVE_FILE);
  if (!archived) {
    await fsp.rm(file, { force: true });
    return { archived: false, archivedAt: null };
  }
  const archivedAt = new Date().toISOString();
  await fsp.writeFile(file, JSON.stringify({ archived: true, archivedAt }, null, 2), "utf8");
  return { archived: true, archivedAt };
}

module.exports = {
  setArchived,
};

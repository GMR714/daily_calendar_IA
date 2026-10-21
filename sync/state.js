const fs = require("fs");

function loadState(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { files: {} };
  }
}

function saveState(file, state) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file);
}

function filesToRead(files, state) {
  const known = (state && state.files) || {};
  return files.filter(file => {
    const seen = known[file.path];
    return !seen || seen.size !== file.size || seen.mtimeMs !== file.mtimeMs;
  });
}

function isNewRecord(timestamp, lastTs) {
  return !lastTs || timestamp > lastTs;
}

function rememberFile(state, file, lastTs) {
  return { ...state, files: { ...(state.files || {}), [file.path]: { size: file.size, mtimeMs: file.mtimeMs, lastTs } } };
}

module.exports = { loadState, saveState, filesToRead, isNewRecord, rememberFile };

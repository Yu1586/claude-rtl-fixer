const fs = require("fs");
const path = require("path");

const MARKER_FILE = ".rtl-patched.json";

function getMarkerPath(resourcesDir) {
  return path.join(resourcesDir, MARKER_FILE);
}

function getBackupPaths(install) {
  return {
    asarBackup: install.asarPath + ".bak",
    exeBackup: install.exePath + ".bak",
    markerPath: getMarkerPath(install.resourcesDir),
  };
}

/**
 * Create backups of app.asar and claude.exe before patching.
 * Will NOT overwrite existing backups (safety).
 */
function createBackup(install) {
  const { asarBackup, exeBackup, markerPath } = getBackupPaths(install);

  // Don't overwrite existing backups — they represent the original state
  if (fs.existsSync(asarBackup) && fs.existsSync(exeBackup)) {
    return {
      success: true,
      skipped: true,
      message: "Backups already exist (from a previous patch). Using existing backups.",
    };
  }

  try {
    fs.copyFileSync(install.asarPath, asarBackup);
    fs.copyFileSync(install.exePath, exeBackup);
    return { success: true, skipped: false };
  } catch (err) {
    // Clean up partial backups
    try { fs.unlinkSync(asarBackup); } catch (_) {}
    try { fs.unlinkSync(exeBackup); } catch (_) {}
    return {
      success: false,
      error:
        `Failed to create backups: ${err.message}\n` +
        "  Make sure Claude Desktop is not running, and you have write permissions.",
    };
  }
}

/**
 * Restore original files from backups.
 */
function restoreBackup(install) {
  const { asarBackup, exeBackup, markerPath } = getBackupPaths(install);

  if (!fs.existsSync(asarBackup) || !fs.existsSync(exeBackup)) {
    return {
      success: false,
      error:
        "Backup files not found — cannot restore.\n" +
        `  Expected:\n    ${asarBackup}\n    ${exeBackup}\n` +
        "  If you need to fix Claude, try reinstalling it.",
    };
  }

  try {
    fs.copyFileSync(asarBackup, install.asarPath);
    fs.copyFileSync(exeBackup, install.exePath);

    // Clean up backup files and marker
    fs.unlinkSync(asarBackup);
    fs.unlinkSync(exeBackup);
    if (fs.existsSync(markerPath)) fs.unlinkSync(markerPath);

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error:
        `Failed to restore backups: ${err.message}\n` +
        "  Make sure Claude Desktop is not running.",
    };
  }
}

/**
 * Write a marker file indicating the app has been patched.
 */
function writeMarker(install, oldHash, newHash) {
  const markerPath = getMarkerPath(install.resourcesDir);
  const data = {
    tool: "claude-rtl-fixer",
    version: require("../package.json").version,
    patchedAt: new Date().toISOString(),
    claudeVersion: install.version,
    hashes: { original: oldHash, patched: newHash },
  };
  fs.writeFileSync(markerPath, JSON.stringify(data, null, 2));
}

/**
 * Check if the app is currently patched.
 */
function isPatchedOnDisk(install) {
  const markerPath = getMarkerPath(install.resourcesDir);
  if (!fs.existsSync(markerPath)) {
    return { patched: false };
  }
  try {
    const data = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
    return { patched: true, info: data };
  } catch {
    return { patched: true, info: null };
  }
}

/**
 * Check if backup files exist.
 */
function hasBackups(install) {
  const { asarBackup, exeBackup } = getBackupPaths(install);
  return fs.existsSync(asarBackup) && fs.existsSync(exeBackup);
}

module.exports = {
  createBackup,
  restoreBackup,
  writeMarker,
  isPatchedOnDisk,
  hasBackups,
};

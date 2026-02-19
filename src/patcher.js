const fs = require("fs");
const path = require("path");
const os = require("os");
const asar = require("@electron/asar");
const { findClaudeInstall } = require("./finder");
const { getRtlPayload, isPatched: isCodePatched } = require("./rtl-payload");
const { computeAsarHeaderHash, readEmbeddedHash, patchExeHash } = require("./integrity");
const { createBackup, restoreBackup, writeMarker, isPatchedOnDisk, hasBackups } = require("./backup");

const MAIN_VIEW_PATH = ".vite/build/mainView.js";

/**
 * Check if Claude Desktop is currently running.
 */
function isClaudeRunning() {
  try {
    const { execSync } = require("child_process");
    const output = execSync('tasklist /FI "IMAGENAME eq claude.exe" /NH', {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.toLowerCase().includes("claude.exe");
  } catch {
    return false;
  }
}

/**
 * Verify we can write to a file (not locked by another process).
 */
function canWrite(filePath) {
  try {
    const fd = fs.openSync(filePath, "r+");
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err.code === "EBUSY" || err.code === "EPERM" || err.code === "EACCES") {
      return false;
    }
    return true;
  }
}

function cleanup(tempDir) {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // Best effort
  }
}

/**
 * Run all pre-patch safety checks. Returns { ok, install?, error? }
 */
function preflight(requireUnpatched) {
  const install = findClaudeInstall();
  if (!install.found) {
    return { ok: false, error: install.error };
  }

  if (isClaudeRunning()) {
    return {
      ok: false,
      error:
        "Claude Desktop is currently running.\n" +
        "  Please close Claude Desktop completely (check the system tray too!) and try again.",
    };
  }

  if (!canWrite(install.asarPath)) {
    return {
      ok: false,
      error:
        `Cannot write to ${install.asarPath}\n` +
        "  The file may be locked. Close Claude Desktop and try again.\n" +
        "  You may also need to run this as Administrator.",
    };
  }

  if (!canWrite(install.exePath)) {
    return {
      ok: false,
      error:
        `Cannot write to ${install.exePath}\n` +
        "  The file may be locked. Close Claude Desktop and try again.\n" +
        "  You may also need to run this as Administrator.",
    };
  }

  if (requireUnpatched) {
    const patchStatus = isPatchedOnDisk(install);
    if (patchStatus.patched) {
      return {
        ok: false,
        error:
          "Claude Desktop is already patched with RTL fix.\n" +
          `  Patched on: ${patchStatus.info?.patchedAt || "unknown"}\n` +
          '  Run "unpatch" first if you want to re-apply.',
      };
    }
  }

  return { ok: true, install };
}

/**
 * Apply the RTL fix to Claude Desktop.
 */
async function patch() {
  // Step 1–2: Find Claude + safety checks
  console.log("  Finding Claude Desktop installation...");
  const check = preflight(true);
  if (!check.ok) return { success: false, error: check.error };
  const install = check.install;
  console.log(`  Found Claude Desktop v${install.version}`);

  // Step 3: Read original hash from exe BEFORE any changes
  console.log("  Reading integrity hash from claude.exe...");
  const hashResult = readEmbeddedHash(install.exePath);
  if (!hashResult.found) {
    return { success: false, error: hashResult.error };
  }
  const oldHash = hashResult.hash;
  console.log(`  Original hash: ${oldHash.substring(0, 16)}...`);

  // Verify hash matches current asar (detect other modifications)
  const currentAsarHash = computeAsarHeaderHash(install.asarPath);
  if (currentAsarHash !== oldHash) {
    return {
      success: false,
      error:
        "Integrity mismatch — the hash in claude.exe doesn't match app.asar.\n" +
        `  EXE hash:  ${oldHash}\n` +
        `  ASAR hash: ${currentAsarHash}\n` +
        "  Claude Desktop may have been modified by another tool.\n" +
        "  Try reinstalling Claude Desktop to get a clean state.",
    };
  }

  // Step 4: Create backups
  console.log("  Creating backups...");
  const backupResult = createBackup(install);
  if (!backupResult.success) {
    return { success: false, error: backupResult.error };
  }
  if (backupResult.skipped) {
    console.log(`  ${backupResult.message}`);
  } else {
    console.log("  Backups created successfully");
  }

  // Step 5: Extract asar to temp directory
  const tempDir = path.join(os.tmpdir(), `claude-rtl-fix-${Date.now()}`);
  console.log("  Extracting app.asar...");
  try {
    asar.extractAll(install.asarPath, tempDir);
  } catch (err) {
    cleanup(tempDir);
    return { success: false, error: `Failed to extract app.asar: ${err.message}` };
  }

  // Step 6: Inject RTL code into mainView.js
  const mainViewPath = path.join(tempDir, MAIN_VIEW_PATH);
  if (!fs.existsSync(mainViewPath)) {
    cleanup(tempDir);
    return {
      success: false,
      error:
        `mainView.js not found at expected path inside asar.\n` +
        `  Expected: ${MAIN_VIEW_PATH}\n` +
        "  Claude Desktop may have changed its internal structure.",
    };
  }

  console.log("  Injecting RTL fix...");
  let content = fs.readFileSync(mainViewPath, "utf-8");

  if (isCodePatched(content)) {
    cleanup(tempDir);
    return {
      success: false,
      error:
        "mainView.js already contains RTL fix code, but no marker file was found.\n" +
        "  Something is inconsistent. Try reinstalling Claude Desktop.",
    };
  }

  const payload = getRtlPayload();
  const sourceMapComment = "//# sourceMappingURL=mainView.js.map";
  if (content.includes(sourceMapComment)) {
    content = content.replace(sourceMapComment, payload + "\n" + sourceMapComment);
  } else {
    content += payload;
  }
  fs.writeFileSync(mainViewPath, content, "utf-8");

  // Step 7: Repack asar
  console.log("  Repacking app.asar...");
  try {
    await asar.createPackage(tempDir, install.asarPath);
  } catch (err) {
    cleanup(tempDir);
    console.log("  Repack failed, restoring backups...");
    restoreBackup(install);
    return {
      success: false,
      error: `Failed to repack app.asar: ${err.message}\n  Original files have been restored from backup.`,
    };
  }

  // Verify the new asar exists and is non-empty
  try {
    const stat = fs.statSync(install.asarPath);
    if (stat.size < 1000) {
      throw new Error("Repacked asar is suspiciously small");
    }
  } catch (err) {
    cleanup(tempDir);
    console.log("  Verification failed, restoring backups...");
    restoreBackup(install);
    return {
      success: false,
      error: `Asar verification failed: ${err.message}\n  Original files have been restored from backup.`,
    };
  }

  // Step 8: Compute new hash
  console.log("  Updating integrity hash...");
  const newHash = computeAsarHeaderHash(install.asarPath);
  console.log(`  New hash: ${newHash.substring(0, 16)}...`);

  // Step 9: Patch exe with new hash
  const patchResult = patchExeHash(install.exePath, oldHash, newHash);
  if (!patchResult.success) {
    console.log("  Hash patch failed, restoring backups...");
    restoreBackup(install);
    cleanup(tempDir);
    return { success: false, error: patchResult.error };
  }

  // Step 10: Write marker and clean up
  writeMarker(install, oldHash, newHash);
  cleanup(tempDir);

  return { success: true, version: install.version, oldHash, newHash };
}

/**
 * Remove the RTL fix and restore original files.
 */
function unpatch() {
  console.log("  Finding Claude Desktop installation...");
  const install = findClaudeInstall();
  if (!install.found) {
    return { success: false, error: install.error };
  }
  console.log(`  Found Claude Desktop v${install.version}`);

  if (isClaudeRunning()) {
    return {
      success: false,
      error:
        "Claude Desktop is currently running.\n" +
        "  Please close Claude Desktop completely (check the system tray too!) and try again.",
    };
  }

  if (!hasBackups(install)) {
    const patchStatus = isPatchedOnDisk(install);
    if (!patchStatus.patched) {
      return { success: false, error: "Claude Desktop is not patched — nothing to unpatch." };
    }
    return {
      success: false,
      error:
        "No backup files found — cannot restore.\n" +
        "  The backup files may have been deleted.\n" +
        "  To fix this, reinstall Claude Desktop.",
    };
  }

  if (!canWrite(install.asarPath) || !canWrite(install.exePath)) {
    return {
      success: false,
      error:
        "Cannot write to Claude Desktop files.\n" +
        "  Close Claude Desktop and try again.\n" +
        "  You may also need to run this as Administrator.",
    };
  }

  console.log("  Restoring original files from backup...");
  const result = restoreBackup(install);
  if (!result.success) return result;

  return { success: true, version: install.version };
}

/**
 * Show current patch status.
 */
function status() {
  const install = findClaudeInstall();
  if (!install.found) {
    return { success: false, error: install.error };
  }

  const patchStatus = isPatchedOnDisk(install);
  const backupsExist = hasBackups(install);
  const running = isClaudeRunning();

  let codePatched = false;
  try {
    const tempDir = path.join(os.tmpdir(), `claude-rtl-check-${Date.now()}`);
    asar.extractAll(install.asarPath, tempDir);
    const mainViewPath = path.join(tempDir, MAIN_VIEW_PATH);
    if (fs.existsSync(mainViewPath)) {
      codePatched = isCodePatched(fs.readFileSync(mainViewPath, "utf-8"));
    }
    cleanup(tempDir);
  } catch {
    // Can't check
  }

  return {
    success: true,
    version: install.version,
    allVersions: install.allVersions,
    patched: patchStatus.patched,
    patchInfo: patchStatus.info,
    codePatched,
    backupsExist,
    running,
    paths: {
      appDir: install.appDir,
      asar: install.asarPath,
      exe: install.exePath,
    },
  };
}

module.exports = { patch, unpatch, status };

const fs = require("fs");
const path = require("path");

/**
 * Auto-detect Claude Desktop installation on Windows.
 * Scans %LOCALAPPDATA%/AnthropicClaude/app-* and picks the latest version.
 */
function findClaudeInstall() {
  const localAppData =
    process.env.LOCALAPPDATA ||
    path.join(process.env.USERPROFILE || "", "AppData", "Local");

  const claudeBase = path.join(localAppData, "AnthropicClaude");

  if (!fs.existsSync(claudeBase)) {
    return {
      found: false,
      error:
        "Claude Desktop is not installed.\n" +
        `  Expected directory: ${claudeBase}\n` +
        "  Download it from https://claude.ai/download",
    };
  }

  // Find all app-* version directories
  const entries = fs.readdirSync(claudeBase, { withFileTypes: true });
  const appDirs = entries
    .filter((e) => e.isDirectory() && /^app-\d+\.\d+\.\d+$/.test(e.name))
    .map((e) => ({
      name: e.name,
      version: e.name
        .replace("app-", "")
        .split(".")
        .map(Number),
      fullPath: path.join(claudeBase, e.name),
    }))
    .sort((a, b) => {
      // Sort by version descending (major, minor, patch)
      for (let i = 0; i < 3; i++) {
        if (a.version[i] !== b.version[i]) return b.version[i] - a.version[i];
      }
      return 0;
    });

  if (appDirs.length === 0) {
    return {
      found: false,
      error:
        "No Claude Desktop versions found.\n" +
        `  Looked in: ${claudeBase}\n` +
        "  Expected directories like app-1.1.2321",
    };
  }

  const latest = appDirs[0];
  const resourcesDir = path.join(latest.fullPath, "resources");
  const asarPath = path.join(resourcesDir, "app.asar");
  const exePath = path.join(latest.fullPath, "claude.exe");

  // Validate files exist
  const missing = [];
  if (!fs.existsSync(asarPath)) missing.push(`app.asar: ${asarPath}`);
  if (!fs.existsSync(exePath)) missing.push(`claude.exe: ${exePath}`);

  if (missing.length > 0) {
    return {
      found: false,
      error:
        `Claude Desktop ${latest.name} is incomplete — missing files:\n` +
        missing.map((m) => `  - ${m}`).join("\n"),
    };
  }

  return {
    found: true,
    version: latest.name.replace("app-", ""),
    appDir: latest.fullPath,
    resourcesDir,
    asarPath,
    exePath,
    allVersions: appDirs.map((d) => d.name.replace("app-", "")),
  };
}

module.exports = { findClaudeInstall };

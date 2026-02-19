#!/usr/bin/env node

const { patch, unpatch, status } = require("./patcher");

const HELP = `
Claude RTL Fixer — Fix RTL text rendering in Claude Desktop (Windows)

Usage:
  claude-rtl patch      Apply the RTL fix (backs up original files first)
  claude-rtl unpatch    Remove the RTL fix and restore original files
  claude-rtl status     Show current patch status and Claude version info
  claude-rtl help       Show this help message

Safety:
  - Original files are backed up before any changes
  - Run "unpatch" anytime to restore the original state
  - If Claude crashes after patching, just run "unpatch" to fix it

Requirements:
  - Claude Desktop must NOT be running (close it first, check system tray)
  - Node.js 16 or later
  - Windows only (for now)

Created by Yuval Ra — https://www.linkedin.com/in/yuvalra/
`;

async function main() {
  const command = process.argv[2];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(0);
  }

  // Platform check
  if (process.platform !== "win32") {
    console.error("\n  Error: This tool only supports Windows for now.\n");
    process.exit(1);
  }

  // Node.js version check
  const nodeVersion = parseInt(process.versions.node.split(".")[0], 10);
  if (nodeVersion < 16) {
    console.error(`\n  Error: Node.js 16+ required (you have ${process.versions.node}).\n`);
    process.exit(1);
  }

  try {
    switch (command) {
      case "patch":
        await runPatch();
        break;
      case "unpatch":
        runUnpatch();
        break;
      case "status":
        runStatus();
        break;
      default:
        console.error(`\n  Unknown command: "${command}"`);
        console.log('  Run "claude-rtl help" for usage.\n');
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n  Unexpected error: ${err.message}\n`);
    if (err.stack) {
      console.error("  Stack trace (for bug reports):");
      console.error("  " + err.stack.split("\n").slice(1, 4).join("\n  "));
    }
    console.log("\n  If Claude Desktop is broken, try running: claude-rtl unpatch");
    console.log("  Or reinstall Claude Desktop to get a clean state.\n");
    process.exit(1);
  }
}

async function runPatch() {
  console.log("\n--- Claude RTL Fixer: Patching ---\n");
  const result = await patch();

  if (result.success) {
    console.log("\n  RTL fix applied successfully!\n");
    console.log(`  Claude Desktop v${result.version} has been patched.`);
    console.log("  Launch Claude Desktop and try typing in Hebrew or Arabic.\n");
    console.log('  To undo, run: claude-rtl unpatch\n');
  } else {
    console.error(`\n  Failed to patch: ${result.error}\n`);
    process.exit(1);
  }
}

function runUnpatch() {
  console.log("\n--- Claude RTL Fixer: Unpatching ---\n");
  const result = unpatch();

  if (result.success) {
    console.log("\n  RTL fix removed successfully!\n");
    console.log(`  Claude Desktop v${result.version} has been restored to original state.\n`);
  } else {
    console.error(`\n  Failed to unpatch: ${result.error}\n`);
    process.exit(1);
  }
}

function runStatus() {
  console.log("\n--- Claude RTL Fixer: Status ---\n");
  const result = status();

  if (!result.success) {
    console.error(`  ${result.error}\n`);
    process.exit(1);
  }

  console.log(`  Claude Desktop version: ${result.version}`);
  if (result.allVersions.length > 1) {
    console.log(`  All installed versions: ${result.allVersions.join(", ")}`);
  }
  console.log(`  Running:  ${result.running ? "Yes (close it before patching)" : "No"}`);
  console.log(`  Patched:  ${result.patched ? "Yes" : "No"}`);
  if (result.patched && result.patchInfo) {
    console.log(`    Patched on: ${result.patchInfo.patchedAt}`);
    console.log(`    Tool version: ${result.patchInfo.version}`);
  }
  if (result.codePatched !== result.patched) {
    console.log("  Warning: Marker and code state are out of sync!");
  }
  console.log(`  Backups:  ${result.backupsExist ? "Yes (can unpatch)" : "No"}`);
  console.log(`\n  Paths:`);
  console.log(`    App dir: ${result.paths.appDir}`);
  console.log(`    ASAR:    ${result.paths.asar}`);
  console.log(`    EXE:     ${result.paths.exe}`);
  console.log();
}

main();

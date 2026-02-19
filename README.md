# Claude RTL Fixer

Fix RTL (Hebrew, Arabic, etc.) text rendering in Claude Desktop for Windows.

Claude Desktop renders all text left-to-right, which makes Hebrew and Arabic text unreadable. This tool patches the app to auto-detect text direction so RTL languages display correctly.

## Before / After

**Before:** Hebrew text displays left-to-right (broken)
**After:** Each paragraph auto-detects its direction. Hebrew flows right-to-left, English stays left-to-right, mixed content works correctly.

## Requirements

- **Windows** (Claude Desktop for Windows only)
- **Node.js 16+** ([download](https://nodejs.org/))
- **Claude Desktop** must be **closed** before patching

## Quick Start

### Option 1: npx (no install needed)

```bash
npx claude-rtl-fixer patch
```

To remove:
```bash
npx claude-rtl-fixer unpatch
```

### Option 2: Clone and run

```bash
git clone https://github.com/Yu1586/claude-rtl-fixer.git
cd claude-rtl-fixer
npm install
node src/cli.js patch
```

To remove:
```bash
node src/cli.js unpatch
```

### Option 3: Global install

```bash
npm install -g claude-rtl-fixer
claude-rtl patch
```

## Commands

| Command | Description |
|---------|-------------|
| `patch` | Apply the RTL fix (backs up original files first) |
| `unpatch` | Remove the fix and restore original files |
| `status` | Show current patch status and version info |
| `help` | Show help message |

## Safety

- **Backup first** - original files are backed up before any changes
- **One-command undo** - run `unpatch` to restore everything instantly
- **Integrity verified** - validates file hashes before and after patching
- **Won't run while Claude is open** - prevents file corruption
- **Auto-rollback** - if anything fails mid-patch, original files are restored automatically
- **Double-patch protection** - refuses to patch if already patched

If Claude Desktop ever crashes or behaves strangely after patching:
```bash
npx claude-rtl-fixer unpatch
```
This restores the original files. You can also just reinstall Claude Desktop.

## What it does

The tool modifies Claude Desktop's preload script (`mainView.js` inside `app.asar`) to inject:

1. **CSS** - `unicode-bidi: plaintext` on message elements, so each paragraph auto-detects its text direction
2. **JavaScript** - A `MutationObserver` that sets `dir="auto"` on elements containing RTL characters, including during streaming responses
3. **Hash update** - Updates the integrity hash in `claude.exe` so the app accepts the modified files

Code blocks, math formulas, and other technical content always stay left-to-right.

## After Claude Desktop updates

When Claude Desktop auto-updates, it installs a new version in a new directory. Your patch stays on the old version. Simply run `patch` again to fix the new version:

```bash
npx claude-rtl-fixer patch
```

## Troubleshooting

**"Claude Desktop is currently running"**
Close Claude Desktop completely, including from the system tray (right-click the tray icon and quit).

**"Cannot write to file"**
Try running your terminal as Administrator.

**"Integrity mismatch"**
Claude Desktop may have been modified by another tool. Reinstall Claude Desktop and try again.

**App crashes after patching**
Run `unpatch` to restore original files, or reinstall Claude Desktop.

## Author

Created by **Yuval Ra** — [LinkedIn](https://www.linkedin.com/in/yuvalra/)

## License

MIT

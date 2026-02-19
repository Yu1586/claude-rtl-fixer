const fs = require("fs");
const crypto = require("crypto");

/**
 * Compute the SHA256 hash of the ASAR header string.
 *
 * ASAR format (Chromium Pickle):
 *   Offset 0-3:   outer pickle payload size (uint32 LE)
 *   Offset 4-7:   inner pickle total size (uint32 LE)
 *   Offset 8-11:  inner pickle payload size (uint32 LE)
 *   Offset 12-15: header string length (uint32 LE)
 *   Offset 16+:   header JSON string
 *
 * Electron hashes ONLY the header JSON string (from offset 16, length from offset 12).
 */
function computeAsarHeaderHash(asarPath) {
  const fd = fs.openSync(asarPath, "r");
  try {
    // Read the first 16 bytes to get the header structure
    const headerMeta = Buffer.alloc(16);
    fs.readSync(fd, headerMeta, 0, 16, 0);

    const headerStringLength = headerMeta.readUInt32LE(12);

    // Read the header string
    const headerString = Buffer.alloc(headerStringLength);
    fs.readSync(fd, headerString, 0, headerStringLength, 16);

    return crypto.createHash("sha256").update(headerString).digest("hex");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Read the current integrity hash embedded in claude.exe.
 *
 * The hash is stored in a PE resource (ElectronAsar/Integrity) as a JSON array:
 *   [{"file":"resources\\app.asar","alg":"SHA256","value":"<64-char-hex>"}]
 *
 * We search the binary for this known pattern rather than parsing PE resources,
 * which is simpler and works reliably.
 */
function readEmbeddedHash(exePath) {
  const buf = fs.readFileSync(exePath);
  // Search for the JSON pattern containing the hash
  const pattern = '"alg":"SHA256","value":"';
  const idx = buf.indexOf(pattern);

  if (idx === -1) {
    return { found: false, error: "Could not find integrity hash in exe" };
  }

  const hashStart = idx + pattern.length;
  const hash = buf.slice(hashStart, hashStart + 64).toString("ascii");

  // Validate it looks like a hex hash
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    return {
      found: false,
      error: `Found pattern but hash is invalid: ${hash}`,
    };
  }

  return { found: true, hash, offset: hashStart };
}

/**
 * Replace the old integrity hash with a new one in claude.exe.
 * Does a binary search-and-replace of the 64-char hex string.
 *
 * Returns { success, error? }
 */
function patchExeHash(exePath, oldHash, newHash) {
  if (oldHash === newHash) {
    return { success: true, message: "Hashes are identical, no change needed" };
  }

  if (!/^[0-9a-f]{64}$/.test(oldHash) || !/^[0-9a-f]{64}$/.test(newHash)) {
    return { success: false, error: "Invalid hash format" };
  }

  const buf = fs.readFileSync(exePath);
  const oldBuf = Buffer.from(oldHash, "ascii");
  const idx = buf.indexOf(oldBuf);

  if (idx === -1) {
    return {
      success: false,
      error:
        "Could not find old hash in exe.\n" +
        "  The exe may have been modified by another tool or updated.",
    };
  }

  // Verify it only appears once (safety check)
  const secondIdx = buf.indexOf(oldBuf, idx + 64);
  if (secondIdx !== -1) {
    return {
      success: false,
      error:
        "Old hash appears multiple times in exe — unsafe to patch.\n" +
        "  This is unexpected. Please report this issue.",
    };
  }

  // Replace
  const newBuf = Buffer.from(newHash, "ascii");
  newBuf.copy(buf, idx);

  fs.writeFileSync(exePath, buf);
  return { success: true };
}

module.exports = { computeAsarHeaderHash, readEmbeddedHash, patchExeHash };

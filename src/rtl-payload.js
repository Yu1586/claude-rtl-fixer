/**
 * RTL fix payload — CSS + JS injected into Claude Desktop's mainView.js preload script.
 *
 * Design principles:
 * - Each paragraph/cell auto-detects its direction independently
 * - Lists: CSS :has() detects RTL list items and flips markers to the right
 * - Tables: each cell detects direction independently
 * - Code blocks: always LTR, never touched
 * - Input areas: dir="auto" set once by JS, browser handles rest natively
 * - Streaming: debounced MutationObserver re-evaluates direction
 */

const RTL_CSS = `
/* === Claude RTL Fixer === */

/* --- Message text blocks: auto-detect direction --- */
[class*="message"] p,
[class*="message"] li,
[class*="message"] h1,
[class*="message"] h2,
[class*="message"] h3,
[class*="message"] h4,
[class*="message"] h5,
[class*="message"] h6,
[class*="message"] blockquote,
[data-testid*="message"] p,
[data-testid*="message"] li,
[data-testid*="message"] h1,
[data-testid*="message"] h2,
[data-testid*="message"] h3,
[data-testid*="message"] h4,
[data-testid*="message"] h5,
[data-testid*="message"] h6,
[data-testid*="message"] blockquote,
.prose p,
.prose li,
.prose h1, .prose h2, .prose h3, .prose h4, .prose h5, .prose h6,
.prose blockquote {
  unicode-bidi: plaintext;
  text-align: start;
}

/* --- Tables: each cell detects its own direction --- */
[class*="message"] td,
[class*="message"] th,
[data-testid*="message"] td,
[data-testid*="message"] th,
.prose td, .prose th {
  unicode-bidi: plaintext;
  text-align: start;
}

/* --- Lists: CSS :has() detects when list items have RTL dir ---
 * When our JS sets dir="auto" on an <li>, and that <li> is inside a list,
 * flip the list to RTL so bullet/number markers appear on the right side.
 * Using :has() (Chrome 105+, Electron supports it) for zero-timing-dependency.
 */
ul:has(> li[dir="auto"]),
ol:has(> li[dir="auto"]),
ul[dir="rtl"],
ol[dir="rtl"] {
  direction: rtl !important;
  padding-right: 2em !important;
  padding-left: 0 !important;
}
ul:has(> li[dir="auto"]) > li,
ol:has(> li[dir="auto"]) > li,
ul[dir="rtl"] > li,
ol[dir="rtl"] > li {
  text-align: start;
}


/* --- User input: dir="auto" set by JS once, CSS ensures it sticks --- */
textarea[dir="auto"], [contenteditable="true"][dir="auto"],
[class*="ProseMirror"][dir="auto"], [role="textbox"][dir="auto"] {
  text-align: start !important;
}
textarea, [contenteditable="true"],
[class*="ProseMirror"], [role="textbox"] {
  unicode-bidi: plaintext !important;
}

/* --- Code: ALWAYS LTR, never affected by RTL --- */
pre, code,
[class*="code"], [class*="Code"],
.hljs, [class*="CodeBlock"],
[class*="highlight"],
pre *, code *,
.katex, .katex *, .math, .math * {
  direction: ltr !important;
  unicode-bidi: isolate !important;
  text-align: left !important;
}

/* === End Claude RTL Fixer === */
`;

const RTL_JS = `
// === Claude RTL Fixer — MutationObserver ===
(function() {
  // RTL Unicode ranges: Hebrew, Arabic, Thaana, Syriac, and presentation forms
  var RTL_REGEX = /[\\u0590-\\u05FF\\u0600-\\u06FF\\u0700-\\u074F\\u0750-\\u077F\\u0780-\\u07BF\\u08A0-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF]/;

  // Text-level elements that get dir="auto"
  var TEXT_SELECTORS = 'p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th';

  // Elements that must stay LTR
  var CODE_SELECTORS = 'pre, code, [class*="code"], [class*="Code"], [class*="CodeBlock"], .hljs, .katex, .math';

  // Input areas — set dir="auto" ONCE (the browser handles direction natively after that)
  var INPUT_SELECTORS = 'textarea, [contenteditable="true"], [class*="ProseMirror"], [role="textbox"]';

  function isCodeElement(el) {
    if (!el || !el.tagName) return false;
    var tag = el.tagName.toLowerCase();
    if (tag === 'pre' || tag === 'code') return true;
    try { return el.closest(CODE_SELECTORS) !== null; } catch(e) { return false; }
  }

  function isInputArea(el) {
    if (!el) return false;
    try {
      if (el.matches && el.matches(INPUT_SELECTORS)) return true;
      if (el.closest && el.closest(INPUT_SELECTORS)) return true;
    } catch(e) {}
    return false;
  }

  function hasRtl(text) {
    return RTL_REGEX.test(text);
  }

  // Set dir="auto" on text-level elements when they contain RTL text.
  // For <li> elements, the CSS :has() rule will automatically flip the parent list.
  function applyDir(el) {
    if (isCodeElement(el)) return;
    var text = el.textContent || '';
    if (hasRtl(text)) {
      if (el.getAttribute('dir') !== 'auto') {
        el.setAttribute('dir', 'auto');
      }
    } else if (el.getAttribute('dir') === 'auto') {
      el.removeAttribute('dir');
    }
  }

  // Set dir="auto" on input elements ONCE — browser handles the rest natively
  // (no per-keystroke JS, so no freeze)
  function setupInputDir(el) {
    if (el.getAttribute('dir') === 'auto') return;
    el.setAttribute('dir', 'auto');
  }

  function setupAllInputs() {
    document.querySelectorAll(INPUT_SELECTORS).forEach(setupInputDir);
  }

  function processNode(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    try {
      // Setup dir="auto" on any new input elements (one-time per element)
      if (node.matches && node.matches(INPUT_SELECTORS)) {
        setupInputDir(node);
      }
      var inputs = node.querySelectorAll ? node.querySelectorAll(INPUT_SELECTORS) : [];
      for (var k = 0; k < inputs.length; k++) {
        setupInputDir(inputs[k]);
      }

      // Process message text elements (skip inputs)
      if (!isInputArea(node) && node.matches(TEXT_SELECTORS)) {
        applyDir(node);
      }
      var children = node.querySelectorAll(TEXT_SELECTORS);
      for (var i = 0; i < children.length; i++) {
        if (!isInputArea(children[i])) {
          applyDir(children[i]);
        }
      }
    } catch(e) {}
  }

  function processAll() {
    setupAllInputs();
    document.querySelectorAll(TEXT_SELECTORS).forEach(function(el) {
      if (!isInputArea(el)) applyDir(el);
    });
  }

  // Debounce for streaming — batches rapid mutations into one rAF
  var pendingUpdate = null;
  var pendingElements = new Set();

  function scheduleUpdate(el) {
    pendingElements.add(el);
    if (!pendingUpdate) {
      pendingUpdate = requestAnimationFrame(function() {
        pendingElements.forEach(function(e) {
          try { applyDir(e); } catch(err) {}
        });
        pendingElements.clear();
        pendingUpdate = null;
      });
    }
  }

  var observer = new MutationObserver(function(mutations) {
    for (var m = 0; m < mutations.length; m++) {
      var mut = mutations[m];
      if (mut.type === 'childList') {
        for (var i = 0; i < mut.addedNodes.length; i++) {
          processNode(mut.addedNodes[i]);
        }
      } else if (mut.type === 'characterData') {
        // Skip input areas (prevents freeze when typing)
        var target = mut.target;
        if (isInputArea(target.parentElement)) continue;

        // Streaming — find nearest text block ancestor
        var el = target.parentElement;
        while (el && el !== document.body) {
          try {
            if (el.matches(TEXT_SELECTORS)) {
              scheduleUpdate(el);
              break;
            }
          } catch(e) {}
          el = el.parentElement;
        }
      }
    }
  });

  function startObserving() {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });
    processAll();
  }

  if (document.body) {
    startObserving();
  } else {
    document.addEventListener('DOMContentLoaded', startObserving);
  }
})();
// === End Claude RTL Fixer ===
`;

/**
 * Returns the code to append to mainView.js.
 */
function getRtlPayload() {
  const escapedCSS = RTL_CSS.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");
  const escapedJS = RTL_JS.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$/g, "\\$");

  return `

// === Claude RTL Fixer — Injected by claude-rtl-fixer ===
require("electron").webFrame.insertCSS(\`${escapedCSS}\`, {cssOrigin: "author"});

// Inject MutationObserver script into the page
require("electron").webFrame.executeJavaScript(\`${escapedJS}\`);
// === End Claude RTL Fixer ===
`;
}

/** Marker to detect if a file has already been patched */
const RTL_MARKER = "Claude RTL Fixer";

function isPatched(content) {
  return content.includes(RTL_MARKER);
}

module.exports = { getRtlPayload, isPatched, RTL_MARKER };

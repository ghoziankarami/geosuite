// Drop developer comments from the inline <script> blocks of a built phase.
//
// Why: the phases ship with every comment of their source, about 165 KB in
// Resource and 190 KB in Assay, and the size budgets (run-tier.sh, perf-budget.py)
// are ceilings that may only go down. Comments that are a whole line of their own
// are the safe part to drop.
//
// What it removes: a `//` comment or a `/* */` comment that is alone on its line(s)
// and sits in plain code (not in a string, template literal, regular expression or
// another comment). Comments after code on the same line stay. Comments that carry
// licence or attribution words, and `//!` / `/*!` comments, stay.
//
// What it keeps: the number of lines (a removed comment leaves its newlines), so
// positions in an error stack still match the source file.
//
// Safety: a real scanner tracks strings, template literals with nested `${ }`,
// regular expressions and comments. If any script ends in the middle of a string,
// template, comment or an unbalanced brace, the build throws instead of guessing.
// Set OREBIT_KEEP_COMMENTS=1 to keep every comment while debugging dist/.
import vm from "node:vm";

const KEEP = /licen[sc]e|copyright|spdx|\(c\)|@preserve|\bgpl\b|attribution/i;
const REGEX_AFTER_WORD = new Set(["return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await"]);
const isWs = (c) => c === " " || c === "\t" || c === "\r" || c === "\f" || c === "\v";
const isWordChar = (c) => /[A-Za-z0-9_$]/.test(c) || c > "\u007f";
const removable = (text) => !KEEP.test(text) && !text.startsWith("//!") && !text.startsWith("/*!") && !text.startsWith("//#");

// Returns the script with whole-line comments blanked, plus how many it dropped.
export function stripWholeLineComments(js) {
  const n = js.length;
  const ranges = [];
  const braces = []; // "b" for a block brace, "t" for the brace that closes a template ${ }
  let i = 0, lineStart = 0, codeOnLine = false, last = "", lastWord = "";

  const newlinesIn = (from, to) => {
    for (let k = from; k < to; k++) if (js[k] === "\n") { lineStart = k + 1; codeOnLine = false; }
  };
  // Scan template text from `from` (just after a backtick or a closing brace).
  // Returns the index after the closing backtick, or -(index after "${") when an expression starts.
  const scanTemplate = (from) => {
    let j = from;
    while (j < n) {
      const ch = js[j];
      if (ch === "\\") j += 2;
      else if (ch === "`") return j + 1;
      else if (ch === "$" && js[j + 1] === "{") return -(j + 2);
      else j++;
    }
    throw new Error("unterminated template literal");
  };
  const enterTemplate = (from) => {
    const r = scanTemplate(from);
    if (r < 0) { braces.push("t"); newlinesIn(from, -r); return -r; }
    newlinesIn(from, r);
    return r;
  };
  const scanString = (q, from) => {
    let j = from;
    while (j < n) {
      const ch = js[j];
      if (ch === "\\") j += 2;
      else if (ch === q) return j + 1;
      else if (ch === "\n") throw new Error("unterminated string literal");
      else j++;
    }
    throw new Error("unterminated string literal");
  };
  const regexAllowed = () => {
    if (last === "") return true;
    if (last === "a") return REGEX_AFTER_WORD.has(lastWord);
    return !(last === ")" || last === "]" || last === "s"); // after a value, "/" divides
  };
  // Returns the index after a regular expression literal starting at `from`, or -1 if this is not one.
  const scanRegex = (from) => {
    let j = from + 1, inClass = false;
    while (j < n) {
      const ch = js[j];
      if (ch === "\n") return -1;
      if (ch === "\\") j += 2;
      else if (ch === "[") { inClass = true; j++; }
      else if (ch === "]") { inClass = false; j++; }
      else if (ch === "/" && !inClass) { j++; while (j < n && /[a-z]/i.test(js[j])) j++; return j; }
      else j++;
    }
    return -1;
  };

  while (i < n) {
    const c = js[i], d = js[i + 1];
    if (c === "\n") { lineStart = i + 1; codeOnLine = false; i++; continue; }
    if (isWs(c)) { i++; continue; }
    if (c === "/" && d === "/") {
      let e = js.indexOf("\n", i);
      if (e < 0) e = n;
      if (!codeOnLine && removable(js.slice(i, e))) ranges.push([lineStart, js[e - 1] === "\r" ? e - 1 : e]);
      i = e;
      continue;
    }
    if (c === "/" && d === "*") {
      let e = js.indexOf("*/", i + 2);
      if (e < 0) throw new Error("unterminated block comment");
      e += 2;
      let k = e;
      while (k < n && js[k] !== "\n" && isWs(js[k])) k++;
      const alone = !codeOnLine && (k >= n || js[k] === "\n");
      if (alone && removable(js.slice(i, e))) { ranges.push([lineStart, k]); newlinesIn(i, e); codeOnLine = false; }
      else { newlinesIn(i, e); codeOnLine = true; }
      i = e;
      continue;
    }
    codeOnLine = true;
    if (c === '"' || c === "'") {
      const e = scanString(c, i + 1);
      newlinesIn(i, e); // a backslash-newline continuation moves to the next line
      i = e; last = "s";
      continue;
    }
    if (c === "`") { i = enterTemplate(i + 1); last = "s"; continue; }
    if (c === "{") { braces.push("b"); i++; last = "{"; continue; }
    if (c === "}") {
      const kind = braces.pop();
      if (kind === undefined) throw new Error("unbalanced closing brace");
      if (kind === "t") { i = enterTemplate(i + 1); last = "s"; continue; }
      i++; last = "}";
      continue;
    }
    if (c === "/") {
      if (regexAllowed()) {
        const e = scanRegex(i);
        if (e > 0) { i = e; last = "s"; continue; }
      }
      i++; last = "/";
      continue;
    }
    if (isWordChar(c)) {
      let e = i + 1;
      while (e < n && isWordChar(js[e])) e++;
      lastWord = js.slice(i, e); last = "a"; i = e;
      continue;
    }
    if ((c === "+" || c === "-") && d === c) { i += 2; last = "a"; lastWord = ""; continue; } // i++ / 2 is a division
    last = c; i++;
  }
  if (braces.length) throw new Error("unbalanced opening brace");

  if (!ranges.length) return { text: js, removed: 0 };
  let out = "", at = 0;
  for (const [from, to] of ranges) {
    out += js.slice(at, from) + js.slice(from, to).replace(/[^\n]/g, "");
    at = to;
  }
  out += js.slice(at);
  return { text: out, removed: ranges.length };
}

// Blocks written by the build's patchers (ops/scripts/patchers). The patchers re-create them,
// comments included, and the gate checks that re-running them changes nothing, so they are left alone.
const GENERATED = [
  ["<!-- OREBIT_V194_SHELL_START -->", "<!-- OREBIT_V194_SHELL_END -->"],
  ["<!-- OREBIT_V193_SHELL_START -->", "<!-- OREBIT_V193_SHELL_END -->"],
  ["<!-- OREBIT_HELP_PANEL_START -->", "<!-- OREBIT_HELP_PANEL_END -->"],
];
export function generatedRanges(html) {
  const ranges = [];
  for (const [open, close] of GENERATED) {
    for (let from = 0; ;) {
      const start = html.indexOf(open, from);
      if (start < 0) break;
      const end = html.indexOf(close, start);
      if (end < 0) throw new Error(`generated block ${open} has no ${close}`);
      ranges.push([start, end + close.length]);
      from = end + close.length;
    }
  }
  return ranges;
}
const SCRIPT = /(<script\b([^>]*)>)([\s\S]*?)(<\/script>)/gi;
const isJs = (attrs) => !/\bsrc\s*=/i.test(attrs) && (!/\btype\s*=/i.test(attrs) || /\btype\s*=\s*["']?(text\/javascript|module|application\/javascript)\b/i.test(attrs));
const compiles = (code) => { try { new vm.Script(code); return true; } catch { return false; } };

// Strips every inline script of a built phase (a Buffer) and returns the new Buffer.
export function stripScriptComments(buf, name = "phase") {
  if (process.env.OREBIT_KEEP_COMMENTS === "1") return { bytes: buf, removed: 0, saved: 0 };
  const html = buf.toString("utf8");
  if (!Buffer.from(html, "utf8").equals(buf)) throw new Error(`${name}: not valid UTF-8, refusing to rewrite`);
  let removed = 0;
  const generated = generatedRanges(html);
  const out = html.replace(SCRIPT, (whole, open, attrs, body, close, offset) => {
    if (!isJs(attrs) || !body.trim()) return whole;
    if (generated.some(([from, to]) => offset >= from && offset < to)) return whole;
    let result;
    try { result = stripWholeLineComments(body); }
    catch (error) { throw new Error(`${name}: comment stripping stopped in a <script> block: ${error.message}`); }
    if (result.text === body) return whole;
    if (compiles(body) && !compiles(result.text)) throw new Error(`${name}: a <script> block no longer compiles after stripping comments`);
    removed += result.removed;
    return open + result.text + close;
  });
  const bytes = Buffer.from(out, "utf8");
  return { bytes, removed, saved: buf.length - bytes.length };
}

// Self-check at import time, like compactCss: the tricky cases must behave.
{
  const run = (s) => stripWholeLineComments(s).text;
  const same = (s) => { if (run(s) !== s) throw new Error("comment stripping changed code it must keep: " + JSON.stringify(s)); };
  const cases = [
    "var a = 'http://x.y/z'; // keep\nvar b = 1;",
    'var a = "/* not a comment */";\n',
    "var t = `\n// inside a template\n${ x }\n/* also */`;\n",
    "var t = `a${ `b${ c }` }\n// still template\n`;\n",
    "var r = /['\"`]\\/\\*/g; var q = 1;\n",
    "var r = x.split(/\\/\\//);\n",
    "var d = (a + b) / 2; // division\nvar e = i++ / 2;\n",
    "var s = 'a\\\n// continued string';\n",
    "var c = a ? /x'/ : /y\"/;\n",
    "x = 1; /* trailing */\n",
    "/*! keep */\n// Copyright keep\n// SPDX-License-Identifier: GPL-3.0\n",
  ];
  for (const s of cases) same(s);
  const gone = [["a();\n  // gone\nb();\n", "a();\n\nb();\n"], ["a();\n/* gone\n   too */\nb();\n", "a();\n\n\nb();\n"]];
  for (const [from, to] of gone) if (run(from) !== to) throw new Error("comment stripping did not remove a whole-line comment: " + JSON.stringify(from));
  for (const bad of ["var a = 'x\n", "var t = `x", "/* x", "{ a(", "} "]) {
    let threw = false;
    try { stripWholeLineComments(bad); } catch { threw = true; }
    if (!threw) throw new Error("comment stripping accepted a broken script: " + JSON.stringify(bad));
  }
}

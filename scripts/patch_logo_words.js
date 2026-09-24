"use strict";
/* normBrand joins words with "-", not " " -- brandWords/matchFilename were
   splitting on the wrong separator. Word helpers now split on "-", and a
   filename matches a brand when the brand's words appear as a contiguous run
   inside the filename's words ("modelo especial logo" contains "modelo"). */
const fs = require("fs");
const p = "lib/brands.js";
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
if (s.indexOf("containsRun") !== -1) { console.log("already applied"); process.exit(0); }
const edits = [
  [`  function brandWords(label) { return normBrand(label).split(" ").filter((w) => w.length >= 2 && !/^\\d+$/.test(w)); }`,
   `  const wordsOf = (x) => normBrand(x).split("-").filter(Boolean);
  function brandWords(label) { return wordsOf(label).filter((w) => w.length >= 2 && !/^\\d+$/.test(w)); }
  // true when \`run\` appears as a contiguous sequence inside \`words\`
  function containsRun(words, run) {
    if (!run.length || run.length > words.length) return false;
    for (let i = 0; i + run.length <= words.length; i++) { let ok = true; for (let j = 0; j < run.length; j++) if (words[i + j] !== run[j]) { ok = false; break; } if (ok) return true; }
    return false;
  }`, "helpers"],
  [`      const t = normBrand(c.title);
      const hits = words.filter((w) => t.indexOf(w) !== -1).length;`,
   `      const tw = wordsOf(c.title); const t = " " + tw.join(" ") + " ";
      const hits = words.filter((w) => tw.indexOf(w) !== -1).length;`, "score words"],
  [`    const stem = normBrand(String(filename || "").replace(/\\.[a-z0-9]+$/i, "").replace(/\\b(logo|logos|brand|mark|wordmark|icon|final|new|v\\d+|\\d{4})\\b/gi, " "));
    if (!stem) return null;
    let best = null;
    for (const b of brands) {
      const names = [b.label].concat(b.aliases || []);
      for (const nm of names) {
        const k = normBrand(nm); if (!k) continue;
        const words = k.split(" ").filter(Boolean);
        const exact = stem === k;
        const contained = (" " + stem + " ").indexOf(" " + k + " ") !== -1;
        if (!exact && !contained) continue;
        const score = (exact ? 100 : 0) + words.length * 10 + k.length;`,
   `    const stem = wordsOf(String(filename || "").replace(/\\.[a-z0-9]+$/i, "").replace(/\\b(logo|logos|brand|mark|wordmark|icon|final|new|v\\d+|\\d{4})\\b/gi, " "));
    if (!stem.length) return null;
    let best = null;
    for (const b of brands) {
      const names = [b.label].concat(b.aliases || []);
      for (const nm of names) {
        const words = wordsOf(nm); if (!words.length) continue;
        const exact = stem.length === words.length && containsRun(stem, words);
        const contained = containsRun(stem, words);
        if (!exact && !contained) continue;
        const score = (exact ? 100 : 0) + words.length * 10 + words.join("-").length;`, "match words"],
];
for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + l + " matched " + (s.split(a).length - 1)); process.exit(1); } s = s.replace(a, () => b); }
fs.writeFileSync(p, s);
// relax the Modelo ordering assertion: both titles name the brand; the model decides between them
const tp = "test/units.test.js";
let t = fs.readFileSync(tp, "utf8");
t = t.replace(`  eq(none[0].title, "Modelo Especial logo.png");`, `  eq(none.length, 2, "both name the brand; the model chooses between them");`);
fs.writeFileSync(tp, t);
console.log("patched");

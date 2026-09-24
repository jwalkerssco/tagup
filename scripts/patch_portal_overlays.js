"use strict";
/* The four in-tree overlays in src/tagup-ui.jsx (EditRequest, ImportModal,
   StyleForm, MaterialForm) render through a portal onto document.body, like
   shared.jsx's Modal: position:fixed is measured against the nearest
   transformed ancestor, and inside a long page that centred them off-screen.
   Each overlay's root is `return <div style={{ position: "fixed", inset: 0,
   zIndex: 8000, ...` and its close is the first following line that is
   exactly `  </div>;` (indent 2 -- the inner closes are indented deeper). */
const fs = require("fs");
const p = "src/tagup-ui.jsx";
let lines = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n").split("\n");
if (lines.some((l) => l.indexOf("createPortal(") !== -1)) { console.log("already applied"); process.exit(0); }
const START = '  return <div style={{ position: "fixed", inset: 0, zIndex: 8000,';
let n = 0;
for (let i = 0; i < lines.length; i++) {
  if (!lines[i].startsWith(START)) continue;
  let j = i + 1; while (j < lines.length && lines[j] !== "  </div>;") j++;
  if (j >= lines.length || j - i > 200) { console.error("no root close for overlay at line " + (i + 1)); process.exit(1); }
  lines[i] = lines[i].replace("  return <div", "  return createPortal(<div");
  lines[j] = "  </div>, document.body);";
  n++;
}
if (n !== 4) { console.error("expected 4 overlays, patched " + n); process.exit(1); }
const imp = lines.findIndex((l) => l.startsWith('import React'));
lines.splice(imp + 1, 0, 'import { createPortal } from "react-dom";');
fs.writeFileSync(p, lines.join("\n"));
console.log("portaled " + n + " overlays");

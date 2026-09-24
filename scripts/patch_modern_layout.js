"use strict";
/* The Tagify look as a fourth composed layout, "Modern": logo left in a
   circle, item name small, big price with raised cents, the package in a
   rounded pill -- what the sample sheet showed and what the team is used to.
   Plus material presets so an 18-up landscape sheet is one click, and that
   sheet joins the defaults for new workspaces. Sentinel-guarded per file. */
const fs = require("fs");
function patch(file, sentinel, edits) {
  let s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (s.indexOf(sentinel) !== -1) { console.log(file + ": already applied"); return; }
  for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + file + " / " + l + " matched " + (s.split(a).length - 1)); process.exit(1); } s = s.replace(a, () => b); }
  fs.writeFileSync(file, s); console.log(file + ": " + edits.length + " edits");
}

patch("lib/tagup-core.js", '"modern"', [
  [`    { id: "minimal", label: "Minimal", sub: "White tag, thin rule, small logo" },
  ];`,
   `    { id: "minimal", label: "Minimal", sub: "White tag, thin rule, small logo" },
    { id: "modern", label: "Modern", sub: "Logo left, big price, package in a pill" },
  ];`, "layout list"],
  [`    const band = th.layout === "classic" || bold`,
   `    // Modern: the Tagify shape. Brand logo (else chain logo, else the chain's
    // initial in an accent circle) on the left; item, price and a package pill
    // stacked on the right. The pill takes the accent, so a chain's colour
    // shows even with no logo.
    if (th.layout === "modern") {
      const brandSrc = th.showBrandLogo !== false && req.brandLogoKey ? (req.brandLogoSrc || ((o.brandBase || "/api/assets/blogo/") + encodeURIComponent(req.brandLogoKey))) : null;
      const logoBox = brandSrc ? '<div class="mlogo"><img src="' + esc(brandSrc) + '" alt=""></div>'
        : logoUrl ? '<div class="mlogo"><img src="' + esc(logoUrl) + '" alt=""></div>'
        : '<div class="mlogo mini" style="background:' + accent + ";color:" + th.accentFg + '">' + esc(String(chainLabel || "$").trim().charAt(0).toUpperCase() || "$") + "</div>";
      let mmoney;
      if (hasPrice(ct)) {
        mmoney = '<div class="mprice" style="color:' + priceColor + '">' +
          (parts ? '<span class="cur">$</span><span class="whole">' + esc(parts.whole) + '</span><span class="cents">' + esc(parts.cents) + "</span>" : '<span class="multi">' + esc(pl) + "</span>") + "</div>" +
          (th.showSize && req.packageSize ? '<div class="mpill" style="background:' + accent + ";color:" + th.accentFg + '">' + esc(req.packageSize) + "</div>" : "") +
          (wasLine || req.note ? '<div class="msub">' + (wasLine ? '<span class="was">' + esc(wasLine) + "</span> " : "") + esc(req.note || "") + "</div>" : "");
      } else {
        mmoney = '<div class="mprice op" style="color:' + accent + '">' + esc(req.note || "") + "</div>" + (th.showSize && req.packageSize ? '<div class="mpill" style="background:' + accent + ";color:" + th.accentFg + '">' + esc(req.packageSize) + "</div>" : "");
      }
      const mtop = (tagline ? '<span class="mtag" style="color:' + accent + '">' + esc(tagline) + "</span>" : "");
      return '<div class="tag modern" style="--u:' + u.toFixed(3) + ";width:" + W + "in;height:" + H + "in;background:" + bg + ";color:" + fg + ";font-family:" + font.css + ";--head:" + font.head.replace(/"/g, "'") + '">' +
        '<div class="mrow">' + logoBox + '<div class="mcol"><div class="mitem">' + esc(req.itemName) + mtop + "</div>" + mmoney + "</div></div>" +
        ((req.accountName || req.storeName) && o.showAccount ? '<div class="acct">' + esc(req.accountName || req.storeName) + "</div>" : "") +
        "</div>";
    }

    const band = th.layout === "classic" || bold`, "modern branch"],
  [`    ".tag.bold .item,.tag.bold .size{text-shadow:0 0 1px rgba(0,0,0,.15)}" +`,
   `    ".tag.bold .item,.tag.bold .size{text-shadow:0 0 1px rgba(0,0,0,.15)}" +
    ".tag.modern .mrow{flex:1;display:flex;align-items:center;gap:calc(.07in*var(--u));padding:calc(.06in*var(--u)) calc(.08in*var(--u));min-height:0}" +
    ".tag.modern .mlogo{flex:0 0 27%;aspect-ratio:1;max-height:88%;border-radius:50%;overflow:hidden;display:flex;align-items:center;justify-content:center}" +
    ".tag.modern .mlogo img{width:92%;height:92%;object-fit:contain;display:block}" +
    ".tag.modern .mlogo.mini{font-family:var(--head);font-weight:700;font-size:calc(.38in*var(--u));line-height:1}" +
    ".tag.modern .mcol{flex:1;min-width:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:calc(.015in*var(--u))}" +
    ".tag.modern .mitem{font-family:var(--head);text-transform:uppercase;font-weight:700;font-size:calc(.1in*var(--u));line-height:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:flex;gap:calc(.06in*var(--u));align-items:baseline}" +
    ".tag.modern .mtag{font-size:calc(.075in*var(--u));font-weight:700;letter-spacing:.04em}" +
    ".tag.modern .mprice{font-family:var(--head);font-weight:700;display:flex;align-items:flex-start;line-height:.88;letter-spacing:-.02em}" +
    ".tag.modern .mprice .cur{font-size:calc(.17in*var(--u));margin-top:calc(.035in*var(--u))}" +
    ".tag.modern .mprice .whole{font-size:calc(.42in*var(--u))}" +
    ".tag.modern .mprice .cents{font-size:calc(.17in*var(--u));margin-top:calc(.035in*var(--u));margin-left:calc(.012in*var(--u))}" +
    ".tag.modern .mprice .multi{font-size:calc(.3in*var(--u))}" +
    ".tag.modern .mprice.op{font-size:calc(.18in*var(--u));text-transform:uppercase;line-height:1}" +
    ".tag.modern .mpill{font-family:var(--head);font-weight:700;font-size:calc(.085in*var(--u));line-height:1;padding:calc(.03in*var(--u)) calc(.08in*var(--u));border-radius:calc(.12in*var(--u));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;margin-top:calc(.02in*var(--u))}" +
    ".tag.modern .msub{font-size:calc(.075in*var(--u));font-weight:600;opacity:.85;margin-top:calc(.02in*var(--u));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}" +
    ".tag.modern .msub .was{text-decoration:line-through;opacity:.8}" +`, "modern css"],
  [`    { id: "mat_2x1_40", name: "Small tag 2x1 (40 per sheet)", tagW: 2, tagH: 1, sheetW: 8.5, sheetH: 11, cols: 4, rows: 10, averySku: null },`,
   `    { id: "mat_2x1_40", name: "Small tag 2x1 (40 per sheet)", tagW: 2, tagH: 1, sheetW: 8.5, sheetH: 11, cols: 4, rows: 10, averySku: null },
    { id: "mat_18up_land", name: "Shelf tag 18-up landscape (3x6)", tagW: 3.667, tagH: 1.417, sheetW: 11, sheetH: 8.5, cols: 3, rows: 6, averySku: null },`, "default material"],
  [`    FONTS: FONTS, LAYOUTS: LAYOUTS,`,
   `    MATERIAL_PRESETS: [
      { name: "Shelf tag 18-up landscape (3x6)", tagW: 3.667, tagH: 1.417, sheetW: 11, sheetH: 8.5, cols: 3, rows: 6, averySku: "" },
      { name: "Avery 5160 address (30-up)", tagW: 2.625, tagH: 1, sheetW: 8.5, sheetH: 11, cols: 3, rows: 10, averySku: "5160" },
      { name: "Avery 5163 shipping (10-up)", tagW: 4, tagH: 2, sheetW: 8.5, sheetH: 11, cols: 2, rows: 5, averySku: "5163" },
      { name: "Avery 5164 (6-up)", tagW: 4, tagH: 3.333, sheetW: 8.5, sheetH: 11, cols: 2, rows: 3, averySku: "5164" },
      { name: "Avery 5165 full sheet", tagW: 8.5, tagH: 11, sheetW: 8.5, sheetH: 11, cols: 1, rows: 1, averySku: "5165" },
      { name: "Case card 11x17", tagW: 11, tagH: 17, sheetW: 11, sheetH: 17, cols: 1, rows: 1, averySku: "" },
    ],
    FONTS: FONTS, LAYOUTS: LAYOUTS,`, "presets export"],
]);

patch("src/tagup-ui.jsx", "MATERIAL_PRESETS", [
  [`          <Field ui={ui} label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Shelf talker 3x2" style={inputStyle(ui)} /></Field>
          <div style={{ display: "flex", gap: 10 }}><Num k="tagW" label="Tag width (in)" /><Num k="tagH" label="Tag height (in)" /></div>`,
   `          <Field ui={ui} label="Start from a preset" hint="The sheet in the printer. Pick one, then adjust the numbers if your stock differs.">
            <select value="" onChange={(e) => { const p = CORE.MATERIAL_PRESETS[parseInt(e.target.value, 10)]; if (p) set(Object.assign({}, p, { name: f.name || p.name })); }} style={inputStyle(ui)}><option value="">— pick —</option>{CORE.MATERIAL_PRESETS.map((p, i) => <option key={i} value={i}>{p.name} · {p.cols * p.rows}/sheet · {p.sheetW}×{p.sheetH}</option>)}</select>
          </Field>
          <Field ui={ui} label="Name"><input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Shelf talker 3x2" style={inputStyle(ui)} /></Field>
          <div style={{ display: "flex", gap: 10 }}><Num k="tagW" label="Tag width (in)" /><Num k="tagH" label="Tag height (in)" /></div>`, "presets ui"],
]);

// demo seed: Kent Kwik in the Modern layout so screenshots show it
let seed = fs.readFileSync("scripts/seed-demo.js", "utf8");
if (seed.indexOf('layout: "modern"') === -1) {
  seed = seed.replace(`{ name: "Kent Kwik", chainId: chainId("Kent Kwik"), format: "tag", kind: "composed", theme: { layout: "classic", accent: "#1D4ED8", accentFg: "#FFFFFF", font: "anton" } },`,
    `{ name: "Kent Kwik", chainId: chainId("Kent Kwik"), format: "tag", kind: "composed", theme: { layout: "modern", accent: "#1D4ED8", accentFg: "#FFFFFF", font: "oswald" } },`);
  fs.writeFileSync("scripts/seed-demo.js", seed); console.log("seed: Kent Kwik -> modern");
}
// tests
let t = fs.readFileSync("test/units.test.js", "utf8");
if (t.indexOf("modern layout") === -1) {
  const anchor = `/* ---------------- catalog sheet ---------------- */`;
  t = t.replace(anchor, `t("modern layout: logo circle, price with raised cents, package pill in the accent; falls back to the chain initial; 2-for reads whole", () => {
  const st = { id: "s", name: "DK", kind: "composed", theme: CORE.themeMerge({ layout: "modern", accent: "#1D4ED8", accentFg: "#FFFFFF" }) };
  const h = CORE.renderTag({ contentType: "standard_price", itemName: "Michelob Ultra", packageSize: "4pk 16oz Cans", price: 4.99, chainLabel: "DK" }, st, { tagW: 3.667, tagH: 1.417 });
  ok(/class="tag modern"/.test(h)); ok(/mlogo mini" style="background:#1D4ED8;color:#FFFFFF">D</.test(h), "chain initial when no logo"); ok(/<span class="whole">4<\\/span><span class="cents">99/.test(h)); ok(/mpill" style="background:#1D4ED8;color:#FFFFFF">4pk 16oz Cans/.test(h));
  const withLogo = CORE.renderTag({ contentType: "standard_price", itemName: "Bud Light", price: 5, multiBuyQty: 2, brandLogoKey: "bl_1" }, st, { tagW: 3.667, tagH: 1.417 });
  ok(/mlogo"><img src="\\/api\\/assets\\/blogo\\/bl_1"/.test(withLogo), "brand logo fills the circle"); ok(/class="multi">2\\/\\$5\\.00</.test(withLogo));
  ok(CORE.LAYOUTS.some((l) => l.id === "modern")); ok(CORE.MATERIAL_PRESETS.some((p) => p.cols === 3 && p.rows === 6 && p.sheetW === 11));
});

` + anchor);
  fs.writeFileSync("test/units.test.js", t); console.log("test added");
}
console.log("done");

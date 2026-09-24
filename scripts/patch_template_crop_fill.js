"use strict";
/* Chain templates, two things the first real upload asked for (2026-09-24 --
   a Tagify sample SHEET, 18 finished tags with $4.99 and a $ placeholder
   baked into the pixels):
   1. CROP: "the artwork is a whole sheet -- columns x rows, take cell N"
      cuts one tag out client-side and sizes it from the sheet's printed size.
   2. FILL: a placed field can paint a solid box first, so a live price /
      package / brand-logo field COVERS the sample text under it.
   Sentinel-guarded per file. */
const fs = require("fs");
function patch(file, sentinel, edits) {
  let s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (s.indexOf(sentinel) !== -1) { console.log(file + ": already applied"); return; }
  for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + file + " / " + l + " matched " + (s.split(a).length - 1)); process.exit(1); } s = s.replace(a, () => b); }
  fs.writeFileSync(file, s); console.log(file + ": " + edits.length + " edits");
}

patch("lib/tagup-core.js", "out.fill =", [
  [`      upper: b.upper !== false,
      on: b.on !== false,
    };`,
   `      upper: b.upper !== false,
      on: b.on !== false,
    };
    // A solid box painted under the field: covers sample text baked into the
    // chain's artwork (a Tagify sheet ships with $4.99 printed on every tag).
    out.fill = HEX.test(String(b.fill || "")) ? b.fill : null;`, "normalize fill"],
  [`        return '<div class="f fimg" style="left:' + f.x + "%;top:" + f.y + "%;width:" + f.w + "%;height:" + f.h + '%"><img src="' + esc(isrc) + '" alt="" style="object-position:' + pos + " " + (f.valign === "top" ? "top" : f.valign === "bottom" ? "bottom" : "center") + '"></div>';`,
   `        return '<div class="f fimg" style="left:' + f.x + "%;top:" + f.y + "%;width:" + f.w + "%;height:" + f.h + "%" + (f.fill ? ";background:" + f.fill : "") + '"><img src="' + esc(isrc) + '" alt="" style="object-position:' + pos + " " + (f.valign === "top" ? "top" : f.valign === "bottom" ? "bottom" : "center") + '"></div>';`, "image fill"],
  [`";white-space:" + (spec.wrap ? "normal" : "nowrap") + '">' + content + "</div>";`,
   `";white-space:" + (spec.wrap ? "normal" : "nowrap") + (f.fill ? ";background:" + f.fill : "") + '">' + content + "</div>";`, "text fill"],
]);

patch("src/tagup-ui.jsx", "cropCellImage", [
  [`const TPL_MAX_PX = 2400;`,
   `const TPL_MAX_PX = 2400;
// One cell out of a sheet of tags: equal grid, 1-based cell number, row-major.
// Returns the cropped tag as a data URL plus its share of the sheet.
function cropCellImage(dataUrl, cols, rows, cell) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const c = Math.max(1, cols | 0), r = Math.max(1, rows | 0), n = Math.min(c * r, Math.max(1, cell | 0)) - 1;
      const cw = img.width / c, ch = img.height / r;
      const cv = document.createElement("canvas"); cv.width = Math.round(cw); cv.height = Math.round(ch);
      cv.getContext("2d").drawImage(img, (n % c) * cw, Math.floor(n / c) * ch, cw, ch, 0, 0, cv.width, cv.height);
      res({ dataUrl: cv.toDataURL("image/png"), fracW: 1 / c, fracH: 1 / r });
    };
    img.onerror = () => rej(new Error("Couldn't read the artwork to crop it."));
    img.src = dataUrl;
  });
}`, "crop helper"],
  [`  const [tplBusy, setTplBusy] = useState(false);
  const [tryReq, setTryReq] = useState({ price: "", multi: "", was: "" });   // "try a price" over the sample`,
   `  const [tplBusy, setTplBusy] = useState(false);
  const [tryReq, setTryReq] = useState({ price: "", multi: "", was: "" });   // "try a price" over the sample
  const [crop, setCrop] = useState({ open: false, cols: 3, rows: 6, cell: 1 });   // artwork is a whole sheet: cut one tag out
  const sheetRef = useRef(null);                                              // the uploaded sheet, kept so a re-crop starts from the original`, "crop state"],
  [`      const r = await fileToTemplateImage(f);
      setTplData(r.dataUrl);`,
   `      const r = await fileToTemplateImage(f);
      setTplData(r.dataUrl);
      sheetRef.current = { dataUrl: r.dataUrl, inW: r.inW, inH: r.inH };`, "remember sheet"],
  [`  async function save() {
    setBusy(true); setErr("");
    const x = await jpost(ui, "/api/styles", {`,
   `  async function cropSheet() {
    let src = sheetRef.current && sheetRef.current.dataUrl;
    if (!src && s.templateKey) {
      // artwork already on file: pull it back as a data URL so the crop starts from the original
      try { const blob = await fetch("/api/assets/ttpl/" + encodeURIComponent(s.templateKey)).then((r) => r.blob()); src = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result)); rd.readAsDataURL(blob); }); sheetRef.current = { dataUrl: src, inW: parseFloat(s.templateW) || null, inH: parseFloat(s.templateH) || null }; } catch (e) { setErr("Couldn't load the artwork on file."); return; }
    }
    if (!src) { setErr("Upload the sheet first."); return; }
    setTplBusy(true); setErr("");
    try {
      const out = await cropCellImage(src, crop.cols, crop.rows, crop.cell);
      setTplData(out.dataUrl);
      const sh = sheetRef.current;
      if (sh && sh.inW && sh.inH) setS((v) => Object.assign({}, v, { templateW: Math.round(sh.inW * out.fracW * 1000) / 1000, templateH: Math.round(sh.inH * out.fracH * 1000) / 1000 }));
    } catch (ex) { setErr(String(ex && ex.message || ex)); }
    setTplBusy(false);
  }
  async function save() {
    setBusy(true); setErr("");
    const x = await jpost(ui, "/api/styles", {`, "crop action"],
  [`            <Field ui={ui} label="Artwork" hint="PNG, JPG or a one-page PDF of the chain's tag or sign. Fields go on top of it.">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" accept="image/*,application/pdf,.pdf" onChange={onTemplate} style={{ fontSize: 12 }} />
                {tplBusy && <span style={{ fontSize: 12, color: C.sub }}>Reading…</span>}
                {(s.templateKey || tplData) && !tplBusy && <span style={{ fontSize: 12, color: C.win, fontWeight: 700 }}>{tplData ? "New artwork ready" : "Artwork on file"}</span>}
              </div>
            </Field>`,
   `            <Field ui={ui} label="Artwork" hint="PNG, JPG or a one-page PDF of ONE blank tag or sign -- the live price, package and brand logo go on top of it. Got a whole sheet of sample tags instead? Crop one out below.">
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <input type="file" accept="image/*,application/pdf,.pdf" onChange={onTemplate} style={{ fontSize: 12 }} />
                {tplBusy && <span style={{ fontSize: 12, color: C.sub }}>Reading…</span>}
                {(s.templateKey || tplData) && !tplBusy && <span style={{ fontSize: 12, color: C.win, fontWeight: 700 }}>{tplData ? "New artwork ready" : "Artwork on file"}</span>}
              </div>
              {(s.templateKey || tplData) && <div style={{ marginTop: 8 }}>
                <button type="button" onClick={() => setCrop(Object.assign({}, crop, { open: !crop.open }))} style={{ background: "none", border: "none", padding: 0, color: C.navy, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>{crop.open ? "▾" : "▸"} The artwork is a whole sheet of tags — crop one</button>
                {crop.open && <div style={{ marginTop: 6, background: "#fff", border: \`1.5px solid \${C.line}\`, borderRadius: 10, padding: 10 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                    {[["cols", "Columns"], ["rows", "Rows"], ["cell", "Take tag #"]].map(([k, label]) => <label key={k} style={{ fontSize: 11, fontFamily: ui.HEAD, fontWeight: 600, letterSpacing: 0.6, textTransform: "uppercase", color: C.sub }}>{label}<input inputMode="numeric" value={crop[k]} onChange={(e) => setCrop(Object.assign({}, crop, { [k]: e.target.value.replace(/[^0-9]/g, "") }))} style={Object.assign({}, inputStyle(ui), { width: 70, padding: "6px 8px", fontSize: 13, display: "block", marginTop: 3 })} /></label>)}
                    <Btn ui={ui} kind="navy" small disabled={tplBusy} onClick={cropSheet}>Crop</Btn>
                  </div>
                  <div style={{ fontSize: 11.5, color: C.mute, marginTop: 6, lineHeight: 1.5 }}>An equal grid, counted left to right then down. The printed size becomes the sheet's size divided by the grid; adjust it after if the sheet has margins. Sample text printed on the artwork ($4.99, a placeholder logo) stays in the picture — place the live field over it and give the field a <b>Fill</b> so it covers what is underneath.</div>
                </div>}
              </div>}
            </Field>`, "crop ui"],
  [`        {cur.key === "price" && <Prop label="Cents">`,
   `        <Prop label="Fill"><div style={{ display: "flex", gap: 6, alignItems: "center" }}><label style={{ fontSize: 12, color: C.sub, display: "flex", gap: 4, alignItems: "center" }}><input type="checkbox" checked={!!cur.fill} onChange={(e) => upd(sel, { fill: e.target.checked ? "#FFFFFF" : null })} /> box behind</label>{cur.fill && <input type="color" value={cur.fill} onChange={(e) => upd(sel, { fill: e.target.value })} style={{ width: 34, height: 28, border: "none", background: "none", padding: 0 }} />}</div></Prop>
        {cur.key === "price" && <Prop label="Cents">`, "fill prop"],
  [`background: isSel ? "rgba(224,178,60,.12)" : "rgba(255,255,255,.04)", cursor: "move"`,
   `background: f.fill ? f.fill : (isSel ? "rgba(224,178,60,.12)" : "rgba(255,255,255,.04)"), cursor: "move"`, "editor box fill"],
]);

// tests
let t = fs.readFileSync("test/units.test.js", "utf8");
if (t.indexOf("field fill") === -1) {
  const anchor = `/* ---------------- catalog sheet ---------------- */`;
  if (t.split(anchor).length !== 2) { console.error("test anchor"); process.exit(1); }
  t = t.replace(anchor, `t("template field fill: a hex fill is kept, anything else dropped, and the renderer paints it under the field", () => {
  const f = CORE.normalizeFields([{ key: "price", x: 30, y: 60, w: 60, h: 30, fill: "#FFFFFF" }, { key: "size", x: 5, y: 40, w: 50, h: 10, fill: "white" }, { key: "brandLogo", x: 2, y: 2, w: 20, h: 40, fill: "#FF0000" }]);
  eq(f.map((x) => x.fill), ["#FFFFFF", null, "#FF0000"]);
  const style = { id: "s", kind: "template", format: "tag", name: "DK", templateKey: "tt_x", templateW: 3.667, templateH: 1.417, fields: f };
  const html = CORE.renderTag({ contentType: "standard_price", itemName: "Michelob Ultra", packageSize: "4pk 16oz Cans", price: 4.99, brandLogoKey: "bl_1" }, style, { tagW: 3.667, tagH: 1.417 });
  ok(/class="f f-price[^"]*" style="[^"]*background:#FFFFFF/.test(html), "price box painted"); ok(!/f-size[^"]*" style="[^"]*background:/.test(html), "size box not painted"); ok(/fimg" style="[^"]*background:#FF0000/.test(html), "logo box painted");
});

` + anchor);
  fs.writeFileSync("test/units.test.js", t); console.log("test added");
}
console.log("done");

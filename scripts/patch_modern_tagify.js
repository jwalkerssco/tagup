"use strict";
/* Modern layout, matched against Tagify's real output (2026-09-24 sheet):
   no item name when the brand logo already names the product, and the
   package pill is dark grey by default -- a theme colour of its own, not the
   chain accent. Sentinel-guarded per file. */
const fs = require("fs");
function patch(file, sentinel, edits) {
  let s = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  if (s.indexOf(sentinel) !== -1) { console.log(file + ": already applied"); return; }
  for (const [a, b, l] of edits) { if (s.split(a).length !== 2) { console.error("ABORT " + file + " / " + l + " matched " + (s.split(a).length - 1)); process.exit(1); } s = s.replace(a, () => b); }
  fs.writeFileSync(file, s); console.log(file + ": " + edits.length + " edits");
}
patch("lib/tagup-core.js", "pillColor", [
  [`    showBrandLogo: true,                 // the supplier's mark (tagup-brands), when one is approved`,
   `    showBrandLogo: true,                 // the supplier's mark (tagup-brands), when one is approved
    pillColor: "#333333",                // Modern: the package pill (Tagify's is dark grey)
    showItem: true,                      // Modern: the item name line; hidden anyway when the logo already names the product`, "theme defaults"],
  [`    ["bg", "fg", "accent", "accentFg", "priceColor", "dropColor", "promoColor"].forEach(function (k) {`,
   `    ["bg", "fg", "accent", "accentFg", "priceColor", "dropColor", "promoColor", "pillColor"].forEach(function (k) {`, "theme colours"],
  [`      let mmoney;
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
        '<div class="mrow">' + logoBox + '<div class="mcol"><div class="mitem">' + esc(req.itemName) + mtop + "</div>" + mmoney + "</div></div>" +`,
   `      const pill = '<div class="mpill" style="background:' + th.pillColor + '">';
      let mmoney;
      if (hasPrice(ct)) {
        mmoney = '<div class="mprice" style="color:' + priceColor + '">' +
          (parts ? '<span class="cur">$</span><span class="whole">' + esc(parts.whole) + '</span><span class="cents">' + esc(parts.cents) + "</span>" : '<span class="multi">' + esc(pl) + "</span>") + "</div>" +
          (th.showSize && req.packageSize ? pill + esc(req.packageSize) + "</div>" : "") +
          (wasLine || req.note ? '<div class="msub">' + (wasLine ? '<span class="was">' + esc(wasLine) + "</span> " : "") + esc(req.note || "") + "</div>" : "");
      } else {
        mmoney = '<div class="mprice op" style="color:' + accent + '">' + esc(req.note || "") + "</div>" + (th.showSize && req.packageSize ? pill + esc(req.packageSize) + "</div>" : "");
      }
      // Tagify prints no item line: the logo is the product. Same here when
      // the logo's own brand name IS the item name; the line stays for a
      // variant ("Bud Light Chelada Fuego" under a plain Bud Light logo) and
      // for any tag with no logo at all.
      const sameAsBrand = !!(brandSrc && req.brandLabel && String(req.brandLabel).trim().toLowerCase() === String(req.itemName || "").trim().toLowerCase());
      const showItem = th.showItem !== false && !sameAsBrand;
      const mtop = (tagline ? '<span class="mtag" style="color:' + accent + '">' + esc(tagline) + "</span>" : "");
      const mitem = showItem || mtop ? '<div class="mitem">' + (showItem ? esc(req.itemName) : "") + mtop + "</div>" : "";
      return '<div class="tag modern" style="--u:' + u.toFixed(3) + ";width:" + W + "in;height:" + H + "in;background:" + bg + ";color:" + fg + ";font-family:" + font.css + ";--head:" + font.head.replace(/"/g, "'") + '">' +
        '<div class="mrow">' + logoBox + '<div class="mcol">' + mitem + mmoney + "</div></div>" +`, "modern markup"],
  [`.tag.modern .mpill{font-family:var(--head);font-weight:700;font-size:calc(.11in*var(--u));`, `.tag.modern .mpill{color:#fff;font-family:var(--head);font-weight:700;font-size:calc(.11in*var(--u));`, "pill text"],
]);
patch("src/tagup-ui.jsx", 'k="pillColor"', [
  [`              <Color k="dropColor" label="Price-drop accent" />`, `              <Color k="dropColor" label="Price-drop accent" /><Color k="pillColor" label="Package pill (Modern)" />`, "pill colour"],
  [`<Toggle k="showLogo" label="Show logo" />`, `<Toggle k="showLogo" label="Show logo" /><Toggle k="showItem" label="Item name (Modern)" />`, "item toggle"],
]);
// test: item hidden when it equals the brand label; pill dark by default
let t = fs.readFileSync("test/units.test.js", "utf8");
if (t.indexOf("sameAsBrand") === -1) {
  t = t.replace(`  ok(CORE.LAYOUTS.some((l) => l.id === "modern"));`, `  const same = CORE.renderTag({ contentType: "standard_price", itemName: "Bud Light", price: 4.99, brandLogoKey: "bl_1", brandLabel: "Bud Light", packageSize: "6pk" }, st, { tagW: 3.667, tagH: 1.417 });
  ok(!/class="mitem"/.test(same), "sameAsBrand: no item line when the logo names the product"); ok(/mpill" style="background:#333333"/.test(same), "pill is dark grey by default, not the accent");
  const variant = CORE.renderTag({ contentType: "standard_price", itemName: "Bud Light Chelada Fuego", price: 4.99, brandLogoKey: "bl_1", brandLabel: "Bud Light", packageSize: "6pk" }, st, { tagW: 3.667, tagH: 1.417 });
  ok(/class="mitem">Bud Light Chelada Fuego/.test(variant), "a variant keeps its item line");
  ok(CORE.LAYOUTS.some((l) => l.id === "modern"));`);
  fs.writeFileSync("test/units.test.js", t); console.log("test extended");
}
console.log("done");

/* tagup-core.js -- TagUp (044_tagup): the PURE half.
   ============================================================================
   Everything here runs identically in Node (tagup.js renders the print sheet
   from it) and in the browser (public/tagup-ui.jsx bundles it for the rep's
   preview and Ann-Michelle's style editor). No requires, no pool, no DOM.
   That is what makes "the preview matches the print" a fact rather than a
   hope: one renderer, two callers -- the pricing-core.js pattern.

   THREE INDEPENDENT AXES (the handoff's core principle), combined only here
   at render time:
     style     -- the chain's look. TWO KINDS: `composed` (built from a
                  layout + colors + font + logo) and `template` (the chain's
                  OWN artwork, uploaded, with the live fields placed on it --
                  owner requirement 2026-09-19: "some chains have specific
                  tags and some have specific case card signs; we must follow
                  their template")
     material  -- the sheet the printer has loaded (tag size, grid)
     content   -- what kind of tag: standard_price | promo | price_drop | operational
   plus a FORMAT on the request -- shelf `tag` or `case_card` sign -- because
   one chain hands down both, and they are different artwork.

   Nothing in this file may couple them. A style knows nothing about sheets,
   a material knows nothing about chains, and a request is one content type
   in one format rendered in one style onto one material.                  */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TagUpCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------------- content types ---------------- */
  // price_drop is a top-level type rather than a sub_type on promo (the
  // handoff left it open): the rep picks it as its own big button, the queue
  // filters on it, and a style treats it differently -- three reasons for it
  // to be first-class. It shares promo's field shape (was + now).
  const CONTENT_TYPES = [
    { id: "standard_price", label: "Standard Price", short: "Price", sub: "Item, package, shelf price", fields: ["item", "size", "price", "multi"] },
    { id: "promo", label: "Promo", short: "Promo", sub: "Was / now price, sale treatment", fields: ["item", "size", "was_price", "price", "multi"] },
    { id: "price_drop", label: "Price Drop", short: "Drop", sub: "New everyday low -- was / now", fields: ["item", "size", "was_price", "price", "multi"] },
    // Reserved and BUILT: the schema needs it so it never costs a migration,
    // and it is cheap enough to ship (item + a message, no price).
    { id: "operational", label: "Operational", short: "Note", sub: "Discontinued, Driver Pick Up, Do Not Stock", fields: ["item", "size", "note"] },
  ];
  const CONTENT_IDS = CONTENT_TYPES.map(function (c) { return c.id; });
  function contentType(id) { return CONTENT_TYPES.find(function (c) { return c.id === id; }) || null; }
  function hasPrice(id) { return id !== "operational"; }
  function hasWas(id) { return id === "promo" || id === "price_drop"; }

  /* ---------------- formats ---------------- */
  // A shelf tag and a case card sign are different artwork for the same
  // chain, so a style is keyed on (chain, format). Reps pick the format.
  const FORMATS = [
    { id: "tag", label: "Shelf tag", short: "Tag", sub: "Shelf edge, talker, small sign" },
    { id: "case_card", label: "Case card sign", short: "Case card", sub: "Full-page sign on the case stack" },
  ];
  const FORMAT_IDS = FORMATS.map(function (f) { return f.id; });
  function formatOf(id) { return FORMATS.find(function (f) { return f.id === id; }) || FORMATS[0]; }

  /* ---------------- request lifecycle ---------------- */
  // pending -> reviewed (batched) -> printed, with rejected off the side (the
  // photo-approval shape). cancelled is the rep withdrawing their own pending
  // request -- the handoff's enum did not have it, and a row that vanishes
  // leaves the rep asking "did it go through?", which is the question this
  // module exists to answer. Nothing leaves printed or rejected.
  const STATUSES = ["pending", "reviewed", "printed", "rejected", "cancelled"];
  const TRANSITIONS = {
    pending: ["reviewed", "rejected", "cancelled"],
    reviewed: ["printed", "rejected", "pending"],   // pending = pulled back out of a batch
    printed: [], rejected: [], cancelled: [],
  };
  function canTransition(from, to) { return !!TRANSITIONS[from] && TRANSITIONS[from].indexOf(to) !== -1; }
  function isOpen(status) { return status === "pending" || status === "reviewed"; }

  /* ---------------- money ---------------- */
  function toPrice(v) {
    if (v == null || v === "") return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.]/g, ""));
    if (!isFinite(n) || n < 0) return null;
    return Math.round(n * 100) / 100;
  }
  function fmtPrice(n) {
    const p = toPrice(n);
    if (p == null) return "";
    return "$" + p.toFixed(2);
  }
  // "2/$5.99" for a multi-buy, else the plain price. The multi-buy quantity
  // is a count of units bought together; a qty of 1 or null is not a multi.
  function priceLine(price, multiQty) {
    const p = fmtPrice(price);
    if (!p) return "";
    const q = parseInt(multiQty, 10);
    return q > 1 ? q + "/" + p : p;
  }
  // Dollars and cents apart, for the big-dollars-small-cents treatment.
  function priceParts(price) {
    const p = toPrice(price);
    if (p == null) return null;
    const whole = Math.floor(p), cents = Math.round((p - whole) * 100);
    return { whole: String(whole), cents: (cents < 10 ? "0" : "") + cents };
  }

  /* ---------------- validation ---------------- */
  const ITEM_MAX = 80, SIZE_MAX = 40, NOTE_MAX = 60;
  function clip(v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); }
  // Normalizes a request body into the stored shape, or returns {error}.
  // Shared by the rep's submit and Ann-Michelle's inline edit, so the queue
  // cannot save a row the submit form would have refused.
  function normalizeRequest(body) {
    const b = body || {};
    const ct = String(b.contentType || b.content_type || "standard_price");
    if (CONTENT_IDS.indexOf(ct) === -1) return { error: "unknown content type: " + ct };
    const fmt = String(b.format || "tag");
    if (FORMAT_IDS.indexOf(fmt) === -1) return { error: "unknown format: " + fmt };
    const itemName = clip(b.itemName != null ? b.itemName : b.item_name, ITEM_MAX);
    if (!itemName) return { error: "item name is required" };
    const packageSize = clip(b.packageSize != null ? b.packageSize : b.package_size, SIZE_MAX);
    const note = clip(b.note, NOTE_MAX);
    let price = null, wasPrice = null, multi = null;
    if (hasPrice(ct)) {
      price = toPrice(b.price);
      if (price == null) return { error: "price is required" };
      if (price === 0) return { error: "price must be more than $0" };
      const q = parseInt(b.multiBuyQty != null ? b.multiBuyQty : b.multi_buy_qty, 10);
      multi = q > 1 ? Math.min(q, 24) : null;
      if (hasWas(ct)) {
        wasPrice = toPrice(b.wasPrice != null ? b.wasPrice : b.was_price);
        if (wasPrice == null) return { error: "was-price is required for a " + contentType(ct).label.toLowerCase() };
        if (wasPrice <= price) return { error: "was-price must be higher than the new price" };
      }
    } else if (!note) {
      return { error: "an operational tag needs its message (e.g. Discontinued)" };
    }
    let copies = parseInt(b.copies, 10);
    if (!(copies >= 1)) copies = 1;
    if (copies > 50) copies = 50;
    return {
      ok: true,
      contentType: ct, format: fmt, itemName: itemName, packageSize: packageSize,
      price: price, wasPrice: wasPrice, multiBuyQty: multi, note: note, copies: copies,
      itemNo: clip(b.itemNo != null ? b.itemNo : b.item_no, 20) || null,
      itemFreeText: !!(b.itemFreeText != null ? b.itemFreeText : b.item_free_text),
    };
  }

  /* ---------------- composed styles ---------------- */
  // A theme is a small, closed set of knobs -- not free-form CSS. Ann-Michelle
  // edits colors, a font, and a layout; the renderer below owns everything
  // else, which is what keeps every tag printable on every material.
  const FONTS = {
    oswald: { label: "Oswald (condensed)", css: "'Oswald', 'Arial Narrow', sans-serif", head: "'Anton', 'Oswald', Impact, sans-serif" },
    inter: { label: "Inter (clean)", css: "'Inter', system-ui, Arial, sans-serif", head: "'Inter', system-ui, Arial, sans-serif" },
    arial: { label: "Arial (safe)", css: "Arial, Helvetica, sans-serif", head: "'Arial Black', Arial, sans-serif" },
    georgia: { label: "Georgia (serif)", css: "Georgia, 'Times New Roman', serif", head: "Georgia, 'Times New Roman', serif" },
    // The tagup brand sheet's on-tag typeface: large x-height, tabular lining
    // figures, no slashed zero, a condensed cut for narrow boxes.
    archivo: { label: "Archivo (tagup)", css: "'Archivo', 'Archivo Narrow', Arial, sans-serif", head: "'Archivo Black', 'Archivo', 'Arial Black', sans-serif" },
  };
  const LAYOUTS = [
    { id: "classic", label: "Classic", sub: "Logo band on top, item, big price" },
    { id: "bold", label: "Bold", sub: "Full-color background, price fills the tag" },
    { id: "minimal", label: "Minimal", sub: "White tag, thin rule, small logo" },
  ];
  const DEFAULT_THEME = {
    layout: "classic",
    font: "oswald",
    bg: "#FFFFFF", fg: "#111111",        // tag background / text
    accent: "#102A4C",                   // band and rules
    accentFg: "#FFFFFF",                 // text on the band
    priceColor: "#111111",
    dropColor: "#C4212E",                // the price_drop treatment
    promoColor: "#2F8F4E",               // the promo treatment
    showLogo: true, showSize: true, showItemNo: false, showWas: true,
    showBrandLogo: true,                 // the supplier's mark (tagup-brands), when one is approved
    caption: "",                         // a standing line, e.g. "EVERYDAY LOW PRICE"
  };
  const HEX = /^#[0-9a-fA-F]{6}$/;
  function themeMerge(t) {
    const out = Object.assign({}, DEFAULT_THEME, t || {});
    if (!FONTS[out.font]) out.font = DEFAULT_THEME.font;
    if (!LAYOUTS.some(function (l) { return l.id === out.layout; })) out.layout = DEFAULT_THEME.layout;
    ["bg", "fg", "accent", "accentFg", "priceColor", "dropColor", "promoColor"].forEach(function (k) {
      if (!HEX.test(String(out[k] || ""))) out[k] = DEFAULT_THEME[k];
    });
    out.caption = clip(out.caption, 40);
    return out;
  }

  /* ---------------- rules ---------------- */
  // Conditional formatting on a style -- the gap against Tagify's chain
  // styles (GPM: a 2/for price tier picks the background colour AND writes
  // "Single retail at $x"; BreakTime: every promo carries "Reg." + the was
  // price). A rule is {when, set}: `when` tests ONE request field against a
  // value, `set` overrides theme knobs and/or the request's alt text. Rules
  // run in order and later ones win, so a style author reads them top to
  // bottom the way the chain's own sheet is written. Pure and deterministic:
  // the preview, the editor's sample and the print sheet all evaluate the
  // same list the same way.
  const RULE_FIELDS = ["price", "wasPrice", "multiBuyQty", "contentType", "format", "itemName", "packageSize"];
  const RULE_OPS = ["eq", "neq", "gte", "lte", "between", "in", "contains", "exists"];
  const RULE_SETS = ["bg", "fg", "accent", "accentFg", "priceColor", "caption", "note", "notePrefix", "hideWas"];
  function normalizeRule(r) {
    const b = r || {};
    const w = b.when || {};
    if (RULE_FIELDS.indexOf(w.field) === -1 || RULE_OPS.indexOf(w.op) === -1) return null;
    const set = {};
    Object.keys(b.set || {}).forEach(function (k) {
      if (RULE_SETS.indexOf(k) === -1) return;
      const v = b.set[k];
      if (/^(bg|fg|accent|accentFg|priceColor)$/.test(k)) { if (HEX.test(String(v || ""))) set[k] = v; }
      else if (k === "hideWas") set[k] = !!v;
      else set[k] = clip(v, 60);
    });
    if (!Object.keys(set).length) return null;
    const when = { field: w.field, op: w.op };
    if (w.op === "between") { when.lo = toPrice(w.lo); when.hi = toPrice(w.hi); if (when.lo == null || when.hi == null) return null; }
    else if (w.op === "in") { when.values = Array.isArray(w.values) ? w.values.map(function (x) { return String(x); }).slice(0, 40) : String(w.values || "").split(",").map(function (s) { return s.trim(); }).filter(Boolean); if (!when.values.length) return null; }
    else if (w.op !== "exists") { when.value = w.value; }
    return { when: when, set: set, label: clip(b.label, 60) };
  }
  function normalizeRules(list) { return (Array.isArray(list) ? list : []).map(normalizeRule).filter(Boolean).slice(0, 20); }
  function ruleMatches(rule, req) {
    const w = rule.when;
    const raw = req[w.field];
    const isNum = /^(price|wasPrice|multiBuyQty)$/.test(w.field);
    if (w.op === "exists") return raw != null && raw !== "" && raw !== 0;
    if (raw == null) return false;
    if (isNum) {
      const n = Number(raw);
      if (!isFinite(n)) return false;
      if (w.op === "eq") return Math.abs(n - Number(w.value)) < 0.005;
      if (w.op === "neq") return Math.abs(n - Number(w.value)) >= 0.005;
      if (w.op === "gte") return n >= Number(w.value) - 0.005;
      if (w.op === "lte") return n <= Number(w.value) + 0.005;
      if (w.op === "between") return n >= w.lo - 0.005 && n <= w.hi + 0.005;
      if (w.op === "in") return w.values.some(function (v) { return Math.abs(n - Number(v)) < 0.005; });
      return false;
    }
    const s = String(raw).toLowerCase();
    if (w.op === "eq") return s === String(w.value).toLowerCase();
    if (w.op === "neq") return s !== String(w.value).toLowerCase();
    if (w.op === "in") return w.values.some(function (v) { return String(v).toLowerCase() === s; });
    if (w.op === "contains") return s.indexOf(String(w.value).toLowerCase()) !== -1;
    return false;
  }
  // {price} {was} {each} {qty} in a rule's note resolve against the request,
  // so "Reg. {was}" reads "Reg. $24.99" and "Single retail at {each}" divides
  // a 2-for price by two. An unresolvable token is dropped, never printed raw.
  function ruleText(s, req) {
    const qty = req.multiBuyQty > 1 ? req.multiBuyQty : 1;
    const price = toPrice(req.price), was = toPrice(req.wasPrice);
    return String(s || "").replace(/\{(price|was|each|qty)\}/g, function (_, k) {
      if (k === "price") return price != null ? fmtPrice(price) : "";
      if (k === "was") return was != null ? fmtPrice(was) : "";
      if (k === "each") return price != null ? fmtPrice(Math.ceil(price / qty * 100) / 100) : "";
      return String(qty);
    }).replace(/\s{2,}/g, " ").trim();
  }
  // Returns { theme, req } with every matching rule applied, originals untouched.
  function applyRules(rules, theme, req) {
    const list = normalizeRules(rules);
    let th = theme, rq = req, hit = [];
    list.forEach(function (rule) {
      if (!ruleMatches(rule, rq)) return;
      hit.push(rule);
      th = Object.assign({}, th); rq = Object.assign({}, rq);
      Object.keys(rule.set).forEach(function (k) {
        const v = rule.set[k];
        if (k === "note") rq.note = ruleText(v, rq);
        else if (k === "notePrefix") rq.note = (ruleText(v, rq) + " " + (rq.note || "")).trim();
        else if (k === "caption") th.caption = ruleText(v, rq);
        else if (k === "hideWas") th.showWas = !v;
        else th[k] = v;
      });
    });
    return { theme: th, req: rq, hit: hit };
  }
  // Tagify-shaped presets a style author can start from.
  const RULE_PRESETS = [
    { id: "reg_price", label: "Promo shows \"Reg. $x\" under the price", rules: [{ label: "Reg. line", when: { field: "wasPrice", op: "exists" }, set: { note: "Reg. {was}" } }] },
    { id: "single_retail", label: "2-for price adds \"Single retail at\"", rules: [{ label: "Single retail", when: { field: "multiBuyQty", op: "gte", value: 2 }, set: { note: "Single retail at {each}" } }] },
    { id: "tier_colors", label: "Colour by 2-for price tier (GPM style)", rules: [
      { label: "2/$2.50", when: { field: "price", op: "between", lo: 2.4, hi: 2.6 }, set: { accent: "#7AC943", bg: "#7AC943", fg: "#111111" } },
      { label: "2/$3.50", when: { field: "price", op: "between", lo: 3.4, hi: 3.6 }, set: { accent: "#FFC20E", bg: "#FFC20E", fg: "#111111" } },
      { label: "2/$5.00", when: { field: "price", op: "between", lo: 4.9, hi: 5.1 }, set: { accent: "#F7941D", bg: "#F7941D", fg: "#111111" } },
      { label: "2/$6.50", when: { field: "price", op: "between", lo: 6.4, hi: 6.6 }, set: { accent: "#ED1C24", bg: "#ED1C24", fg: "#FFFFFF", priceColor: "#FFFFFF" } },
      { label: "2/$8.50", when: { field: "price", op: "between", lo: 8.4, hi: 8.6 }, set: { accent: "#6B7A2A", bg: "#6B7A2A", fg: "#FFFFFF", priceColor: "#FFFFFF" } },
    ] },
  ];

  /* ---------------- template styles ---------------- */
  // The chain's own artwork with the live fields placed on it. Every box is
  // a PERCENTAGE of the artwork (x, y, w, h) and every font size a percentage
  // of the artwork's HEIGHT, so one placement survives every material the
  // artwork is printed on. The artwork keeps its own shape: it is scaled to
  // FIT the material's cell and centred, never stretched (a 2x1 design on a
  // 4x3 cell letterboxes; the sign shop picks a matching material).
  const TEMPLATE_FIELDS = [
    { key: "item", label: "Item name", wrap: true },
    { key: "size", label: "Package / size" },
    { key: "price", label: "Price" },
    { key: "was", label: "Was-price (promo / drop only)" },
    { key: "note", label: "Alt text / message", wrap: true },
    { key: "itemNo", label: "Item #" },
    { key: "account", label: "Store name" },
    { key: "chain", label: "Chain name" },
    { key: "brandLogo", label: "Brand logo", image: true },
    { key: "text", label: "Fixed text", repeatable: true },
  ];
  const FIELD_KEYS = TEMPLATE_FIELDS.map(function (f) { return f.key; });
  const ALIGNS = ["left", "center", "right"], VALIGNS = ["top", "middle", "bottom"];
  function normalizeField(f) {
    const b = f || {};
    if (FIELD_KEYS.indexOf(b.key) === -1) return null;
    const pct = function (v, d, lo, hi) { const n = parseFloat(v); return isFinite(n) ? Math.min(hi == null ? 100 : hi, Math.max(lo == null ? 0 : lo, Math.round(n * 100) / 100)) : d; };
    const out = {
      key: b.key,
      x: pct(b.x, 5), y: pct(b.y, 5), w: pct(b.w, 40, 2), h: pct(b.h, 10, 2),
      size: pct(b.size, 8, 1, 100),
      align: ALIGNS.indexOf(b.align) !== -1 ? b.align : "left",
      valign: VALIGNS.indexOf(b.valign) !== -1 ? b.valign : "middle",
      color: HEX.test(String(b.color || "")) ? b.color : "#111111",
      font: FONTS[b.font] ? b.font : "oswald",
      weight: b.weight === "normal" ? "normal" : "bold",
      upper: b.upper !== false,
      on: b.on !== false,
    };
    if (out.x + out.w > 100) out.w = Math.max(2, 100 - out.x);
    if (out.y + out.h > 100) out.h = Math.max(2, 100 - out.y);
    if (b.key === "text") out.text = clip(b.text, 60);
    if (b.key === "price") out.cents = b.cents === "plain" ? "plain" : "super";
    return out;
  }
  // Dedupes every key but `text`, so a template cannot carry two price boxes.
  function normalizeFields(list) {
    const seen = {}, out = [];
    (Array.isArray(list) ? list : []).forEach(function (f) {
      const n = normalizeField(f);
      if (!n) return;
      if (n.key !== "text") { if (seen[n.key]) return; seen[n.key] = 1; }
      out.push(n);
    });
    return out.slice(0, 24);
  }
  // A starting placement for a fresh template: the sign shop drags from here.
  function defaultTemplateFields(format) {
    if (format === "case_card") return normalizeFields([
      { key: "item", x: 6, y: 30, w: 88, h: 14, size: 7, align: "center", color: "#111111" },
      { key: "size", x: 6, y: 45, w: 88, h: 5, size: 3, align: "center", weight: "normal", color: "#333333" },
      { key: "was", x: 6, y: 56, w: 88, h: 4, size: 2.6, align: "center", color: "#666666" },
      { key: "price", x: 6, y: 60, w: 88, h: 20, size: 15, align: "center", color: "#111111" },
    ]);
    return normalizeFields([
      { key: "item", x: 5, y: 25, w: 90, h: 22, size: 15, align: "left", color: "#111111" },
      { key: "size", x: 5, y: 48, w: 90, h: 10, size: 8, align: "left", weight: "normal", color: "#333333" },
      { key: "was", x: 45, y: 58, w: 50, h: 9, size: 7, align: "right", color: "#666666" },
      { key: "price", x: 35, y: 66, w: 60, h: 30, size: 26, align: "right", color: "#111111" },
    ]);
  }
  // Natural size of a fresh template by format, inches.
  function defaultTemplateSize(format) { return format === "case_card" ? { w: 8.5, h: 11 } : { w: 3, h: 2 }; }

  // What each placed field prints for THIS request, or "" to leave it off.
  function fieldValue(f, req, style) {
    const ct = req.contentType || "standard_price";
    switch (f.key) {
      case "item": return req.itemName || "";
      case "size": return req.packageSize || "";
      case "price": return hasPrice(ct) ? priceLine(req.price, req.multiBuyQty) : "";
      case "was": return hasPrice(ct) && hasWas(ct) && req.wasPrice != null ? "WAS " + fmtPrice(req.wasPrice) : "";
      case "note": return req.note || "";
      case "itemNo": return req.itemNo ? "#" + req.itemNo : "";
      case "account": return req.accountName || req.storeName || "";
      case "chain": return req.chainLabel || (style && style.name) || "";
      case "text": return f.text || "";
      case "brandLogo": return req.brandLogoKey || "";
      default: return "";
    }
  }
  // Where the artwork sits inside a material cell: scaled to fit, centred.
  function templateFit(style, material) {
    const W = material.tagW, H = material.tagH;
    const tw = style.templateW > 0 ? style.templateW : W, th = style.templateH > 0 ? style.templateH : H;
    const s = Math.min(W / tw, H / th);
    const w = tw * s, h = th * s;
    return { left: (W - w) / 2, top: (H - h) / 2, width: w, height: h, scale: s, natural: { w: tw, h: th }, letterboxed: Math.abs(w - W) > 0.01 || Math.abs(h - H) > 0.01 };
  }
  function isTemplate(style) { return !!style && style.kind === "template"; }

  // The one style every branch gets: chain null = Independent / generic.
  const DEFAULT_STYLES = [
    { id: "style_independent", chainId: null, name: "Independent", format: "tag", theme: {} },
  ];
  // Style resolution, PURE and FORMAT-AWARE: the request's override wins,
  // else the chain's style for this format, else the branch's Independent
  // style for this format, else the chain's / Independent's style of any
  // format (a composed look scales to a case card fine), else a built-in
  // default so a tag ALWAYS renders -- a missing style must never block a
  // print run.
  function resolveStyle(styles, chainId, overrideId, format) {
    const list = (styles || []).filter(function (s) { return s.active !== false; });
    const fmt = format || "tag";
    if (overrideId) { const o = (styles || []).find(function (s) { return s.id === overrideId; }); if (o) return o; }
    const pick = function (pred) { return list.find(pred) || null; };
    return (chainId && pick(function (s) { return s.chainId === chainId && (s.format || "tag") === fmt; }))
      || pick(function (s) { return !s.chainId && (s.format || "tag") === fmt; })
      || (chainId && pick(function (s) { return s.chainId === chainId; }))
      || pick(function (s) { return !s.chainId; })
      || { id: "style_builtin", chainId: null, name: "Default", format: "tag", kind: "composed", theme: themeMerge({}), logoKey: null, builtin: true };
  }

  /* ---------------- materials ---------------- */
  // Tag and sheet dimensions in inches; cols x rows is the grid. Seeds are a
  // starting set for the sign shop to edit -- Ann-Michelle owns these. The
  // two case-card sheets are one sign per page.
  const DEFAULT_MATERIALS = [
    { id: "mat_2x1_40", name: "Small tag 2x1 (40 per sheet)", tagW: 2, tagH: 1, sheetW: 8.5, sheetH: 11, cols: 4, rows: 10, averySku: null },
    { id: "mat_3x2_15", name: "Shelf talker 3x2 (15 per sheet)", tagW: 2.75, tagH: 2, sheetW: 8.5, sheetH: 11, cols: 3, rows: 5, averySku: null },
    { id: "mat_4x3_6", name: "Large tag 4x3 (6 per sheet)", tagW: 4, tagH: 3, sheetW: 8.5, sheetH: 11, cols: 2, rows: 3, averySku: null },
    { id: "mat_letter_1", name: "Case card 8.5x11 (1 per sheet)", tagW: 8.5, tagH: 11, sheetW: 8.5, sheetH: 11, cols: 1, rows: 1, averySku: null },
    { id: "mat_tabloid_1", name: "Case card 11x17 (1 per sheet)", tagW: 11, tagH: 17, sheetW: 11, sheetH: 17, cols: 1, rows: 1, averySku: null },
  ];
  function normalizeMaterial(m) {
    const b = m || {};
    const num = function (v, lo, hi) { const n = parseFloat(v); return isFinite(n) && n >= lo && n <= hi ? Math.round(n * 1000) / 1000 : null; };
    const tagW = num(b.tagW != null ? b.tagW : b.tag_width_in, 0.5, 20), tagH = num(b.tagH != null ? b.tagH : b.tag_height_in, 0.5, 20);
    const sheetW = num(b.sheetW != null ? b.sheetW : b.sheet_width_in, 2, 20) || 8.5, sheetH = num(b.sheetH != null ? b.sheetH : b.sheet_height_in, 2, 20) || 11;
    const cols = parseInt(b.cols, 10), rows = parseInt(b.rows, 10);
    const name = clip(b.name, 60);
    if (!name) return { error: "material needs a name" };
    if (tagW == null || tagH == null) return { error: "tag width and height (inches) are required" };
    if (!(cols >= 1 && cols <= 12) || !(rows >= 1 && rows <= 20)) return { error: "grid must be 1-12 columns by 1-20 rows" };
    if (cols * tagW > sheetW + 0.001 || rows * tagH > sheetH + 0.001) return { error: "the grid does not fit the sheet: " + cols + " x " + tagW + "in wide, " + rows + " x " + tagH + "in tall" };
    return { ok: true, name: name, tagW: tagW, tagH: tagH, sheetW: sheetW, sheetH: sheetH, cols: cols, rows: rows, averySku: clip(b.averySku != null ? b.averySku : b.avery_sku, 20) || null };
  }
  function perSheet(m) { return (m.cols || 1) * (m.rows || 1); }

  /* ---------------- tiling ---------------- */
  // Expands requests by copies and lays them into sheets of cols x rows. Pure
  // and order-preserving: the queue's order is the sheet's order.
  function tile(requests, material) {
    const per = perSheet(material);
    const cells = [];
    (requests || []).forEach(function (r) {
      const n = Math.max(1, parseInt(r.copies, 10) || 1);
      for (let i = 0; i < n; i++) cells.push(r);
    });
    const sheets = [];
    for (let i = 0; i < cells.length; i += per) sheets.push(cells.slice(i, i + per));
    return { sheets: sheets, cells: cells.length, perSheet: per, blanks: sheets.length ? sheets.length * per - cells.length : 0 };
  }

  /* ---------------- rendering ---------------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  // Text fits by SIZE CLASS, not by measuring: the renderer has no DOM on the
  // server. Long item names step down two sizes; beyond that they wrap.
  function fitClass(s, small, tiny) { const n = String(s || "").length; return n > tiny ? "t3" : n > small ? "t2" : "t1"; }

  // A template tag: the artwork as an <img> (backgrounds are dropped by
  // print engines; an image is not) and each placed field as an absolutely
  // positioned box. Font sizes are inches; a value too long for its box
  // shrinks by character count, deterministic on both sides.
  function renderTemplateTag(req, style, material, opts) {
    const o = opts || {};
    const fit = templateFit(style, material);
    // A style may carry its own src (the editor's not-yet-uploaded artwork,
    // or a demo); the server never emits one, so it only ever wins locally.
    const pendingSrc = style.templateSrc || o.templateSrc || null;
    const src = pendingSrc || ((o.templateBase || "/api/assets/ttpl/") + encodeURIComponent(style.templateKey || ""));
    const fields = normalizeFields(style.fields);
    const inner = fields.filter(function (f) { return f.on; }).map(function (f) {
      const val = fieldValue(f, req, style);
      if (!val) return "";
      const spec = TEMPLATE_FIELDS.find(function (t) { return t.key === f.key; }) || {};
      // An image field: the approved brand logo, contained in its box. No
      // approved logo means no box at all -- never a broken image on a tag.
      if (spec.image) {
        const isrc = req.brandLogoSrc || ((o.brandBase || "/api/assets/blogo/") + encodeURIComponent(val));
        const pos = f.align === "center" ? "center" : f.align === "right" ? "right" : "left";
        return '<div class="f fimg" style="left:' + f.x + "%;top:" + f.y + "%;width:" + f.w + "%;height:" + f.h + '%"><img src="' + esc(isrc) + '" alt="" style="object-position:' + pos + " " + (f.valign === "top" ? "top" : f.valign === "bottom" ? "bottom" : "center") + '"></div>';
      }
      let sizeIn = f.size / 100 * fit.height;
      const boxW = f.w / 100 * fit.width;
      // ~0.55em per character for a condensed bold face; wrapped fields get
      // their lines' worth of room before they start shrinking.
      const lines = spec.wrap ? Math.max(1, Math.floor((f.h / 100 * fit.height) / (sizeIn * 1.05))) : 1;
      const cap = Math.max(1, Math.floor(boxW / (sizeIn * 0.55))) * lines;
      const len = String(val).length;
      if (len > cap) sizeIn = sizeIn * Math.max(0.45, cap / len);
      const font = FONTS[f.font] || FONTS.oswald;
      const parts = f.key === "price" && f.cents === "super" && !(req.multiBuyQty > 1) ? priceParts(req.price) : null;
      const content = parts
        ? '<span class="cur">$</span><span class="whole">' + esc(parts.whole) + '</span><span class="cents">' + esc(parts.cents) + "</span>"
        : esc(val);
      const jc = f.align === "center" ? "center" : f.align === "right" ? "flex-end" : "flex-start";
      const ai = f.valign === "top" ? "flex-start" : f.valign === "bottom" ? "flex-end" : "center";
      return '<div class="f f-' + esc(f.key) + (f.key === "was" ? " strike" : "") + (parts ? " parts" : "") + '" style="left:' + f.x + "%;top:" + f.y + "%;width:" + f.w + "%;height:" + f.h + "%;font-size:" + sizeIn.toFixed(4) + "in;color:" + f.color + ";font-family:" + (f.weight === "bold" ? font.head : font.css).replace(/"/g, "'") + ";font-weight:" + (f.weight === "bold" ? 700 : 400) + ";justify-content:" + jc + ";align-items:" + ai + ";text-align:" + f.align + ";text-transform:" + (f.upper ? "uppercase" : "none") + ";white-space:" + (spec.wrap ? "normal" : "nowrap") + '">' + content + "</div>";
    }).join("");
    return '<div class="tag tpl" style="width:' + material.tagW + "in;height:" + material.tagH + 'in">' +
      '<div class="tplbox" style="left:' + fit.left.toFixed(4) + "in;top:" + fit.top.toFixed(4) + "in;width:" + fit.width.toFixed(4) + "in;height:" + fit.height.toFixed(4) + 'in">' +
        (src && (style.templateKey || pendingSrc) ? '<img class="tplimg" src="' + esc(src) + '" alt="">' : "") +
        inner +
      "</div></div>";
  }

  // The tag's inner HTML. `W`/`H` are the tag's inches; every font size is in
  // inches too (via the CSS `in` unit scaled by --u), so a 4x3 and a 2x1 draw
  // the same design at their own scale.
  function renderTag(req0, style, material, opts) {
    const applied = applyRules(style && style.rules, themeMerge(style && style.theme), req0 || {});
    const req = applied.req;
    if (isTemplate(style)) return renderTemplateTag(req, style, material, opts);
    const o = opts || {};
    const th = applied.theme;
    const ct = req.contentType || "standard_price";
    const font = FONTS[th.font] || FONTS.oswald;
    const W = material.tagW, H = material.tagH;
    const u = Math.min(W / 2, H / 1);             // 1.0 at the 2x1 reference tag
    const accent = ct === "price_drop" ? th.dropColor : ct === "promo" ? th.promoColor : th.accent;
    const logoUrl = th.showLogo && style && style.logoKey ? (o.assetBase || "/api/assets/tlogo/") + encodeURIComponent(style.logoKey) : null;
    const chainLabel = req.chainLabel || (style && style.name) || "";
    const pl = priceLine(req.price, req.multiBuyQty);
    const parts = req.multiBuyQty > 1 ? null : priceParts(req.price);
    const tagline = ct === "price_drop" ? "NEW LOW PRICE" : ct === "promo" ? "SALE" : th.caption;
    const wasLine = hasWas(ct) && th.showWas && req.wasPrice != null ? "WAS " + fmtPrice(req.wasPrice) : "";
    const bold = th.layout === "bold", minimal = th.layout === "minimal";
    // A rule that set bg/fg wins over the layout's own choice (a tier colour
    // must show on a bold layout too); otherwise the layout decides.
    const ruleBg = applied.hit.some(function (r) { return r.set.bg; }), ruleFg = applied.hit.some(function (r) { return r.set.fg; });
    const bg = ruleBg ? th.bg : (bold ? accent : th.bg), fg = ruleFg ? th.fg : (bold ? th.accentFg : th.fg), priceColor = applied.hit.some(function (r) { return r.set.priceColor; }) ? th.priceColor : (bold ? th.accentFg : (ct === "standard_price" ? th.priceColor : accent));

    const band = th.layout === "classic" || bold
      ? '<div class="band" style="background:' + (bold ? "rgba(0,0,0,.18)" : accent) + ";color:" + (bold ? th.accentFg : th.accentFg) + '">' +
          (logoUrl ? '<img class="logo" src="' + esc(logoUrl) + '" alt="">' : '<span class="chain">' + esc(chainLabel) + "</span>") +
          (tagline ? '<span class="tagline">' + esc(tagline) + "</span>" : "") +
        "</div>"
      : '<div class="rule" style="border-color:' + accent + ";color:" + accent + '">' +
          (logoUrl ? '<img class="logo" src="' + esc(logoUrl) + '" alt="">' : '<span class="chain">' + esc(chainLabel) + "</span>") +
          (tagline ? '<span class="tagline">' + esc(tagline) + "</span>" : "") +
        "</div>";

    const item = '<div class="item ' + fitClass(req.itemName, 22, 34) + '">' + esc(req.itemName) + "</div>";
    const size = th.showSize && req.packageSize ? '<div class="size">' + esc(req.packageSize) + (th.showItemNo && req.itemNo ? ' <span class="no">#' + esc(req.itemNo) + "</span>" : "") + "</div>" : "";

    let money = "";
    if (hasPrice(ct)) {
      money = '<div class="money" style="color:' + priceColor + '">' +
        (wasLine ? '<div class="was">' + esc(wasLine) + "</div>" : "") +
        (parts
          ? '<div class="price"><span class="cur">$</span><span class="whole">' + esc(parts.whole) + '</span><span class="cents">' + esc(parts.cents) + "</span></div>"
          : '<div class="price multi">' + esc(pl) + "</div>") +
        (req.note ? '<div class="alt">' + esc(req.note) + "</div>" : "") +
        "</div>";
    } else {
      money = '<div class="money op" style="color:' + accent + '"><div class="opnote">' + esc(req.note || "") + "</div></div>";
    }
    const acctName = req.accountName || req.storeName || ""; const footer = acctName && o.showAccount ? '<div class="acct">' + esc(acctName) + "</div>" : "";
    // The supplier's approved logo rides on the composed layouts too, top
    // right of the body, sized off the tag like everything else.
    const brand = th.showBrandLogo !== false && req.brandLogoKey
      ? '<img class="blogo" src="' + esc(req.brandLogoSrc || ((o.brandBase || "/api/assets/blogo/") + encodeURIComponent(req.brandLogoKey))) + '" alt="">'
      : "";
    return '<div class="tag ' + esc(th.layout) + '" style="--u:' + u.toFixed(3) + ";width:" + W + "in;height:" + H + "in;background:" + bg + ";color:" + fg + ";font-family:" + font.css + ";--head:" + font.head.replace(/"/g, "'") + '">' +
      band + '<div class="body">' + item + size + money + "</div>" + brand + footer + "</div>";
  }

  // Shared CSS for tags (preview and print). All sizes scale off --u.
  const TAG_CSS =
    ".tag{position:relative;overflow:hidden;display:flex;flex-direction:column;box-sizing:border-box;border:1px solid rgba(0,0,0,.12);border-radius:calc(.06in*var(--u));-webkit-print-color-adjust:exact;print-color-adjust:exact}" +
    ".tag .band{display:flex;align-items:center;justify-content:space-between;gap:.04in;padding:calc(.05in*var(--u)) calc(.08in*var(--u));min-height:calc(.24in*var(--u));font-family:var(--head);text-transform:uppercase;letter-spacing:.02em;font-size:calc(.11in*var(--u));line-height:1}" +
    ".tag .rule{display:flex;align-items:center;justify-content:space-between;gap:.04in;margin:calc(.06in*var(--u)) calc(.08in*var(--u)) 0;padding-bottom:calc(.03in*var(--u));border-bottom:calc(.02in*var(--u)) solid;font-family:var(--head);text-transform:uppercase;letter-spacing:.04em;font-size:calc(.09in*var(--u));line-height:1}" +
    ".tag .logo{height:calc(.18in*var(--u));max-width:45%;object-fit:contain;display:block}" +
    ".tag .chain{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".tag .tagline{font-size:calc(.08in*var(--u));opacity:.95;white-space:nowrap;font-weight:700}" +
    ".tag .body{flex:1;display:flex;flex-direction:column;justify-content:space-between;padding:calc(.05in*var(--u)) calc(.08in*var(--u)) calc(.06in*var(--u));min-height:0}" +
    ".tag .item{font-family:var(--head);text-transform:uppercase;line-height:1.02;font-size:calc(.16in*var(--u));font-weight:700;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}" +
    ".tag .item.t2{font-size:calc(.13in*var(--u))}.tag .item.t3{font-size:calc(.105in*var(--u))}" +
    ".tag .size{font-size:calc(.09in*var(--u));opacity:.85;line-height:1.1;margin-top:calc(.02in*var(--u));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".tag .size .no{opacity:.6}" +
    ".tag .money{display:flex;flex-direction:column;align-items:flex-end;justify-content:flex-end;flex:1;min-height:0;line-height:1}" +
    ".tag .was{font-size:calc(.09in*var(--u));text-decoration:line-through;opacity:.75;font-weight:600;margin-bottom:calc(.015in*var(--u))}" +
    ".tag .price{font-family:var(--head);font-weight:700;display:flex;align-items:flex-start;line-height:.9}" +
    ".tag .price .cur{font-size:calc(.16in*var(--u));margin-top:calc(.03in*var(--u))}" +
    ".tag .price .whole{font-size:calc(.36in*var(--u));letter-spacing:-.02em}" +
    ".tag .price .cents{font-size:calc(.15in*var(--u));margin-top:calc(.035in*var(--u));margin-left:calc(.01in*var(--u))}" +
    ".tag .price.multi{font-size:calc(.26in*var(--u));letter-spacing:-.01em}" +
    ".tag .alt{font-size:calc(.075in*var(--u));font-weight:600;opacity:.85;margin-top:calc(.02in*var(--u));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}" +
    ".tag .money.op{align-items:flex-start;justify-content:center}" +
    ".tag .opnote{font-family:var(--head);text-transform:uppercase;font-weight:700;font-size:calc(.2in*var(--u));line-height:1;letter-spacing:.01em}" +
    ".tag.bold .item,.tag.bold .size{text-shadow:0 0 1px rgba(0,0,0,.15)}" +
    // Bottom-left of the body: the price owns the bottom-right and the item
    // name the top, so this is the corner nothing else uses.
    ".tag .blogo{position:absolute;left:calc(.08in*var(--u));bottom:calc(.13in*var(--u));height:calc(.22in*var(--u));max-width:44%;object-fit:contain;object-position:left bottom}" +
    ".tag .fimg img{width:100%;height:100%;object-fit:contain;display:block}" +
    ".tag .acct{position:absolute;left:0;right:0;bottom:0;font-size:calc(.06in*var(--u));opacity:.55;padding:0 calc(.08in*var(--u)) calc(.02in*var(--u));white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    // template tags
    ".tag.tpl{background:#fff;border:none;border-radius:0;display:block}" +
    ".tag .tplbox{position:absolute;overflow:hidden}" +
    ".tag .tplimg{position:absolute;left:0;top:0;width:100%;height:100%;display:block}" +
    ".tag .f{position:absolute;display:flex;line-height:1;overflow:hidden;box-sizing:border-box}" +
    ".tag .f.strike{text-decoration:line-through}" +
    ".tag .f.parts{align-items:flex-start}" +
    ".tag .f .cur{font-size:.45em;margin-top:.08em}.tag .f .whole{letter-spacing:-.02em}.tag .f .cents{font-size:.45em;margin-top:.1em;margin-left:.03em}";

  const FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Oswald:wght@400;500;600;700&family=Inter:wght@400;500;600;700&family=Archivo+Black&family=Archivo:wght@400;600;700&family=Archivo+Narrow:wght@400;700&display=swap">';

  // A whole print run: one page per sheet, the material's grid, page size =
  // the sheet. Every request is rendered in ITS OWN style (a batch can mix
  // chains -- the material is what they share). `stylesById` resolves each.
  function renderSheet(requests, stylesById, material, opts) {
    const o = opts || {};
    const t = tile(requests, material);
    const gapX = Math.max(0, (material.sheetW - material.cols * material.tagW) / (material.cols + 1));
    const gapY = Math.max(0, (material.sheetH - material.rows * material.tagH) / (material.rows + 1));
    const all = Object.keys(stylesById).map(function (k) { return stylesById[k]; });
    const pages = t.sheets.map(function (cells, pi) {
      const inner = cells.map(function (r) {
        const st = r.styleId && stylesById[r.styleId] ? stylesById[r.styleId] : resolveStyle(all, r.chainId, r.styleIdOverride, r.format);
        return '<div class="cell">' + renderTag(r, st, material, { assetBase: o.assetBase, templateBase: o.templateBase, brandBase: o.brandBase, showAccount: o.showAccount !== false }) + "</div>";
      }).join("");
      const blanks = t.perSheet - cells.length;
      let b = "";
      for (let i = 0; i < blanks; i++) b += '<div class="cell blank" style="width:' + material.tagW + "in;height:" + material.tagH + 'in"></div>';
      return '<section class="sheet" data-page="' + (pi + 1) + '">' + inner + b + "</section>";
    }).join("");
    const title = esc(o.title || "TagUp print run");
    const summary = t.cells + " tag" + (t.cells === 1 ? "" : "s") + " on " + t.sheets.length + " sheet" + (t.sheets.length === 1 ? "" : "s") + " -- " + esc(material.name);
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>" + title + "</title>" + FONT_LINK +
      "<style>" +
      "@page{size:" + material.sheetW + "in " + material.sheetH + "in;margin:0}" +
      "html,body{margin:0;padding:0;background:#777}" +
      ".toolbar{font:13px Inter,system-ui,sans-serif;color:#fff;background:#333;padding:8px 12px;display:flex;justify-content:space-between;gap:12px}" +
      ".sheet{position:relative;width:" + material.sheetW + "in;height:" + material.sheetH + "in;background:#fff;margin:12px auto;box-sizing:border-box;display:grid;" +
        "grid-template-columns:repeat(" + material.cols + "," + material.tagW + "in);grid-auto-rows:" + material.tagH + "in;" +
        "column-gap:" + gapX.toFixed(4) + "in;row-gap:" + gapY.toFixed(4) + "in;padding:" + gapY.toFixed(4) + "in " + gapX.toFixed(4) + "in;align-content:start;justify-content:start;page-break-after:always;break-after:page;box-shadow:0 2px 12px rgba(0,0,0,.4)}" +
      ".sheet:last-of-type{page-break-after:auto;break-after:auto}" +
      ".cell{width:" + material.tagW + "in;height:" + material.tagH + "in;overflow:hidden}" +
      ".cell.blank{outline:1px dashed rgba(0,0,0,.08)}" +
      TAG_CSS +
      "@media print{html,body{background:#fff}.toolbar{display:none}.sheet{margin:0;box-shadow:none}.tag{border-color:rgba(0,0,0,.08)}.cell.blank{outline:none}}" +
      "</style></head><body>" +
      '<div class="toolbar"><span>' + title + "</span><span>" + summary + "</span></div>" +
      pages +
      "</body></html>";
  }

  // The little preview the rep sees before submit, and the style editor's
  // sample. Same renderer, one tag, wrapped so the CSS applies.
  function renderPreviewHtml(req, style, material, opts) {
    return "<style>" + TAG_CSS + "</style>" + renderTag(req, style, material, opts);
  }
  const SAMPLE_REQUEST = { contentType: "standard_price", format: "tag", itemName: "Michelob Ultra", packageSize: "12pk 12oz Cans", price: 14.99, wasPrice: null, multiBuyQty: null, note: "", chainLabel: "", accountName: "Stripes #2134", itemNo: "10023" };

  return {
    CONTENT_TYPES: CONTENT_TYPES, CONTENT_IDS: CONTENT_IDS, contentType: contentType, hasPrice: hasPrice, hasWas: hasWas,
    FORMATS: FORMATS, FORMAT_IDS: FORMAT_IDS, formatOf: formatOf,
    STATUSES: STATUSES, TRANSITIONS: TRANSITIONS, canTransition: canTransition, isOpen: isOpen,
    toPrice: toPrice, fmtPrice: fmtPrice, priceLine: priceLine, priceParts: priceParts,
    normalizeRequest: normalizeRequest, ITEM_MAX: ITEM_MAX, NOTE_MAX: NOTE_MAX,
    RULE_FIELDS: RULE_FIELDS, RULE_OPS: RULE_OPS, RULE_SETS: RULE_SETS, RULE_PRESETS: RULE_PRESETS, normalizeRule: normalizeRule, normalizeRules: normalizeRules, ruleMatches: ruleMatches, applyRules: applyRules, ruleText: ruleText,
    FONTS: FONTS, LAYOUTS: LAYOUTS, DEFAULT_THEME: DEFAULT_THEME, themeMerge: themeMerge, DEFAULT_STYLES: DEFAULT_STYLES, resolveStyle: resolveStyle,
    TEMPLATE_FIELDS: TEMPLATE_FIELDS, normalizeField: normalizeField, normalizeFields: normalizeFields, defaultTemplateFields: defaultTemplateFields, defaultTemplateSize: defaultTemplateSize,
    fieldValue: fieldValue, templateFit: templateFit, isTemplate: isTemplate,
    DEFAULT_MATERIALS: DEFAULT_MATERIALS, normalizeMaterial: normalizeMaterial, perSheet: perSheet, tile: tile,
    esc: esc, renderTag: renderTag, renderTemplateTag: renderTemplateTag, renderSheet: renderSheet, renderPreviewHtml: renderPreviewHtml, TAG_CSS: TAG_CSS, SAMPLE_REQUEST: SAMPLE_REQUEST,
  };
});

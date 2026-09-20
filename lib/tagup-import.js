/* tagup-import.js -- TagUp Excel import: the PURE half (044_tagup)
   ============================================================================
   A chain sends a price book -- a spreadsheet of every item and its price for
   their stores -- and the sign shop turns it into a queue of tag requests in
   one upload instead of one at a time. Owner requirement 2026-09-19: "We
   often get a price book from a chain giving us all prices for their stores.
   An excel import is key."

   Modelled on Tagify's import (docs.tagify.com/web/tag-projects/excel):
   find the header row wherever it is, need only Brand / Package / Price,
   read anything else that is there (was-price, store, quantity, alt text,
   item #, UPC, type, format, print yes/no), be AGGRESSIVE about matching
   and HONEST about what was changed -- every row comes back ok / adjusted /
   error with the reasons, and the sign shop sees that before anything is
   written.

   No requires, no DB: everything here is deterministic over a 2-D array of
   cells, so test-tagup-import.js proves it without a workbook. The DB half
   (matching brands and items, resolving stores, writing requests) lives in
   tagup.js importPreview / importApply.                                     */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.TagUpImport = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const norm = function (s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9#]+/g, " ").trim(); };
  const clip = function (v, n) { return String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n); };

  /* ---------------- columns ---------------- */
  // Synonyms per column, most specific first. `item`/`product`/`name` alone
  // are ambiguous between a brand and a description and land on description.
  const COLS = {
    description: ["item description", "description", "desc", "item name", "product description", "product name", "item", "product", "name"],
    brand: ["brand", "brand name", "brand family", "family", "supplier"],
    package: ["package", "pack", "pkg", "package size", "pack size", "size", "container", "packaging"],
    price: ["price", "retail", "sale price", "new price", "tag price", "shelf price", "now", "now price", "price point", "retail price", "sell"],
    was: ["was", "was price", "reg", "reg price", "regular", "regular price", "old price", "before", "everyday", "everyday price", "previous price", "compare at"],
    store: ["store", "store #", "store number", "store no", "account", "account #", "account number", "location", "site", "customer"],
    qty: ["qty", "quantity", "#", "copies", "count", "tags", "number of tags", "print qty"],
    note: ["alt", "alt text", "alt. text", "note", "notes", "message", "comment", "comments"],
    print: ["print", "print?", "include"],
    type: ["type", "tag type", "kind", "promo type"],
    format: ["format", "sign", "sign type", "sign format", "tag size"],
    itemKey: ["item key", "item #", "item no", "item number", "item id", "sku", "vin", "item code"],
    upc: ["upc", "barcode", "bar code", "gtin"],
  };
  const COL_KEYS = Object.keys(COLS);
  const REQUIRED_ANY = ["description", "brand"];   // one of these
  function colOf(header) {
    const h = norm(header);
    if (!h) return null;
    for (const k of COL_KEYS) if (COLS[k].indexOf(h) !== -1) return k;
    // "Retail $" / "Price ($)" / "Store No." -- strip trailing units and punctuation
    const h2 = h.replace(/\s*(\$|usd|\(.*\)|\.)+\s*$/g, "").trim();
    for (const k of COL_KEYS) if (COLS[k].indexOf(h2) !== -1) return k;
    return null;
  }
  // The header row is the first row where at least two cells are known
  // columns and one of them is Brand or Description. Price books carry
  // title blocks above their header, so it is rarely row 1.
  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 40); r++) {
      const cells = rows[r] || [];
      const map = {};
      let hits = 0;
      cells.forEach(function (c, i) { const k = colOf(c); if (k && map[k] == null) { map[k] = i; hits++; } });
      if (hits >= 2 && REQUIRED_ANY.some(function (k) { return map[k] != null; })) return { row: r, map: map };
    }
    return null;
  }

  /* ---------------- prices ---------------- */
  // "$10.99" "10.99" "2/$3" "10 for $10.00" "3 - 3.33" "2/$3 or $1.29 each"
  // "1.99 or single at regular retail". Returns null when nothing prices.
  function parsePrice(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number") return isFinite(v) && v > 0 ? { price: Math.round(v * 100) / 100, multiQty: null, note: "" } : null;
    let s = String(v).trim();
    let note = "";
    const or = s.split(/\s+or\s+/i);
    if (or.length > 1) { s = or[0].trim(); note = or.slice(1).join(" or ").trim(); }
    let m = s.match(/^(\d+)\s*(?:\/|for|@|-|x)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:ea|each)?$/i);
    if (m) { const q = parseInt(m[1], 10), p = parseFloat(m[2]); if (q > 1 && p > 0) return { price: Math.round(p * 100) / 100, multiQty: Math.min(q, 24), note: note }; }
    m = s.match(/\$?\s*(\d+(?:[.,]\d+)?)/);
    if (!m) return null;
    const p = parseFloat(m[1].replace(",", "."));
    if (!(p > 0)) return null;
    return { price: Math.round(p * 100) / 100, multiQty: null, note: note };
  }
  function yesNo(v, dflt) {
    const s = norm(v);
    if (!s) return dflt;
    if (/^(y|yes|true|1|x|print)$/.test(s)) return true;
    if (/^(n|no|false|0|skip)$/.test(s)) return false;
    return dflt;
  }
  function typeOf(v) {
    const s = norm(v);
    if (!s) return null;
    if (/drop|everyday low|new low|edlp/.test(s)) return "price_drop";
    if (/promo|sale|special|tpr|feature|deal/.test(s)) return "promo";
    if (/oper|discontinu|do not|dns|driver|out of stock|note/.test(s)) return "operational";
    if (/standard|regular|reg|price|shelf|everyday/.test(s)) return "standard_price";
    return null;
  }
  function formatOfCell(v) {
    const s = norm(v);
    if (!s) return null;
    if (/case|card|sign|poster|8 ?5|11 ?17|letter|full/.test(s)) return "case_card";
    if (/tag|shelf|talker|small/.test(s)) return "tag";
    return null;
  }

  /* ---------------- packages ---------------- */
  // "12pk Cans" / "12 pk 12oz Can" / "4/6/12NR" / "30-pack" / "1/2 Bbl" ->
  // the parts a catalog item can be matched on.
  function parsePackage(v) {
    const s = String(v == null ? "" : v).toLowerCase();
    const out = { count: null, oz: null, cont: null, raw: clip(v, 40) };
    let m = s.match(/(\d+)\s*(?:pk|pack|ct|count|-pack|\s?pks?)\b/);
    if (m) out.count = parseInt(m[1], 10);
    else { m = s.match(/(?:^|\D)(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)/); if (m) out.count = parseInt(m[2], 10); else { m = s.match(/^(\d+)\s*x\s*(\d+)/); if (m) out.count = parseInt(m[1], 10) === 1 ? parseInt(m[2], 10) : parseInt(m[1], 10); } }
    m = s.match(/(\d+(?:\.\d+)?)\s*(?:oz|ounce|z)\b/);
    if (m) out.oz = parseFloat(m[1]);
    else { m = s.match(/(?:\d+\/\d+\/)(\d+)\s*(nr|ln|lnnr|cn|can|btl)/); if (m) out.oz = parseFloat(m[1]); }
    if (/keg|bbl|barrel/.test(s)) out.cont = "keg";
    else if (/(?:^|[\s\d\/-])(cans?|cn|alu|aluminum)\b/.test(s)) out.cont = "can";
    else if (/(?:^|[\s\d\/-])(btls?|bottles?|nr|lnnr|ln|glass)\b/.test(s)) out.cont = "bottle";
    return out;
  }
  // How well a catalog item's package fits the requested one: 0 = no.
  function packageScore(want, have) {
    if (!want || !have) return 0;
    let s = 1;
    if (want.count != null && have.count != null) { if (want.count !== have.count) return 0; s += 4; }
    if (want.cont && have.cont) { if (want.cont !== have.cont) return 0; s += 2; }
    if (want.oz != null && have.oz != null) { if (Math.abs(want.oz - have.oz) > 0.05) return 0; s += 2; }
    return s;
  }

  /* ---------------- rows ---------------- */
  // Reads the sheet into raw rows: {n, cells: {description, brand, ...}}.
  // Blank rows and rows with neither a brand/description nor a price are
  // dropped silently (subtotals, spacers, notes under the table).
  function readRows(rows, header) {
    const out = [];
    for (let r = header.row + 1; r < rows.length; r++) {
      const cells = rows[r] || [];
      const rec = { n: r + 1, cells: {} };
      Object.keys(header.map).forEach(function (k) { rec.cells[k] = cells[header.map[k]]; });
      const hasName = clip(rec.cells.description, 200) || clip(rec.cells.brand, 200);
      const hasPrice = rec.cells.price != null && String(rec.cells.price).trim() !== "";
      if (!hasName && !hasPrice) continue;
      out.push(rec);
    }
    return out;
  }
  // The whole pure pass: header + rows + per-row interpretation that needs
  // no catalog (price, qty, type, format, print). Brand/item/store matching
  // is the DB half's job and it fills `resolved` on each row afterwards.
  function parseBook(sheets, opts) {
    const o = opts || {};
    const list = Array.isArray(sheets) ? sheets : [];
    // The first tab with a header wins, unless a tab is named.
    let picked = null;
    for (const sh of list) {
      if (o.sheet && sh.name !== o.sheet) continue;
      const h = findHeader(sh.rows || []);
      if (h) { picked = { name: sh.name, rows: sh.rows, header: h }; break; }
    }
    if (!picked) return { error: "no header row found -- the sheet needs a row with at least Brand (or Item Description) and Price", sheets: list.map(function (s) { return s.name; }) };
    const raw = readRows(picked.rows, picked.header);
    const rows = raw.map(function (rec) {
      const c = rec.cells;
      const row = { n: rec.n, status: "ok", notes: [], error: null,
        description: clip(c.description, 80), brand: clip(c.brand, 60), packageText: clip(c.package, 40),
        priceText: c.price == null ? "" : String(c.price).trim(), wasText: c.was == null ? "" : String(c.was).trim(),
        storeText: clip(c.store, 80), itemKey: clip(c.itemKey, 20), upc: clip(c.upc, 20), note: clip(c.note, 60),
        print: yesNo(c.print, true), copies: 1, contentType: null, format: null, price: null, multiQty: null, wasPrice: null };
      const q = parseInt(c.qty, 10);
      if (c.qty != null && String(c.qty).trim() !== "") { if (q >= 1) row.copies = Math.min(q, 50); else row.notes.push("quantity \"" + clip(c.qty, 10) + "\" read as 1"); }
      if (q > 50) row.notes.push("quantity capped at 50");
      row.contentType = typeOf(c.type) || (o.contentType || "standard_price");
      if (c.type != null && String(c.type).trim() && !typeOf(c.type)) row.notes.push("type \"" + clip(c.type, 20) + "\" not recognized -- " + row.contentType);
      row.format = formatOfCell(c.format) || (o.format || "tag");
      const p = parsePrice(c.price);
      if (p) { row.price = p.price; row.multiQty = p.multiQty; if (p.note) { row.note = row.note || p.note; row.notes.push("\"" + p.note + "\" read as the alt text"); } if (p.multiQty) row.notes.push("multi-buy " + p.multiQty + "/" + "$" + p.price.toFixed(2)); }
      const w = parsePrice(c.was);
      if (w) row.wasPrice = w.price;
      if (row.contentType === "operational") {
        if (!row.note) { row.status = "error"; row.error = "an operational tag needs a message in Alt text / Note"; }
      } else if (row.price == null) {
        if (row.priceText) { row.status = "error"; row.error = "price \"" + clip(row.priceText, 20) + "\" not understood"; }
        else { row.status = "error"; row.error = "no price"; }
      } else if (row.wasPrice != null && row.wasPrice <= row.price) {
        row.notes.push("was-price " + row.wasPrice + " is not above " + row.price + " -- dropped"); row.wasPrice = null;
      }
      if (row.wasPrice != null && row.contentType === "standard_price") { row.contentType = "promo"; row.notes.push("has a was-price -- read as a promo"); }
      if ((row.contentType === "promo" || row.contentType === "price_drop") && row.wasPrice == null && row.status !== "error") { row.contentType = "standard_price"; row.notes.push("no was-price -- printed as a standard price"); }
      if (!row.description && !row.brand) { row.status = "error"; row.error = "no brand or item"; }
      if (!row.print) { row.status = "skipped"; row.notes.push("Print = no"); }
      if (row.status === "ok" && row.notes.length) row.status = "adjusted";
      return row;
    });
    return { ok: true, sheet: picked.name, headerRow: picked.header.row + 1, columns: Object.keys(picked.header.map), rows: rows,
             counts: count(rows) };
  }
  function count(rows) {
    const c = { total: rows.length, ok: 0, adjusted: 0, error: 0, skipped: 0 };
    rows.forEach(function (r) { c[r.status] = (c[r.status] || 0) + 1; });
    return c;
  }

  /* ---------------- the template / export shape ---------------- */
  const TEMPLATE_HEADERS = ["Brand", "Package", "Price", "Was", "Type", "Format", "Store", "Quantity", "Alt text", "Item #", "Print"];
  const TEMPLATE_ROWS = [
    ["Bud Light", "12pk 12oz Cans", "$14.99", "", "", "", "", "2", "", "", "Yes"],
    ["Michelob Ultra", "24pk 12oz Cans", "26.99", "29.99", "Promo", "Case card", "", "1", "", "10024", "Yes"],
    ["Busch Light", "24pk 12oz Cans", "2/$11.98 or $5.99 each", "", "", "", "", "1", "", "", "Yes"],
    ["Stella Artois", "12pk 11.2oz Bottles", "15.99", "18.49", "Price drop", "", "", "1", "", "", "Yes"],
  ];
  const EXPORT_HEADERS = ["Brand", "Package", "Price", "Was", "Multi-buy", "Type", "Format", "Store", "Store #", "Chain", "Quantity", "Alt text", "Item #", "Status", "Requested by", "Route", "Requested", "Printed"];
  function exportRow(q) {
    const ct = { standard_price: "Standard", promo: "Promo", price_drop: "Price drop", operational: "Operational" }[q.contentType] || q.contentType;
    return [q.itemName, q.packageSize || "", q.price == null ? "" : q.price, q.wasPrice == null ? "" : q.wasPrice, q.multiBuyQty || "", ct, q.format === "case_card" ? "Case card" : "Tag",
            q.accountName || "", q.accountId || "", q.chainLabel || "", q.copies || 1, q.note || "", q.itemNo || "", q.status, q.repName || q.repId || "", q.route || "",
            q.createdAt ? String(q.createdAt).slice(0, 10) : "", q.printedAt ? String(q.printedAt).slice(0, 10) : ""];
  }

  return { COLS, colOf, findHeader, parsePrice, yesNo, typeOf, formatOfCell, parsePackage, packageScore, readRows, parseBook, count, norm,
           TEMPLATE_HEADERS, TEMPLATE_ROWS, EXPORT_HEADERS, exportRow };
});

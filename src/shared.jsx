/* src/shared.jsx -- the app's vocabulary: palette, fonts, the api client,
   the router, and the `ui` object the ported tagup screens read. */
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
// Named imports only: a namespace import of lucide-react re-exported as an
// object defeats tree-shaking and ships every icon (measured: +900 KB).
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, FileSpreadsheet, Home, Inbox, Layers, LogOut, Mail, MoreHorizontal, Package, Palette, Pencil, PlayCircle, Plus, Printer, Search, Settings, Smartphone, Sparkles, Store, Tag, Trash2, Upload, Users, X, Zap } from "lucide-react";
const L = { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, HelpCircle: CircleHelp, FileSpreadsheet, Home, Inbox, Layers, LogOut, Mail, MoreHorizontal, Package, Palette, Pencil, PlayCircle, Plus, Printer, Search, Settings, Smartphone, Sparkles, Store, Tag, Trash2, Upload, Users, X, Zap };
import { TB, TAGLINE, TagUpMark, Wordmark, Card, Btn, Eyebrow, Chip, Field, inputStyle } from "./tagup-ui";

/* ---------------- brand ---------------- */
// The ported screens speak The Standard's palette names (gold/navy/win);
// here they resolve to the tagup sheet: Signal is the action colour, Ink the
// type, Paper the ground, Posted/Pull the outcomes.
export const C = {
  paper: TB.paper, cream: TB.paper, ink: TB.ink, navy: TB.ink, sub: TB.slate, mute: "#8B93A1",
  line: "#E7E1D6", lineCool: "#E3E6EA",
  gold: TB.signal, goldSoft: TB.signalSoft, goldDeep: "#C24F0A",
  win: TB.posted, winSoft: TB.postedSoft, red: TB.pull, redSoft: TB.pullSoft, redDeep: "#A31D1D",
  kraft: TB.kraft, slate: TB.slate, signal: TB.signal,
};
export const HEAD = "'Archivo', Inter, system-ui, sans-serif";
export const BODY = "Inter, system-ui, -apple-system, sans-serif";
export const DISP = "'Archivo Black', 'Archivo', Inter, sans-serif";
export const lbl = { display: "block", fontFamily: HEAD, fontWeight: 600, fontSize: 11.5, letterSpacing: 0.8, textTransform: "uppercase", color: TB.slate, marginBottom: 5 };

/* ---------------- session ---------------- */
const KEY_TOKEN = "tagup_token", KEY_ORG = "tagup_org";
export const session = {
  get token() { try { return localStorage.getItem(KEY_TOKEN) || ""; } catch (e) { return ""; } },
  set token(v) { try { if (v) localStorage.setItem(KEY_TOKEN, v); else localStorage.removeItem(KEY_TOKEN); } catch (e) {} try { document.cookie = "tagup_auth=" + (v || "") + "; path=/; SameSite=Lax; max-age=" + (v ? 2592000 : 0); } catch (e) {} },
  get org() { try { return localStorage.getItem(KEY_ORG) || ""; } catch (e) { return ""; } },
  set org(v) { try { if (v) localStorage.setItem(KEY_ORG, v); else localStorage.removeItem(KEY_ORG); } catch (e) {} },
};
export function H() {
  const h = { "Content-Type": "application/json" };
  if (session.token) h.Authorization = "Bearer " + session.token;
  if (session.org) h["X-Org-Id"] = session.org;
  return h;
}
const j = (r) => r.json().then((b) => { if (r.status === 402 && b) b.trialEnded = true; return b; });
export const api = {
  get: (url) => fetch(url, { headers: H() }).then(j),
  post: (url, body) => fetch(url, { method: "POST", headers: H(), body: JSON.stringify(body || {}) }).then(j),
  put: (url, body) => fetch(url, { method: "PUT", headers: H(), body: JSON.stringify(body || {}) }).then(j),
  upload: (url, fd) => { const h = H(); delete h["Content-Type"]; return fetch(url, { method: "POST", headers: h, body: fd }).then(j); },
};

/* ---------------- ui object for the ported screens ---------------- */
export const icons = {
  ChevronLeft: L.ChevronLeft, ChevronRight: L.ChevronRight, Search: L.Search, Store: L.Store, Check: L.Check, X: L.X,
};
export const ui = { C, HEAD, BODY, DISP, lbl, H, icons };

/* ---------------- router ---------------- */
export function nav(path) { window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); window.scrollTo(0, 0); }
export function useRoute() {
  const read = () => ({ path: window.location.pathname, query: Object.fromEntries(new URLSearchParams(window.location.search)) });
  const [r, setR] = useState(read);
  useEffect(() => { const f = () => setR(read()); window.addEventListener("popstate", f); return () => window.removeEventListener("popstate", f); }, []);
  return r;
}
export function Link({ to, children, style, onClick }) {
  return <a href={to} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); if (onClick) onClick(); nav(to); }} style={style}>{children}</a>;
}
export function useIsDesktop() {
  const [d, setD] = useState(() => window.innerWidth >= 900);
  useEffect(() => { const f = () => setD(window.innerWidth >= 900); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, []);
  return d;
}

/* ---------------- primitives ---------------- */
export function Primary({ children, onClick, disabled, block, small, style, type }) {
  return <button type={type || "button"} disabled={disabled} onClick={onClick} style={Object.assign({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: small ? "9px 14px" : "13px 20px", borderRadius: 12, border: "none", background: TB.signal, color: TB.ink, fontFamily: HEAD, fontWeight: 700, fontSize: small ? 13 : 15, letterSpacing: 0.3, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, boxShadow: "0 3px 0 #C24F0A", width: block ? "100%" : undefined }, style || {})}>{children}</button>;
}
export function Ghost({ children, onClick, disabled, block, small, style, type }) {
  return <button type={type || "button"} disabled={disabled} onClick={onClick} style={Object.assign({ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: small ? "8px 13px" : "12px 18px", borderRadius: 12, border: `2px solid ${TB.ink}`, background: "transparent", color: TB.ink, fontFamily: HEAD, fontWeight: 700, fontSize: small ? 13 : 15, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, width: block ? "100%" : undefined }, style || {})}>{children}</button>;
}
export function Input(props) {
  const { big, style } = props;
  const rest = Object.assign({}, props); delete rest.big; delete rest.style;
  return <input {...rest} style={Object.assign(inputStyle(ui, big), style || {})} />;
}
export function Notice({ kind, children, style }) {
  const m = { ok: [TB.postedSoft, TB.posted], warn: [TB.signalSoft, "#8A3A08"], bad: [TB.pullSoft, "#A31D1D"], info: [TB.slateSoft, TB.slate] }[kind || "info"];
  return <div style={Object.assign({ background: m[0], color: m[1], borderRadius: 12, padding: "10px 14px", fontSize: 13.5, fontWeight: 600, lineHeight: 1.5 }, style || {})}>{children}</div>;
}
// Rendered through a portal onto document.body: position:fixed is measured
// against the nearest ancestor with a transform/filter/animation, and the
// content pane's fade-in has one -- so an in-tree modal centered itself inside
// an 888-row table, thousands of pixels below the window (2026-09-24).
export function Modal({ title, onClose, children, width }) {
  return createPortal(<div style={{ position: "fixed", inset: 0, zIndex: 8000, background: "rgba(20,17,15,.55)", display: "grid", placeItems: "center", padding: 16 }} onClick={onClose}>
    <div className="tu-fade" onClick={(e) => e.stopPropagation()} style={{ background: TB.paper, borderRadius: 18, padding: 20, width: "min(" + (width || 640) + "px, 100%)", maxHeight: "92vh", overflowY: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18, color: TB.ink }}>{title}</div><button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", padding: 4 }}><L.X size={20} color={TB.slate} /></button></div>
      {children}
    </div>
  </div>, document.body);
}
export function PageTitle({ title, sub, right }) {
  return <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
    <div><div style={{ fontFamily: DISP, fontSize: 28, color: TB.ink, lineHeight: 1.05 }}>{title}</div>{sub && <div style={{ color: TB.slate, fontSize: 14, marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>{sub}</div>}</div>
    {right && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{right}</div>}
  </div>;
}
export function Table({ cols, rows, empty }) {
  return <div style={{ border: `1.5px solid ${C.line}`, borderRadius: 14, overflow: "hidden", background: "#fff" }}>
    <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
      <thead><tr style={{ background: TB.paper }}>{cols.map((c) => <th key={c} style={{ textAlign: "left", padding: "9px 12px", fontFamily: HEAD, fontSize: 11, letterSpacing: 0.7, textTransform: "uppercase", color: TB.slate, whiteSpace: "nowrap" }}>{c}</th>)}</tr></thead>
      <tbody>{rows.length ? rows : <tr><td colSpan={cols.length} style={{ padding: 18, color: C.mute, textAlign: "center" }}>{empty || "Nothing here yet."}</td></tr>}</tbody>
    </table></div>
  </div>;
}
export const td = { padding: "9px 12px", borderTop: `1px solid ${C.line}`, verticalAlign: "middle" };
export { TB, TAGLINE, TagUpMark, Wordmark, Card, Btn, Eyebrow, Chip, Field, inputStyle, L };

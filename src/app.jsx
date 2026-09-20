/* src/app.jsx -- tagup, the app. Router, the public pages (landing, sign up,
   sign in, reset, verify, invite), and the signed-in shell that hosts the
   tag screens (src/tagup-ui.jsx) and the workspace screens (src/admin.jsx). */
import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { C, HEAD, BODY, DISP, TB, TAGLINE, L, api, nav, Link, useRoute, useIsDesktop, session, ui, Primary, Ghost, Input, Notice, Field, Chip, TagUpMark, Wordmark } from "./shared";
import { RepScreen, Section, Queue, Batches, StylesEditor, MaterialsEditor, BrandsPanel, TagPreview, CORE, Card, Btn } from "./tagup-ui";
import { HomeScreen, StoresScreen, CatalogScreen, TeamScreen, SettingsScreen, HelpScreen, roleLabel } from "./admin";

/* ================================================================
   PUBLIC: landing
   ================================================================ */
const SAMPLE_STYLE_BOLD = { id: "s1", name: "Stripes", kind: "composed", format: "tag", theme: { layout: "bold", accent: "#C8102E", accentFg: "#FFFFFF", font: "oswald", caption: "EVERYDAY LOW PRICE" } };
const SAMPLE_STYLE_CLASSIC = { id: "s2", name: "7-Eleven", kind: "composed", format: "tag", theme: { layout: "classic", accent: "#0A6E3F", accentFg: "#FFFFFF", font: "bebas", priceColor: "#0A6E3F" } };
const SAMPLE_STYLE_MIN = { id: "s3", name: "Independent", kind: "composed", format: "tag", theme: { layout: "minimal", accent: "#14110F", font: "anton", caption: "" } };
const HERO_REQS = [
  { st: SAMPLE_STYLE_BOLD, req: Object.assign({}, CORE.SAMPLE_REQUEST, { itemName: "Michelob Ultra", packageSize: "12pk 12oz Cans", price: 14.99, chainLabel: "Stripes" }) },
  { st: SAMPLE_STYLE_CLASSIC, req: Object.assign({}, CORE.SAMPLE_REQUEST, { contentType: "promo", itemName: "Bud Light", packageSize: "24pk 12oz Cans", price: 19.99, wasPrice: 24.99, chainLabel: "7-Eleven", note: "Reg. $24.99" }) },
  { st: SAMPLE_STYLE_MIN, req: Object.assign({}, CORE.SAMPLE_REQUEST, { itemName: "Modelo Especial", packageSize: "24oz Can", price: 5.00, multiBuyQty: 2, chainLabel: "", note: "Single retail at $2.79" }) },
];
function Landing() {
  const desktop = useIsDesktop();
  const [k, setK] = useState(0);
  useEffect(() => { const t = setInterval(() => setK((x) => (x + 1) % HERO_REQS.length), 3200); return () => clearInterval(t); }, []);
  const Feature = ({ icon: I, title, body }) => <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 16, padding: 18 }}>
    <div style={{ width: 40, height: 40, borderRadius: 12, background: TB.signalSoft, display: "grid", placeItems: "center", marginBottom: 12 }}><I size={20} color={TB.signal} /></div>
    <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: TB.ink }}>{title}</div><div style={{ fontSize: 13.5, color: TB.slate, lineHeight: 1.55, marginTop: 5 }}>{body}</div>
  </div>;
  const Step = ({ n, title, body }) => <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><div style={{ width: 36, height: 36, borderRadius: 99, background: TB.ink, color: TB.paper, display: "grid", placeItems: "center", fontFamily: DISP, fontSize: 16, flexShrink: 0 }}>{n}</div><div><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: TB.ink }}>{title}</div><div style={{ fontSize: 14, color: TB.slate, lineHeight: 1.55, marginTop: 3 }}>{body}</div></div></div>;
  return <div style={{ background: TB.paper, minHeight: "100vh", fontFamily: BODY }}>
    <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: desktop ? "18px 40px" : "14px 18px", maxWidth: 1180, margin: "0 auto" }}>
      <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none" }}><TagUpMark size={26} /><Wordmark size={24} /></Link>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Ghost small onClick={() => nav("/login")}>Sign in</Ghost><Primary small onClick={() => nav("/signup")}>Start free</Primary></div>
    </header>
    <section style={{ maxWidth: 1180, margin: "0 auto", padding: desktop ? "40px 40px 60px" : "24px 18px 40px", display: "grid", gridTemplateColumns: desktop ? "minmax(0, 1.1fr) minmax(0, 1fr)" : "1fr", gap: 36, alignItems: "center" }}>
      <div className="tu-fade">
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 99, padding: "6px 12px", fontSize: 12.5, fontWeight: 600, color: TB.slate }}><span style={{ width: 8, height: 8, borderRadius: 99, background: TB.posted }} /> Price tags for beverage distributors</div>
        <h1 style={{ fontFamily: DISP, fontSize: desktop ? 60 : 40, lineHeight: 1.0, color: TB.ink, margin: "18px 0 14px", letterSpacing: -1 }}>Prices today.<br />On shelf tomorrow.</h1>
        <p style={{ fontSize: desktop ? 19 : 16.5, color: TB.slate, lineHeight: 1.55, margin: 0, maxWidth: 520 }}>Reps ask for a tag from their phone in thirty seconds. The sign shop prints the whole day in every chain's own style, on whatever sheet is in the printer. Nobody types a price twice.</p>
        <div style={{ display: "flex", gap: 10, marginTop: 24, flexWrap: "wrap" }}><Primary onClick={() => nav("/signup")}>Start your free trial <L.ArrowRight size={18} /></Primary><Ghost onClick={() => nav("/app/help")}>See how it works</Ghost></div>
        <div style={{ fontSize: 12.5, color: C.mute, marginTop: 10 }}>14 days, every feature, no card. Set up in an afternoon.</div>
      </div>
      <div style={{ display: "grid", placeItems: "center", position: "relative" }}>
        <div style={{ position: "absolute", inset: "10% 5%", background: `radial-gradient(closest-side, ${TB.signalSoft}, transparent)`, opacity: 0.9 }} />
        <div style={{ position: "relative", transform: "rotate(-2deg)", boxShadow: "0 24px 60px rgba(20,17,15,.22)", borderRadius: 6, background: "#fff" }}>
          <TagPreview req={HERO_REQS[k].req} style={HERO_REQS[k].st} widthPx={Math.min(420, (typeof window !== "undefined" ? window.innerWidth : 420) - 60)} />
        </div>
        <div style={{ position: "relative", display: "flex", gap: 6, marginTop: 18 }}>{HERO_REQS.map((h, i) => <button key={i} onClick={() => setK(i)} style={{ width: i === k ? 22 : 8, height: 8, borderRadius: 99, border: "none", background: i === k ? TB.signal : TB.kraft, cursor: "pointer", transition: "width .2s" }} />)}</div>
        <div style={{ position: "relative", fontSize: 12.5, color: TB.slate, marginTop: 8 }}>Three chains, three looks, one request flow. Rendered live by the same engine that prints.</div>
      </div>
    </section>
    <section style={{ background: "#fff", borderTop: `1px solid ${C.line}`, borderBottom: `1px solid ${C.line}` }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: desktop ? "48px 40px" : "32px 18px", display: "grid", gridTemplateColumns: desktop ? "repeat(3, 1fr)" : "1fr", gap: 28 }}>
        <Step n="1" title="A rep asks" body="Store, tag type, item, price. The chain's style follows the store, so the rep never picks a template. Imported price books skip even that." />
        <Step n="2" title="The sign shop batches" body="Tick what is ready, pick the sheet in the printer -- 3x2 shelf talkers, 2x1 tags, a letter page for a case card -- and tagup tiles the batch to fit." />
        <Step n="3" title="Print, and everyone knows" body="One print sheet, margins none, 100%. Mark it printed and every rep sees their tags flip to Printed. Sent something back? They see why." />
      </div>
    </section>
    <section style={{ maxWidth: 1180, margin: "0 auto", padding: desktop ? "56px 40px" : "36px 18px" }}>
      <div style={{ fontFamily: DISP, fontSize: desktop ? 34 : 28, color: TB.ink, lineHeight: 1.1, marginBottom: 8 }}>Everything a sign shop actually needs</div>
      <div style={{ fontSize: 15, color: TB.slate, marginBottom: 24, maxWidth: 640, lineHeight: 1.55 }}>Built with a distributor that prints thousands of tags a month, for the chains that hand down their own artwork and the ones that don't.</div>
      <div style={{ display: "grid", gridTemplateColumns: desktop ? "repeat(3, 1fr)" : "1fr", gap: 14 }}>
        <Feature icon={L.Palette} title="Chain templates" body="Upload the chain's own tag or case card -- PNG, JPG or PDF -- and drag the price, item and size onto it. Every store of that chain prints on it, exactly." />
        <Feature icon={L.FileSpreadsheet} title="Excel price books in" body="A chain sends a spreadsheet of prices; you import it. Header on any row, prices like 2/$5 or $2.69 each understood, every row previewed before anything is written." />
        <Feature icon={L.Zap} title="Rules that follow the price" body="A 2-for tier gets its colour. Every promo carries Reg. $x. Set it once on the style; the rep's preview and the print sheet both obey it." />
        <Feature icon={L.Sparkles} title="Brand logos, found for you" body="tagup reads the brands off your item list, finds the logos, and has AI check each match. A person approves before anything prints." />
        <Feature icon={L.Printer} title="Any sheet in the printer" body="Materials are yours to define: tag size, sheet size, how many fit. Any style prints on any material. Avery numbers welcome." />
        <Feature icon={L.Store} title="Your account list, as it is" body="Upload the export you already have -- account name, number, address, sales rep and rep number. Each rep's phone shows their own accounts; the sign shop sees them all." />
        <Feature icon={L.Smartphone} title="Made for a phone in a store aisle" body="Thumb-sized targets, five short steps, a preview before sending, and a status list that answers 'did my tags print?' without a phone call." />
      </div>
    </section>
    <section style={{ background: TB.ink, color: TB.paper }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: desktop ? "56px 40px" : "36px 18px", display: "grid", gridTemplateColumns: desktop ? "1fr 1fr" : "1fr", gap: 28, alignItems: "center" }}>
        <div><div style={{ fontFamily: DISP, fontSize: desktop ? 34 : 28, lineHeight: 1.1 }}>Free for 14 days.<br />Then one flat price per workspace.</div><div style={{ fontSize: 15, color: TB.kraft, marginTop: 10, lineHeight: 1.55, maxWidth: 480 }}>Unlimited reps, stores, styles and tags. No per-seat maths. When the trial ends nothing you made disappears -- it stays readable and printable while you decide.</div></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: desktop ? "flex-end" : "flex-start" }}><Primary onClick={() => nav("/signup")}>Start your free trial</Primary><a href="mailto:hello@tagup.app" style={{ textDecoration: "none" }}><Ghost style={{ borderColor: TB.paper, color: TB.paper }}>Talk to a person</Ghost></a></div>
      </div>
    </section>
    <footer style={{ maxWidth: 1180, margin: "0 auto", padding: "24px 18px", display: "flex", gap: 14, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", fontSize: 12.5, color: C.mute }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}><TagUpMark size={16} ink={TB.kraft} /> <span style={{ fontFamily: HEAD, fontWeight: 700, color: TB.slate }}>tagup</span> · {TAGLINE}</div>
      <div style={{ display: "flex", gap: 14 }}><Link to="/login" style={{ color: TB.slate, textDecoration: "none" }}>Sign in</Link><Link to="/signup" style={{ color: TB.slate, textDecoration: "none" }}>Start free</Link><a href="mailto:hello@tagup.app" style={{ color: TB.slate, textDecoration: "none" }}>hello@tagup.app</a></div>
    </footer>
  </div>;
}

/* ================================================================
   PUBLIC: auth pages
   ================================================================ */
function AuthShell({ title, sub, children, foot }) {
  return <div style={{ minHeight: "100vh", background: TB.paper, display: "grid", placeItems: "center", padding: 18 }}>
    <div className="tu-fade" style={{ width: "min(440px, 100%)" }}>
      <Link to="/" style={{ display: "flex", alignItems: "center", gap: 8, textDecoration: "none", justifyContent: "center", marginBottom: 22 }}><TagUpMark size={30} /><Wordmark size={28} /></Link>
      <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 18, padding: 24 }}>
        <div style={{ fontFamily: DISP, fontSize: 24, color: TB.ink, lineHeight: 1.1 }}>{title}</div>
        {sub && <div style={{ fontSize: 14, color: TB.slate, marginTop: 6, lineHeight: 1.5 }}>{sub}</div>}
        <div style={{ marginTop: 18 }}>{children}</div>
      </div>
      {foot && <div style={{ textAlign: "center", fontSize: 13.5, color: TB.slate, marginTop: 14 }}>{foot}</div>}
    </div>
  </div>;
}
function useForm(init) { const [f, setF] = useState(init); const set = (k) => (e) => setF((v) => Object.assign({}, v, { [k]: e.target.value })); return [f, set, setF]; }
function Signup({ onAuthed }) {
  const [f, set] = useForm({ name: "", orgName: "", email: "", password: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function go(e) { e.preventDefault(); setBusy(true); setErr(""); const r = await api.post("/api/signup", f); setBusy(false); if (r.error) { setErr(r.error); return; } onAuthed(r.token, r.org && r.org.id); nav("/app"); }
  return <AuthShell title="Start your free trial" sub="14 days, every feature, no card. Your workspace is ready the moment you finish this form." foot={<>Already have an account? <Link to="/login" style={{ color: TB.ink, fontWeight: 700 }}>Sign in</Link></>}>
    <form onSubmit={go}>
      <Field ui={ui} label="Your name"><Input autoFocus value={f.name} onChange={set("name")} placeholder="Ann-Michelle Ortiz" autoComplete="name" /></Field>
      <Field ui={ui} label="Company or team" hint="What the workspace is called. You can rename it later."><Input value={f.orgName} onChange={set("orgName")} placeholder="Standard Sales — Odessa" autoComplete="organization" /></Field>
      <Field ui={ui} label="Work email"><Input type="email" value={f.email} onChange={set("email")} placeholder="you@company.com" autoComplete="email" /></Field>
      <Field ui={ui} label="Password" hint="At least 8 characters."><Input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" /></Field>
      {err && <Notice kind="bad" style={{ marginBottom: 12 }}>{err}</Notice>}
      <Primary block type="submit" disabled={busy}>{busy ? "Creating your workspace…" : "Create my workspace"}</Primary>
      <div style={{ fontSize: 12, color: C.mute, marginTop: 10, textAlign: "center" }}>We'll email you a link to confirm the address. You can start right away.</div>
    </form>
  </AuthShell>;
}
function Login({ onAuthed }) {
  const [f, set] = useForm({ email: "", password: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  async function go(e) { e.preventDefault(); setBusy(true); setErr(""); const r = await api.post("/api/login", f); setBusy(false); if (r.error) { setErr(r.error); return; } const org = (r.orgs || [])[0]; onAuthed(r.token, org && org.id); nav("/app"); }
  return <AuthShell title="Welcome back" foot={<>New here? <Link to="/signup" style={{ color: TB.ink, fontWeight: 700 }}>Start a free trial</Link></>}>
    <form onSubmit={go}>
      <Field ui={ui} label="Email"><Input autoFocus type="email" value={f.email} onChange={set("email")} autoComplete="email" /></Field>
      <Field ui={ui} label="Password"><Input type="password" value={f.password} onChange={set("password")} autoComplete="current-password" /></Field>
      {err && <Notice kind="bad" style={{ marginBottom: 12 }}>{err}</Notice>}
      <Primary block type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Primary>
      <div style={{ textAlign: "center", marginTop: 12 }}><Link to="/forgot" style={{ fontSize: 13, color: TB.slate }}>Forgot your password?</Link></div>
    </form>
  </AuthShell>;
}
function Forgot() {
  const [email, setEmail] = useState(""); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false);
  async function go(e) { e.preventDefault(); setBusy(true); await api.post("/api/password/forgot", { email }); setBusy(false); setDone(true); }
  return <AuthShell title="Reset your password" sub="Enter your email and we'll send a link that works for an hour." foot={<Link to="/login" style={{ color: TB.ink, fontWeight: 700 }}>Back to sign in</Link>}>
    {done ? <Notice kind="ok">If that address has an account, a reset link is on its way. Check spam if it takes more than a minute.</Notice> : <form onSubmit={go}>
      <Field ui={ui} label="Email"><Input autoFocus type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
      <Primary block type="submit" disabled={busy || !email}>{busy ? "Sending…" : "Send reset link"}</Primary>
    </form>}
  </AuthShell>;
}
function Reset({ token }) {
  const [pw, setPw] = useState(""); const [done, setDone] = useState(false); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  async function go(e) { e.preventDefault(); setBusy(true); setErr(""); const r = await api.post("/api/password/reset", { token, password: pw }); setBusy(false); if (r.error) setErr(r.error); else setDone(true); }
  return <AuthShell title="Choose a new password" foot={<Link to="/login" style={{ color: TB.ink, fontWeight: 700 }}>Back to sign in</Link>}>
    {done ? <><Notice kind="ok" style={{ marginBottom: 12 }}>Password changed. Sign in with the new one.</Notice><Primary block onClick={() => nav("/login")}>Sign in</Primary></> : <form onSubmit={go}>
      <Field ui={ui} label="New password" hint="At least 8 characters."><Input autoFocus type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></Field>
      {err && <Notice kind="bad" style={{ marginBottom: 12 }}>{err}</Notice>}
      <Primary block type="submit" disabled={busy || pw.length < 8}>{busy ? "Saving…" : "Set password"}</Primary>
    </form>}
  </AuthShell>;
}
function Verify({ token }) {
  const [state, setState] = useState("busy");
  useEffect(() => { api.get("/api/verify?token=" + encodeURIComponent(token || "")).then((r) => setState(r.error ? "bad:" + r.error : "ok")).catch(() => setState("bad:Couldn't reach the server.")); }, [token]);
  return <AuthShell title={state === "ok" ? "You're verified" : state === "busy" ? "One moment…" : "That link didn't work"}>
    {state === "ok" && <><Notice kind="ok" style={{ marginBottom: 12 }}>Your email is confirmed.</Notice><Primary block onClick={() => nav(session.token ? "/app" : "/login")}>{session.token ? "Open tagup" : "Sign in"}</Primary></>}
    {state.startsWith("bad:") && <><Notice kind="bad" style={{ marginBottom: 12 }}>{state.slice(4)}</Notice><Ghost block onClick={() => nav("/login")}>Sign in</Ghost></>}
  </AuthShell>;
}
function AcceptInvite({ token, onAuthed }) {
  const [f, set] = useForm({ name: "", password: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const signedIn = !!session.token;
  async function go(e) { if (e) e.preventDefault(); setBusy(true); setErr(""); const r = await api.post("/api/invites/accept", Object.assign({ token }, signedIn ? {} : f)); setBusy(false); if (r.error) { setErr(r.error); return; } onAuthed(r.token, null); session.org = ""; nav("/app"); }
  return <AuthShell title="You're invited" sub={signedIn ? "Accept to join this workspace with the account you're signed in as." : "Set your name and a password and you're in."} foot={<>Already have a tagup account? <Link to="/login" style={{ color: TB.ink, fontWeight: 700 }}>Sign in first</Link>, then open this link again.</>}>
    {signedIn ? <>{err && <Notice kind="bad" style={{ marginBottom: 12 }}>{err}</Notice>}<Primary block disabled={busy} onClick={() => go()}>{busy ? "Joining…" : "Join the workspace"}</Primary></> : <form onSubmit={go}>
      <Field ui={ui} label="Your name"><Input autoFocus value={f.name} onChange={set("name")} autoComplete="name" /></Field>
      <Field ui={ui} label="Password" hint="At least 8 characters."><Input type="password" value={f.password} onChange={set("password")} autoComplete="new-password" /></Field>
      {err && <Notice kind="bad" style={{ marginBottom: 12 }}>{err}</Notice>}
      <Primary block type="submit" disabled={busy || !f.name || f.password.length < 8}>{busy ? "Joining…" : "Accept and join"}</Primary>
    </form>}
  </AuthShell>;
}

/* ================================================================
   THE SHELL
   ================================================================ */
const NAV = [
  { id: "home", label: "Home", icon: L.Home, roles: ["owner", "admin", "manager"] },
  { id: "request", label: "Request a tag", icon: L.Tag, roles: ["owner", "admin", "manager", "rep"] },
  { id: "queue", label: "Queue", icon: L.Inbox, roles: ["owner", "admin", "manager"] },
  { id: "batches", label: "Print batches", icon: L.Printer, roles: ["owner", "admin", "manager"] },
  { id: "styles", label: "Chain styles", icon: L.Palette, roles: ["owner", "admin"], group: "Set up" },
  { id: "materials", label: "Materials", icon: L.Layers, roles: ["owner", "admin"], group: "Set up" },
  { id: "brands", label: "Brand logos", icon: L.Sparkles, roles: ["owner", "admin"], group: "Set up" },
  { id: "stores", label: "Accounts", icon: L.Store, roles: ["owner", "admin", "manager"], group: "Set up" },
  { id: "catalog", label: "Catalog", icon: L.Package, roles: ["owner", "admin", "manager"], group: "Set up" },
  { id: "team", label: "Team", icon: L.Users, roles: ["owner", "admin", "manager"], group: "Workspace" },
  { id: "settings", label: "Settings", icon: L.Settings, roles: ["owner", "admin", "manager", "rep"], group: "Workspace" },
  { id: "help", label: "Learn", icon: L.HelpCircle || L.CircleHelp, roles: ["owner", "admin", "manager", "rep"], group: "Workspace" },
];
function Shell({ route, me, orgs, setOrgs, onSignOut }) {
  const desktop = useIsDesktop();
  const [more, setMore] = useState(false);
  const orgId = session.org;
  const org = orgs.find((o) => o.id === orgId) || orgs[0];
  useEffect(() => { if (org && org.id !== orgId) session.org = org.id; }, [org && org.id]);
  const role = org ? org.role : "rep";
  const sec = (route.path.split("/")[2] || (role === "rep" ? "request" : "home"));
  const allowed = NAV.filter((n) => n.roles.indexOf(role) !== -1);
  const cur = allowed.find((n) => n.id === sec) || allowed[0];
  const canAdmin = role === "owner" || role === "admin";
  const trialLeft = org && org.trial_ends_at ? Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / 86400000) : null;
  const trialOver = org && org.plan === "trial" && trialLeft != null && trialLeft <= 0;
  function go(id) { setMore(false); nav("/app/" + id); }
  function switchOrg(id) { session.org = id; nav("/app"); window.location.reload(); }
  function showPrintable(url) { window.open(url + (url.indexOf("?") === -1 ? "?" : "&") + "org=" + encodeURIComponent(org.id), "_blank"); }
  if (!org) return <AuthShell title="No workspace yet" sub="Your account isn't on a workspace. Ask an admin for an invite, or start your own.">
    <Primary block onClick={() => nav("/signup")}>Start a workspace</Primary><div style={{ height: 8 }} /><Ghost block onClick={onSignOut}>Sign out</Ghost>
  </AuthShell>;

  // The rep's whole app is the request flow, full-bleed, phone-shaped.
  if (role === "rep" && cur.id === "request") {
    return <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: TB.paper }}>
      <div style={{ flex: 1, minHeight: 0, maxWidth: 560, width: "100%", margin: "0 auto" }}><RepScreen ui={ui} me={me} standalone onBack={() => go("settings")} /></div>
    </div>;
  }
  const body = <>
    {cur.id === "home" && <HomeScreen me={me} org={org} role={role} />}
    {cur.id === "request" && <div style={{ maxWidth: 520, margin: "0 auto", height: "calc(100vh - " + (desktop ? 96 : 150) + "px)", minHeight: 520, border: `1.5px solid ${C.line}`, borderRadius: 22, overflow: "hidden", background: TB.paper, boxShadow: "0 10px 30px rgba(20,17,15,.08)" }}><RepScreen ui={ui} me={me} onBack={() => go("home")} /></div>}
    {cur.id === "queue" && <><SectionTitle title="Queue" sub="What reps asked for. Tick what is ready, pick the sheet, make a batch." /><SectionHost tab="queue" role={role} showPrintable={showPrintable} /></>}
    {cur.id === "batches" && <><SectionTitle title="Print batches" sub="Each batch is one print sheet. Print it, then mark it printed so the reps know." /><SectionHost tab="batches" role={role} showPrintable={showPrintable} /></>}
    {cur.id === "styles" && <><SectionTitle title="Chain styles" sub="How a tag looks, per chain and per format. A chain's own artwork, or a layout built from colours and a logo -- with rules that follow the price." /><SectionHost tab="styles" role={role} /></>}
    {cur.id === "materials" && <><SectionTitle title="Materials" sub="What the printer has loaded: tag size, sheet size, how many fit." /><SectionHost tab="materials" role={role} /></>}
    {cur.id === "brands" && <><SectionTitle title="Brand logos" sub="The brands in your item list and the logo each prints with. Recognize, find, approve." /><SectionHost tab="brands" role={role} /></>}
    {cur.id === "stores" && <StoresScreen canAdmin={canAdmin} />}
    {cur.id === "catalog" && <CatalogScreen canAdmin={canAdmin} />}
    {cur.id === "team" && <TeamScreen me={me} role={role} />}
    {cur.id === "settings" && <SettingsScreen me={me} org={org} role={role} onSignOut={onSignOut} onOrgChanged={(o) => setOrgs(orgs.map((x) => (x.id === o.id ? Object.assign({}, x, o) : x)))} />}
    {cur.id === "help" && <HelpScreen role={role} />}
  </>;
  const OrgSwitch = () => orgs.length > 1
    ? <select value={org.id} onChange={(e) => switchOrg(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: `1.5px solid ${C.line}`, background: "#fff", fontSize: 13, fontFamily: HEAD, fontWeight: 600, maxWidth: 200 }}>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
    : <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 13.5, color: TB.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 220 }}>{org.name}</div>;
  const TrialBar = () => (org.plan === "trial" && trialLeft != null && (trialLeft <= 5) ? <div style={{ background: trialOver ? TB.pullSoft : TB.signalSoft, color: trialOver ? "#A31D1D" : "#8A3A08", padding: "8px 16px", fontSize: 13, fontWeight: 600, display: "flex", gap: 10, alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
    {trialOver ? "Your free trial has ended. Everything here stays readable and printable; new requests and edits wait for a plan." : "Your free trial ends in " + trialLeft + " day" + (trialLeft === 1 ? "" : "s") + "."}
    <a href="mailto:hello@tagup.app?subject=tagup%20plan" style={{ color: "inherit", fontWeight: 800 }}>Talk to us →</a>
  </div> : null);

  if (desktop) {
    const groups = [null, "Set up", "Workspace"];
    return <div style={{ minHeight: "100vh", background: TB.paper, display: "flex" }}>
      <aside style={{ width: 232, flexShrink: 0, borderRight: `1px solid ${C.line}`, background: "#fff", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh" }}>
        <div style={{ padding: "18px 18px 12px", display: "flex", alignItems: "center", gap: 8 }}><TagUpMark size={24} /><Wordmark size={22} /></div>
        <div style={{ padding: "0 14px 12px", borderBottom: `1px solid ${C.line}` }}><OrgSwitch /><div style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>{me.name} · {roleLabel(role)}</div></div>
        <nav style={{ padding: "10px 10px", flex: 1, overflowY: "auto" }}>
          {groups.map((g) => { const items = allowed.filter((n) => (n.group || null) === g); if (!items.length) return null; return <div key={g || "main"} style={{ marginBottom: 12 }}>
            {g && <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 10.5, letterSpacing: 1, textTransform: "uppercase", color: C.mute, padding: "6px 10px 4px" }}>{g}</div>}
            {items.map((n) => { const I = n.icon; const on = n.id === cur.id; return <button key={n.id} onClick={() => go(n.id)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: "none", background: on ? TB.ink : "transparent", color: on ? TB.paper : TB.ink, fontFamily: HEAD, fontWeight: 600, fontSize: 14, cursor: "pointer", textAlign: "left", marginBottom: 2 }}><I size={17} color={on ? TB.signal : TB.slate} />{n.label}</button>; })}
          </div>; })}
        </nav>
        <div style={{ padding: 12, borderTop: `1px solid ${C.line}` }}><button onClick={onSignOut} style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", color: TB.slate, fontSize: 13, cursor: "pointer", fontFamily: HEAD, fontWeight: 600, padding: "6px 8px" }}><L.LogOut size={15} /> Sign out</button></div>
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>
        <TrialBar />
        <div style={{ padding: "28px 32px 60px", maxWidth: 1180 }}>{body}</div>
      </main>
    </div>;
  }
  // Phone: top bar + content + a bottom tab bar (4 + More).
  const primary = allowed.filter((n) => !n.group).slice(0, 4);
  const rest = allowed.filter((n) => primary.indexOf(n) === -1);
  return <div style={{ minHeight: "100vh", background: TB.paper, display: "flex", flexDirection: "column" }}>
    <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#fff", borderBottom: `1px solid ${C.line}`, padding: "10px 14px", display: "flex", alignItems: "center", gap: 10 }}>
      <TagUpMark size={22} /><div style={{ flex: 1, minWidth: 0 }}><OrgSwitch /></div><span style={{ fontSize: 12, color: C.mute }}>{roleLabel(role)}</span>
    </div>
    <TrialBar />
    <div style={{ flex: 1, padding: "16px 14px 90px" }}>{body}</div>
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#fff", borderTop: `1px solid ${C.line}`, display: "flex", padding: "6px 6px calc(6px + env(safe-area-inset-bottom))", zIndex: 30 }}>
      {primary.map((n) => { const I = n.icon; const on = n.id === cur.id; return <button key={n.id} onClick={() => go(n.id)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 2px", border: "none", background: "none", color: on ? TB.ink : C.mute, fontFamily: HEAD, fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}><I size={20} color={on ? TB.signal : C.mute} />{n.label.split(" ")[0]}</button>; })}
      {rest.length > 0 && <button onClick={() => setMore(true)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, padding: "6px 2px", border: "none", background: "none", color: rest.some((n) => n.id === cur.id) ? TB.ink : C.mute, fontFamily: HEAD, fontWeight: 700, fontSize: 10.5, cursor: "pointer" }}><L.MoreHorizontal size={20} color={rest.some((n) => n.id === cur.id) ? TB.signal : C.mute} />More</button>}
    </div>
    {more && <div style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(20,17,15,.45)" }} onClick={() => setMore(false)}>
      <div className="tu-fade" onClick={(e) => e.stopPropagation()} style={{ position: "absolute", left: 0, right: 0, bottom: 0, background: "#fff", borderRadius: "18px 18px 0 0", padding: "14px 14px calc(18px + env(safe-area-inset-bottom))" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>{rest.map((n) => { const I = n.icon; return <button key={n.id} onClick={() => go(n.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 6px", borderRadius: 14, border: `1.5px solid ${C.line}`, background: n.id === cur.id ? TB.signalSoft : TB.paper, color: TB.ink, fontFamily: HEAD, fontWeight: 700, fontSize: 12, cursor: "pointer" }}><I size={20} color={TB.slate} />{n.label}</button>; })}</div>
        <button onClick={onSignOut} style={{ width: "100%", marginTop: 10, padding: 12, borderRadius: 12, border: "none", background: "none", color: TB.slate, fontFamily: HEAD, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Sign out</button>
      </div>
    </div>}
  </div>;
}
function SectionTitle({ title, sub }) { return <div style={{ marginBottom: 16 }}><div style={{ fontFamily: DISP, fontSize: 28, color: TB.ink, lineHeight: 1.05 }}>{title}</div><div style={{ color: TB.slate, fontSize: 14, marginTop: 6, maxWidth: 640, lineHeight: 1.5 }}>{sub}</div></div>; }
// One tab of the ported Section, without its own pill row -- the shell's nav is the pill row.
function SectionHost({ tab, role, showPrintable }) {
  const [setup, setSetup] = useState(null); const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey((k) => k + 1);
  useEffect(() => { api.get("/api/setup").then(setSetup).catch(() => setSetup({ error: "Couldn't load setup." })); }, [reloadKey]);
  const canEdit = !!(setup && setup.canEdit);
  const canWork = role !== "rep";
  return <div>
    {setup && setup.error && <Notice kind="bad" style={{ marginBottom: 12 }}>{setup.error}</Notice>}
    {tab === "queue" && <Queue ui={ui} setup={setup} canEdit={canWork} onChanged={bump} reloadKey={reloadKey} bq="" />}
    {tab === "batches" && <Batches ui={ui} setup={setup} canEdit={canWork} onChanged={bump} reloadKey={reloadKey} showPrintable={showPrintable} bq="" />}
    {tab === "styles" && canEdit && <StylesEditor ui={ui} setup={setup} onChanged={bump} bq="" />}
    {tab === "materials" && canEdit && <MaterialsEditor ui={ui} setup={setup} onChanged={bump} bq="" />}
    {tab === "brands" && canEdit && <BrandsPanel ui={ui} />}
  </div>;
}

/* ================================================================
   ROOT
   ================================================================ */
function App() {
  const route = useRoute();
  const [me, setMe] = useState(undefined);      // undefined = loading, null = signed out
  const [orgs, setOrgs] = useState([]);
  function loadMe() {
    if (!session.token) { setMe(null); return; }
    api.get("/api/me").then((r) => { if (r && r.ok) { setMe(r.user); setOrgs(r.orgs || []); if (!session.org && r.orgs && r.orgs[0]) session.org = r.orgs[0].id; if (session.org && r.orgs && !r.orgs.some((o) => o.id === session.org)) session.org = r.orgs[0] ? r.orgs[0].id : ""; } else { session.token = ""; setMe(null); } }).catch(() => setMe(null));
  }
  // ?t=<token>&o=<org> signs this browser in and drops the query -- the door
  // a "magic link" or an automated screenshot run uses. A token is only ever
  // the bearer's own, so this grants nothing a pasted header would not.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("t")) { session.token = q.get("t"); if (q.get("o")) session.org = q.get("o"); q.delete("t"); q.delete("o"); window.history.replaceState({}, "", window.location.pathname + (q.toString() ? "?" + q : "") + window.location.hash); }
    loadMe();
  }, []);
  function onAuthed(token, orgId) { session.token = token; if (orgId) session.org = orgId; setMe(undefined); loadMe(); }
  function signOut() { session.token = ""; session.org = ""; setMe(null); setOrgs([]); nav("/"); }
  const p = route.path;
  if (p === "/signup") return <Signup onAuthed={onAuthed} />;
  if (p === "/login") return <Login onAuthed={onAuthed} />;
  if (p === "/forgot") return <Forgot />;
  if (p === "/reset") return <Reset token={route.query.token} />;
  if (p === "/verify") return <Verify token={route.query.token} />;
  if (p === "/accept-invite") return <AcceptInvite token={route.query.token} onAuthed={onAuthed} />;
  if (p === "/app" || p.startsWith("/app/")) {
    if (me === undefined) return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: TB.paper }}><div style={{ display: "flex", alignItems: "center", gap: 10, opacity: 0.7 }}><TagUpMark size={28} /><Wordmark size={24} /></div></div>;
    if (me === null) { if (!session.token) { return <Login onAuthed={onAuthed} />; } }
    return <Shell route={route} me={me} orgs={orgs} setOrgs={setOrgs} onSignOut={signOut} />;
  }
  return <Landing />;
}
createRoot(document.getElementById("root")).render(<App />);

/* src/admin.jsx -- the workspace screens around the tag flow: Home (with the
   onboarding checklist), Stores, Catalog, Team, Settings, Help. */
import React, { useState, useEffect, useMemo, useRef } from "react";
import { C, HEAD, BODY, DISP, TB, L, api, nav, Link, Primary, Ghost, Input, Notice, Modal, PageTitle, Table, td, Field, Chip, Card, ui, session, inputStyle } from "./shared";
import { TagPreview, CORE, ago, EmptyState } from "./tagup-ui";
import { TUTORIALS } from "./tutorials";

/* ================================================================
   HOME -- checklist + the day's numbers
   ================================================================ */
const STEPS = [
  { k: "added_store", title: "Add your stores", sub: "One at a time, or upload the account list.", to: "/app/stores", icon: L.Store },
  { k: "picked_style", title: "Set up a chain style", sub: "Upload a chain's artwork or build a layout.", to: "/app/styles", icon: L.Palette },
  { k: "made_request", title: "Ask for a tag", sub: "Try the rep's flow yourself -- 30 seconds.", to: "/app/request", icon: L.Tag },
  { k: "printed_one", title: "Print a batch", sub: "Tick it in the queue, pick a sheet, print.", to: "/app/queue", icon: L.Printer },
  { k: "invited_team", title: "Invite the team", sub: "Reps request, managers print.", to: "/app/team", icon: L.Users },
];
export function HomeScreen({ me, org, role }) {
  const [ob, setOb] = useState(null);
  const [reqs, setReqs] = useState(null);
  const [batches, setBatches] = useState(null);
  useEffect(() => {
    api.get("/api/onboarding").then((r) => setOb(r && r.state)).catch(() => setOb({}));
    api.get("/api/requests?status=all").then((r) => setReqs((r && r.requests) || [])).catch(() => setReqs([]));
    api.get("/api/batches").then((r) => setBatches((r && r.batches) || [])).catch(() => setBatches([]));
  }, []);
  const done = ob ? STEPS.filter((s) => ob[s.k]).length : 0;
  const showList = ob && !ob.dismissed && done < STEPS.length;
  const list = reqs || [];
  const week = Date.now() - 7 * 86400000;
  const n = {
    pending: list.filter((r) => r.status === "pending").length,
    batched: list.filter((r) => r.status === "reviewed").length,
    printed: list.filter((r) => r.status === "printed" && new Date(r.printedAt || r.updatedAt).getTime() > week).length,
    back: list.filter((r) => r.status === "rejected" && new Date(r.updatedAt).getTime() > week).length,
    toPrint: (batches || []).filter((b) => b.status !== "printed").length,
  };
  const recent = list.filter((r) => r.status === "pending").slice(0, 5);
  const Tile = ({ label, value, to, accent }) => <Link to={to} style={{ textDecoration: "none" }}><div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderTop: `4px solid ${accent || TB.signal}`, borderRadius: 14, padding: "14px 16px", minWidth: 0 }}>
    <div style={{ fontFamily: DISP, fontSize: 30, color: TB.ink, lineHeight: 1 }}>{value}</div><div style={{ fontFamily: HEAD, fontWeight: 600, fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase", color: TB.slate, marginTop: 6 }}>{label}</div>
  </div></Link>;
  const hour = new Date().getHours();
  return <div className="tu-fade">
    <PageTitle title={(hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening") + ", " + (me.name || "").split(" ")[0] + "."} sub={org.name + " · " + roleLabel(role)} />
    {showList && <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 16, padding: 18, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: TB.ink }}>Get set up</div><div style={{ fontSize: 13, color: TB.slate }}>{done} of {STEPS.length} done. Each one takes a minute or two.</div></div>
        <div style={{ width: 120, height: 8, borderRadius: 4, background: C.line, overflow: "hidden" }}><div style={{ width: (done / STEPS.length * 100) + "%", height: "100%", background: TB.posted }} /></div>
        <button onClick={() => api.post("/api/onboarding/dismiss").then(() => setOb(Object.assign({}, ob, { dismissed: true })))} title="Hide this list" style={{ background: "none", border: "none", cursor: "pointer", color: C.mute, fontSize: 12 }}>Hide</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10 }}>
        {STEPS.map((s, i) => { const ok = !!ob[s.k]; const I = s.icon; return <Link key={s.k} to={s.to} style={{ textDecoration: "none" }}><div style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: 12, border: `1.5px solid ${ok ? TB.postedSoft : C.line}`, background: ok ? TB.postedSoft : TB.paper, opacity: ok ? 0.8 : 1 }}>
          <div style={{ width: 30, height: 30, borderRadius: 99, display: "grid", placeItems: "center", background: ok ? TB.posted : TB.signal, color: ok ? "#fff" : TB.ink, flexShrink: 0 }}>{ok ? <L.Check size={16} /> : <I size={15} />}</div>
          <div><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 13.5, color: TB.ink, textDecoration: ok ? "line-through" : "none" }}>{i + 1}. {s.title}</div><div style={{ fontSize: 12, color: TB.slate, marginTop: 2 }}>{s.sub}</div></div>
        </div></Link>; })}
      </div>
    </div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10, marginBottom: 20 }}>
      <Tile label="Waiting" value={reqs ? n.pending : "–"} to="/app/queue" />
      <Tile label="In a batch" value={reqs ? n.batched : "–"} to="/app/queue" accent={TB.slate} />
      <Tile label="Batches to print" value={batches ? n.toPrint : "–"} to="/app/batches" accent={TB.ink} />
      <Tile label="Printed this week" value={reqs ? n.printed : "–"} to="/app/queue" accent={TB.posted} />
      <Tile label="Sent back this week" value={reqs ? n.back : "–"} to="/app/queue" accent={TB.pull} />
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
      <div>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14, letterSpacing: 0.4, textTransform: "uppercase", color: TB.slate, marginBottom: 8 }}>Latest requests</div>
        {reqs && !recent.length && <EmptyState ui={ui} title="Nothing waiting" sub="When a rep asks for a tag it lands here." />}
        {recent.map((r) => <Link key={r.id} to="/app/queue" style={{ textDecoration: "none" }}><div style={{ display: "flex", gap: 10, alignItems: "center", background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "9px 12px", marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14, color: TB.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.itemName}{r.price != null && <span style={{ color: TB.slate, fontWeight: 500 }}> · {CORE.priceLine(r.price, r.multiBuyQty)}</span>}</div><div style={{ fontSize: 12, color: TB.slate }}>{r.storeName} · {r.userName} · {ago(r.createdAt)}</div></div>
          <L.ChevronRight size={16} color={C.mute} />
        </div></Link>)}
      </div>
      <div>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14, letterSpacing: 0.4, textTransform: "uppercase", color: TB.slate, marginBottom: 8 }}>Learn it in minutes</div>
        {TUTORIALS.slice(0, 3).map((t) => <Link key={t.id} to={"/app/help#" + t.id} style={{ textDecoration: "none" }}><div style={{ display: "flex", gap: 10, alignItems: "center", background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "9px 12px", marginBottom: 6 }}>
          <div style={{ width: 34, height: 34, borderRadius: 10, background: TB.signalSoft, display: "grid", placeItems: "center", flexShrink: 0 }}><L.PlayCircle size={18} color={TB.signal} /></div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14, color: TB.ink }}>{t.title}</div><div style={{ fontSize: 12, color: TB.slate }}>{t.minutes} min · {t.blurb}</div></div>
        </div></Link>)}
      </div>
    </div>
  </div>;
}
export function roleLabel(r) { return { owner: "Owner", admin: "Admin", manager: "Manager", rep: "Rep" }[r] || r; }

/* ================================================================
   STORES
   ================================================================ */
export function StoresScreen({ canAdmin }) {
  const [data, setData] = useState(null);
  const [teams, setTeams] = useState([]);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState(null);
  const [upload, setUpload] = useState(false);
  const [msg, setMsg] = useState("");
  function load() { api.get("/api/stores?styles=1").then((r) => setData(r)).catch(() => setData({ error: "Couldn't load stores." })); api.get("/api/orgs/" + session.org + "/teams").then((r) => setTeams((r && r.teams) || [])).catch(() => {}); }
  useEffect(load, []);
  const stores = (data && data.stores) || [];
  const shown = stores.filter((s) => !q || (s.name + " " + (s.storeNo || "") + " " + s.city + " " + s.chainLabel).toLowerCase().includes(q.toLowerCase()));
  const chains = useMemo(() => { const m = {}; stores.forEach((s) => { const k = s.chainLabel || "Independent"; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); }, [stores]);
  async function retire(s) { if (!window.confirm("Retire " + s.name + "? Its request history stays; it just leaves the pickers.")) return; const r = await api.post("/api/stores/" + s.id + "/retire"); if (r.error) window.alert(r.error); else load(); }
  const teamName = (id) => (teams.find((t) => t.id === id) || {}).name || "";
  return <div className="tu-fade">
    <PageTitle title="Stores" sub="Every store a rep can ask for a tag for. The chain decides which style prints; the team decides which manager sees it." right={canAdmin && <><Ghost small onClick={() => setUpload(true)}><L.Upload size={15} /> Upload a list</Ghost><Primary small onClick={() => setEdit({ name: "", storeNo: "", city: "", chain: "", teamId: "" })}><L.Plus size={15} /> Add a store</Primary></>} />
    {msg && <Notice kind="ok" style={{ marginBottom: 12 }}>{msg}</Notice>}
    {data && data.error && <Notice kind="bad" style={{ marginBottom: 12 }}>{data.error}</Notice>}
    {data && !stores.length && !data.error && <div style={{ background: "#fff", border: `2px dashed ${TB.kraft}`, borderRadius: 16, padding: 28, textAlign: "center", marginBottom: 14 }}>
      <L.Store size={36} color={TB.kraft} /><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: TB.ink, marginTop: 8 }}>No stores yet</div>
      <div style={{ fontSize: 13.5, color: TB.slate, marginTop: 4, maxWidth: 420, margin: "4px auto 0" }}>Upload the account list you already have -- a spreadsheet with a Name column, plus Store #, City and Chain when you have them -- or add one by hand to try it.</div>
      {canAdmin && <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 14 }}><Primary small onClick={() => setUpload(true)}><L.Upload size={15} /> Upload a list</Primary><Ghost small onClick={() => setEdit({ name: "", storeNo: "", city: "", chain: "", teamId: "" })}>Add one store</Ghost></div>}
    </div>}
    {stores.length > 0 && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
      <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}><span style={{ position: "absolute", left: 11, top: 11 }}><L.Search size={16} color={C.mute} /></span><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search stores" style={{ paddingLeft: 34 }} /></div>
      <span style={{ fontSize: 12.5, color: TB.slate }}>{stores.length} store{stores.length === 1 ? "" : "s"} · {chains.length} chain{chains.length === 1 ? "" : "s"}</span>
      <span style={{ flex: 1 }} />
      {chains.slice(0, 6).map(([k, n]) => <Chip key={k} ui={ui} small bg={k === "Independent" ? C.lineCool : TB.signalSoft}>{k} · {n}</Chip>)}
    </div>}
    {stores.length > 0 && <Table cols={["Store", "#", "City", "Chain", "Team", "Tag style", canAdmin ? "" : null].filter((x) => x != null)} rows={shown.slice(0, 300).map((s) => <tr key={s.id}>
      <td style={td}><b>{s.name}</b></td><td style={Object.assign({ color: C.mute }, td)}>{s.storeNo || "—"}</td><td style={td}>{s.city}</td>
      <td style={td}><Chip ui={ui} small bg={s.chainId ? TB.signalSoft : C.lineCool}>{s.chainLabel || "Independent"}</Chip></td>
      <td style={td}>{teamName(s.teamId) || <span style={{ color: C.mute }}>—</span>}</td>
      <td style={Object.assign({ fontSize: 12.5, color: TB.slate }, td)}>{s.styleName}{s.caseCardStyleName && s.caseCardStyleName !== s.styleName ? " · " + s.caseCardStyleName : ""}</td>
      {canAdmin && <td style={Object.assign({ whiteSpace: "nowrap", textAlign: "right" }, td)}><button onClick={() => setEdit({ id: s.id, name: s.name, storeNo: s.storeNo || "", city: s.city, chain: s.chainRaw || "", teamId: s.teamId || "" })} style={iconBtn}><L.Pencil size={15} /></button><button onClick={() => retire(s)} style={iconBtn} title="Retire"><L.Trash2 size={15} /></button></td>}
    </tr>)} empty={q ? "No store matches." : "No stores yet."} />}
    {shown.length > 300 && <div style={{ fontSize: 12, color: C.mute, marginTop: 6 }}>Showing 300 of {shown.length} -- keep typing.</div>}
    {edit && <StoreForm s={edit} teams={teams} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    {upload && <StoreUpload onClose={() => setUpload(false)} onDone={(r) => { setUpload(false); setMsg("Loaded " + r.created + " new store" + (r.created === 1 ? "" : "s") + ", updated " + r.updated + "."); load(); }} />}
  </div>;
}
const iconBtn = { background: "none", border: "none", cursor: "pointer", padding: 6, color: TB.slate };
function StoreForm({ s, teams, onClose, onSaved }) {
  const [f, setF] = useState(s); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (p) => setF((v) => Object.assign({}, v, p));
  async function save(e) { if (e) e.preventDefault(); setBusy(true); setErr(""); const r = await api.post("/api/stores", f); setBusy(false); if (r.error) setErr(r.error); else onSaved(); }
  return <Modal title={s.id ? "Edit store" : "Add a store"} onClose={onClose} width={520}>
    <form onSubmit={save}>
      <Field ui={ui} label="Store name"><Input autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="Stripes #2134" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field ui={ui} label="Store #" hint="Optional. Lets a re-upload find it."><Input value={f.storeNo} onChange={(e) => set({ storeNo: e.target.value })} /></Field>
        <Field ui={ui} label="City"><Input value={f.city} onChange={(e) => set({ city: e.target.value })} /></Field>
      </div>
      <Field ui={ui} label="Chain" hint="Every store of a chain prints in that chain's style. Leave blank for an independent."><Input value={f.chain} onChange={(e) => set({ chain: e.target.value })} placeholder="Stripes" /></Field>
      {teams.length > 0 && <Field ui={ui} label="Team"><select value={f.teamId} onChange={(e) => set({ teamId: e.target.value })} style={Object.assign({}, inputStyle(ui))}><option value="">— none —</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {err && <Notice kind="bad" style={{ marginBottom: 10 }}>{err}</Notice>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Ghost small onClick={onClose}>Cancel</Ghost><Primary small type="submit" disabled={busy || !f.name.trim()}>{busy ? "Saving…" : "Save store"}</Primary></div>
    </form>
  </Modal>;
}
function StoreUpload({ onClose, onDone }) {
  const [file, setFile] = useState(null); const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  async function run(apply) {
    if (!file) { setErr("Pick the spreadsheet first."); return; }
    setBusy(apply ? "apply" : "preview"); setErr("");
    const fd = new FormData(); fd.append("file", file); if (!apply) fd.append("preview", "1");
    try { const r = await api.upload("/api/stores/upload", fd); if (r.error) setErr(r.error + (r.sheets ? " (tabs: " + r.sheets.join(", ") + ")" : "")); else if (apply) { onDone(r); return; } else setPreview(r); }
    catch (e) { setErr("Couldn't reach the server."); }
    setBusy("");
  }
  return <Modal title="Upload a store list" onClose={onClose} width={720}>
    <div style={{ fontSize: 13.5, color: TB.slate, marginBottom: 12, lineHeight: 1.55 }}>Any .xlsx or .csv with a <b>Name</b> (or Store / Account) column. <b>Store #</b>, <b>City</b>, <b>Chain</b> and <b>Team</b> are read when they are there; the header can be on any row. A store already here (same number) is updated, never duplicated.</div>
    <Field ui={ui} label="Spreadsheet"><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setFile(e.target.files && e.target.files[0]); setPreview(null); }} style={{ fontSize: 13 }} /></Field>
    {err && <Notice kind="bad" style={{ marginBottom: 10 }}>{err}</Notice>}
    {preview && <div style={{ marginBottom: 12 }}>
      <Notice kind="ok" style={{ marginBottom: 8 }}>Tab “{preview.sheet}”, header on row {preview.headerRow}. Columns read: {preview.columns.join(", ")}. <b>{preview.count}</b> store{preview.count === 1 ? "" : "s"}.</Notice>
      <Table cols={["Name", "#", "City", "Chain", "Team"]} rows={preview.sample.map((r, i) => <tr key={i}><td style={td}>{r.name}</td><td style={td}>{r.storeNo || "—"}</td><td style={td}>{r.city}</td><td style={td}>{r.chain}</td><td style={td}>{r.team}</td></tr>)} />
      {preview.count > preview.sample.length && <div style={{ fontSize: 12, color: C.mute, marginTop: 4 }}>First {preview.sample.length} shown.</div>}
    </div>}
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <Ghost small onClick={onClose}>Cancel</Ghost>
      {!preview && <Primary small disabled={!!busy || !file} onClick={() => run(false)}>{busy === "preview" ? "Reading…" : "Preview"}</Primary>}
      {preview && <Primary small disabled={!!busy} onClick={() => run(true)}>{busy === "apply" ? "Loading…" : "Load " + preview.count + " store" + (preview.count === 1 ? "" : "s")}</Primary>}
    </div>
  </Modal>;
}

/* ================================================================
   CATALOG -- the org's item list
   ================================================================ */
export function CatalogScreen({ canAdmin }) {
  const [data, setData] = useState(null); const [q, setQ] = useState(""); const [upload, setUpload] = useState(false); const [msg, setMsg] = useState("");
  const timer = useRef(null);
  function load(query) { api.get("/api/catalog?limit=200&q=" + encodeURIComponent(query || "")).then(setData).catch(() => setData({ error: "Couldn't load the item list." })); }
  useEffect(() => { load(""); }, []);
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => load(q), 200); return () => clearTimeout(timer.current); }, [q]);
  const items = (data && data.items) || [];
  return <div className="tu-fade">
    <PageTitle title="Catalog" sub="Your item list. The rep's item picker searches it, a price book import matches against it, and Brand logos reads the brands off it." right={canAdmin && <Primary small onClick={() => setUpload(true)}><L.Upload size={15} /> Upload item list</Primary>} />
    {msg && <Notice kind="ok" style={{ marginBottom: 12 }}>{msg}</Notice>}
    {data && data.error && <Notice kind="bad" style={{ marginBottom: 12 }}>{data.error}</Notice>}
    {data && !data.total && !data.error && <div style={{ background: "#fff", border: `2px dashed ${TB.kraft}`, borderRadius: 16, padding: 28, textAlign: "center", marginBottom: 14 }}>
      <L.Package size={36} color={TB.kraft} /><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17, color: TB.ink, marginTop: 8 }}>No items yet</div>
      <div style={{ fontSize: 13.5, color: TB.slate, marginTop: 4, maxWidth: 440, margin: "4px auto 0" }}>Reps can still type an item by hand. Upload your price file -- Item #, Name, Brand, Package -- and the picker fills in the name, size and brand for them.</div>
      {canAdmin && <div style={{ marginTop: 14 }}><Primary small onClick={() => setUpload(true)}><L.Upload size={15} /> Upload item list</Primary></div>}
    </div>}
    {data && data.total > 0 && <>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 360 }}><span style={{ position: "absolute", left: 11, top: 11 }}><L.Search size={16} color={C.mute} /></span><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search items" style={{ paddingLeft: 34 }} /></div>
        <span style={{ fontSize: 12.5, color: TB.slate }}>{data.total} item{data.total === 1 ? "" : "s"}</span>
      </div>
      <Table cols={["Item #", "Name", "Brand", "Package"]} rows={items.map((it) => <tr key={it.id}><td style={Object.assign({ color: C.mute }, td)}>{it.itemNo || "—"}</td><td style={td}><b>{it.name}</b></td><td style={td}>{it.brand}</td><td style={td}>{it.pack}</td></tr>)} empty="No item matches." />
    </>}
    {upload && <CatalogUpload onClose={() => setUpload(false)} onDone={(r) => { setUpload(false); setMsg("Loaded " + r.created + " new item" + (r.created === 1 ? "" : "s") + ", updated " + r.updated + "."); load(q); }} />}
  </div>;
}
function CatalogUpload({ onClose, onDone }) {
  const [file, setFile] = useState(null); const [preview, setPreview] = useState(null); const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  async function run(apply) {
    if (!file) { setErr("Pick the spreadsheet first."); return; }
    setBusy(apply ? "apply" : "preview"); setErr("");
    const fd = new FormData(); fd.append("file", file); if (!apply) fd.append("preview", "1");
    try { const r = await api.upload("/api/catalog/import", fd); if (r.error) setErr(r.error + (r.sheets ? " (tabs: " + r.sheets.join(", ") + ")" : "")); else if (apply) { onDone(r); return; } else setPreview(r); }
    catch (e) { setErr("Couldn't reach the server."); }
    setBusy("");
  }
  return <Modal title="Upload your item list" onClose={onClose} width={720}>
    <div style={{ fontSize: 13.5, color: TB.slate, marginBottom: 12, lineHeight: 1.55 }}>An .xlsx or .csv with a <b>Name</b> (or Description) column plus any of <b>Item #</b>, <b>Brand</b>, <b>Package</b>. Header on any row. Re-uploading updates items by number; nothing is deleted.</div>
    <Field ui={ui} label="Spreadsheet"><input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { setFile(e.target.files && e.target.files[0]); setPreview(null); }} style={{ fontSize: 13 }} /></Field>
    {err && <Notice kind="bad" style={{ marginBottom: 10 }}>{err}</Notice>}
    {preview && <div style={{ marginBottom: 12 }}>
      <Notice kind="ok" style={{ marginBottom: 8 }}>Tab “{preview.sheet}”, header on row {preview.headerRow}. Columns read: {preview.columns.join(", ")}. <b>{preview.count}</b> item{preview.count === 1 ? "" : "s"}.</Notice>
      <Table cols={["Item #", "Name", "Brand", "Package"]} rows={preview.sample.map((r, i) => <tr key={i}><td style={td}>{r.itemNo || "—"}</td><td style={td}>{r.name}</td><td style={td}>{r.brand}</td><td style={td}>{r.pack}</td></tr>)} />
    </div>}
    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
      <Ghost small onClick={onClose}>Cancel</Ghost>
      {!preview && <Primary small disabled={!!busy || !file} onClick={() => run(false)}>{busy === "preview" ? "Reading…" : "Preview"}</Primary>}
      {preview && <Primary small disabled={!!busy} onClick={() => run(true)}>{busy === "apply" ? "Loading…" : "Load " + preview.count + " item" + (preview.count === 1 ? "" : "s")}</Primary>}
    </div>
  </Modal>;
}

/* ================================================================
   TEAM
   ================================================================ */
export function TeamScreen({ me, role }) {
  const [data, setData] = useState(null); const [teams, setTeams] = useState([]); const [inv, setInv] = useState(false); const [msg, setMsg] = useState(""); const [teamName, setTeamName] = useState("");
  const canAdmin = role === "owner" || role === "admin";
  function load() { api.get("/api/orgs/" + session.org + "/members").then(setData).catch(() => setData({ error: "Couldn't load the team." })); api.get("/api/orgs/" + session.org + "/teams").then((r) => setTeams((r && r.teams) || [])).catch(() => {}); }
  useEffect(load, []);
  const members = (data && data.members) || [], invites = (data && data.invites) || [];
  const teamNameOf = (id) => (teams.find((t) => t.id === id) || {}).name || "";
  async function setRole(m, r) { const x = await api.post("/api/orgs/" + session.org + "/members/" + m.id, { role: r }); if (x.error) window.alert(x.error); else load(); }
  async function setTeam(m, teamId) { const x = await api.post("/api/orgs/" + session.org + "/members/" + m.id, { teamId }); if (x.error) window.alert(x.error); else load(); }
  async function remove(m) { if (!window.confirm("Remove " + m.name + " from " + "this workspace? Their requests stay on record.")) return; const x = await api.post("/api/orgs/" + session.org + "/members/" + m.id, { remove: true }); if (x.error) window.alert(x.error); else load(); }
  async function revoke(i) { const x = await api.post("/api/orgs/" + session.org + "/invites/" + i.id + "/revoke"); if (x.error) window.alert(x.error); else load(); }
  async function addTeam(e) { e.preventDefault(); if (!teamName.trim()) return; const x = await api.post("/api/orgs/" + session.org + "/teams", { name: teamName }); if (x.error) window.alert(x.error); else { setTeamName(""); load(); } }
  const sel = (v, opts, onPick, dis) => <select value={v || ""} disabled={dis} onChange={(e) => onPick(e.target.value)} style={{ padding: "6px 8px", borderRadius: 8, border: `1.5px solid ${C.line}`, background: "#fff", fontSize: 13, fontFamily: BODY }}>{opts.map((o) => <option key={o[0]} value={o[0]}>{o[1]}</option>)}</select>;
  return <div className="tu-fade">
    <PageTitle title="Team" sub="Reps ask for tags for their stores and see their own requests. Managers work their team's queue and print. Admins set everything up." right={canAdmin && <Primary small onClick={() => setInv(true)}><L.Mail size={15} /> Invite someone</Primary>} />
    {msg && <Notice kind="ok" style={{ marginBottom: 12 }}>{msg}</Notice>}
    {data && data.error && <Notice kind="bad" style={{ marginBottom: 12 }}>{data.error}</Notice>}
    <Table cols={["Name", "Email", "Role", "Team", "Last seen", canAdmin ? "" : null].filter((x) => x != null)} rows={members.map((m) => <tr key={m.id}>
      <td style={td}><b>{m.name}</b>{m.id === me.id && <span style={{ color: C.mute, fontSize: 12 }}> (you)</span>}</td><td style={Object.assign({ color: TB.slate }, td)}>{m.email}</td>
      <td style={td}>{canAdmin && m.role !== "owner" ? sel(m.role, [["admin", "Admin"], ["manager", "Manager"], ["rep", "Rep"]].concat(role === "owner" ? [["owner", "Owner (transfer)"]] : []), (v) => setRole(m, v)) : <Chip ui={ui} small bg={m.role === "owner" ? TB.signalSoft : C.lineCool}>{roleLabel(m.role)}</Chip>}</td>
      <td style={td}>{canAdmin ? sel(m.teamId, [["", "—"]].concat(teams.map((t) => [t.id, t.name])), (v) => setTeam(m, v)) : (teamNameOf(m.teamId) || "—")}</td>
      <td style={Object.assign({ color: C.mute, fontSize: 12.5 }, td)}>{m.lastLoginAt ? ago(m.lastLoginAt) : "never"}</td>
      {canAdmin && <td style={Object.assign({ textAlign: "right" }, td)}>{m.role !== "owner" && m.id !== me.id && <button onClick={() => remove(m)} style={iconBtn} title="Remove"><L.Trash2 size={15} /></button>}</td>}
    </tr>)} />
    {invites.length > 0 && <div style={{ marginTop: 18 }}>
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 13, letterSpacing: 0.5, textTransform: "uppercase", color: TB.slate, marginBottom: 8 }}>Invited, not yet joined</div>
      <Table cols={["Email", "Role", "Sent", ""]} rows={invites.map((i) => <tr key={i.id}><td style={td}>{i.email}</td><td style={td}>{roleLabel(i.role)}</td><td style={Object.assign({ color: C.mute }, td)}>{ago(i.createdAt)}</td><td style={Object.assign({ textAlign: "right" }, td)}>{canAdmin && <button onClick={() => revoke(i)} style={{ background: "none", border: "none", color: TB.pull, fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>Revoke</button>}</td></tr>)} />
    </div>}
    {canAdmin && <div style={{ marginTop: 22, background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
      <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: TB.ink }}>Teams <span style={{ fontWeight: 500, color: TB.slate, fontSize: 13 }}>· optional</span></div>
      <div style={{ fontSize: 13, color: TB.slate, marginTop: 3, marginBottom: 10, lineHeight: 1.5 }}>Put stores and people on a team and a manager sees only that team's requests. One team is fine to start -- or none.</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>{teams.map((t) => <Chip key={t.id} ui={ui} bg={C.lineCool}>{t.name}</Chip>)}{!teams.length && <span style={{ fontSize: 12.5, color: C.mute }}>No teams yet.</span>}</div>
      <form onSubmit={addTeam} style={{ display: "flex", gap: 8, maxWidth: 420 }}><Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="North route" /><Ghost small type="submit" disabled={!teamName.trim()}>Add team</Ghost></form>
    </div>}
    {inv && <InviteForm teams={teams} onClose={() => setInv(false)} onSent={(email) => { setInv(false); setMsg("Invite sent to " + email + ". They get a link that sets their password and lands them here."); load(); }} />}
  </div>;
}
function InviteForm({ teams, onClose, onSent }) {
  const [f, setF] = useState({ email: "", role: "rep", teamId: "" }); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const set = (p) => setF((v) => Object.assign({}, v, p));
  async function send(e) { e.preventDefault(); setBusy(true); setErr(""); const r = await api.post("/api/orgs/" + session.org + "/invite", f); setBusy(false); if (r.error) setErr(r.error); else onSent(f.email); }
  const Opt = ({ id, label, sub }) => <button type="button" onClick={() => set({ role: id })} style={{ textAlign: "left", padding: "10px 12px", borderRadius: 12, border: `2px solid ${f.role === id ? TB.signal : C.line}`, background: f.role === id ? TB.signalSoft : "#fff", cursor: "pointer" }}><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 14, color: TB.ink }}>{label}</div><div style={{ fontSize: 12, color: TB.slate }}>{sub}</div></button>;
  return <Modal title="Invite someone" onClose={onClose} width={520}>
    <form onSubmit={send}>
      <Field ui={ui} label="Email"><Input autoFocus type="email" value={f.email} onChange={(e) => set({ email: e.target.value })} placeholder="rep@yourcompany.com" /></Field>
      <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
        <Opt id="rep" label="Rep" sub="Asks for tags for their stores. Sees their own requests and when they printed." />
        <Opt id="manager" label="Manager" sub="Works the queue and prints batches for their team. Read-only on styles." />
        <Opt id="admin" label="Admin" sub="Everything: styles, materials, stores, the item list, the team." />
      </div>
      {teams.length > 0 && <Field ui={ui} label="Team"><select value={f.teamId} onChange={(e) => set({ teamId: e.target.value })} style={inputStyle(ui)}><option value="">— none —</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {err && <Notice kind="bad" style={{ marginBottom: 10 }}>{err}</Notice>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><Ghost small onClick={onClose}>Cancel</Ghost><Primary small type="submit" disabled={busy || !f.email}>{busy ? "Sending…" : "Send invite"}</Primary></div>
    </form>
  </Modal>;
}

/* ================================================================
   SETTINGS
   ================================================================ */
export function SettingsScreen({ me, org, role, onOrgChanged, onSignOut }) {
  const [name, setName] = useState(org.name); const [msg, setMsg] = useState(""); const [err, setErr] = useState("");
  const canAdmin = role === "owner" || role === "admin";
  async function save(e) { e.preventDefault(); const r = await api.put("/api/orgs/" + org.id, { name }); if (r.error) setErr(r.error); else { setMsg("Saved."); onOrgChanged(r.org); } }
  const trialLeft = org.trial_ends_at ? Math.ceil((new Date(org.trial_ends_at).getTime() - Date.now()) / 86400000) : null;
  return <div className="tu-fade">
    <PageTitle title="Settings" />
    <div style={{ display: "grid", gap: 16, maxWidth: 640 }}>
      <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: TB.ink, marginBottom: 10 }}>Workspace</div>
        <form onSubmit={save}><Field ui={ui} label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} disabled={!canAdmin} /></Field>
          {canAdmin && <Primary small type="submit" disabled={!name.trim() || name === org.name}>Save</Primary>}{msg && <span style={{ marginLeft: 10, color: TB.posted, fontWeight: 600, fontSize: 13 }}>{msg}</span>}{err && <Notice kind="bad" style={{ marginTop: 8 }}>{err}</Notice>}</form>
      </div>
      <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: TB.ink, marginBottom: 6 }}>Plan</div>
        {org.plan === "trial" ? <div style={{ fontSize: 13.5, color: TB.slate, lineHeight: 1.55 }}><b style={{ color: TB.ink }}>Free trial</b>{trialLeft != null && (trialLeft > 0 ? <> · {trialLeft} day{trialLeft === 1 ? "" : "s"} left</> : <> · <span style={{ color: TB.pull, fontWeight: 700 }}>ended</span></>)}. Every feature is on. When the trial ends, what you made stays readable and printable; new requests, imports and edits wait for an upgrade.<div style={{ marginTop: 10 }}><a href="mailto:hello@tagup.app?subject=tagup%20upgrade" style={{ textDecoration: "none" }}><Primary small>Talk to us about a plan</Primary></a></div></div>
          : <div style={{ fontSize: 13.5, color: TB.slate }}>Plan: <b style={{ color: TB.ink }}>{org.plan}</b></div>}
      </div>
      <div style={{ background: "#fff", border: `1.5px solid ${C.line}`, borderRadius: 14, padding: 16 }}>
        <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, color: TB.ink, marginBottom: 6 }}>You</div>
        <div style={{ fontSize: 13.5, color: TB.slate, lineHeight: 1.6 }}>{me.name} · {me.email} · {roleLabel(role)}{me.email_verified === false && <span style={{ color: "#8A3A08" }}> · email not verified yet -- check your inbox</span>}</div>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}><Ghost small onClick={() => nav("/forgot")}>Change password</Ghost><Ghost small onClick={onSignOut}><L.LogOut size={14} /> Sign out</Ghost></div>
      </div>
    </div>
  </div>;
}

/* ================================================================
   HELP -- tutorials
   ================================================================ */
export function HelpScreen({ role }) {
  const [open, setOpen] = useState(() => (window.location.hash || "").slice(1) || null);
  useEffect(() => { if (open) { const el = document.getElementById("tut-" + open); if (el) el.scrollIntoView({ block: "start", behavior: "smooth" }); } }, []);
  const list = TUTORIALS.filter((t) => t.for === "everyone" || role !== "rep");
  return <div className="tu-fade">
    <PageTitle title="Learn tagup" sub="Short lessons, in the order a new workspace does them. Each is a few minutes; the video, when there is one, plays right here." />
    <div style={{ display: "grid", gap: 12 }}>
      {list.map((t, i) => <div key={t.id} id={"tut-" + t.id} style={{ background: "#fff", border: `1.5px solid ${open === t.id ? TB.signal : C.line}`, borderRadius: 16, overflow: "hidden" }}>
        <button onClick={() => setOpen(open === t.id ? null : t.id)} style={{ width: "100%", textAlign: "left", display: "flex", gap: 14, alignItems: "center", padding: 16, background: "none", border: "none", cursor: "pointer" }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: TB.signalSoft, display: "grid", placeItems: "center", flexShrink: 0, fontFamily: DISP, fontSize: 18, color: TB.ink }}>{i + 1}</div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 16, color: TB.ink }}>{t.title}</div><div style={{ fontSize: 13, color: TB.slate, marginTop: 2 }}>{t.blurb}</div></div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}><Chip ui={ui} small bg={C.lineCool}>{t.minutes} min</Chip>{t.video ? <L.PlayCircle size={20} color={TB.signal} /> : null}<L.ChevronDown size={18} color={C.mute} style={{ transform: open === t.id ? "rotate(180deg)" : "none", transition: "transform .2s" }} /></div>
        </button>
        {open === t.id && <div className="tu-fade" style={{ padding: "0 16px 16px", display: "grid", gridTemplateColumns: t.video ? "minmax(0, 1.2fr) minmax(0, 1fr)" : "1fr", gap: 16 }}>
          {t.video && <div style={{ background: TB.ink, borderRadius: 12, aspectRatio: "16 / 9", overflow: "hidden" }}>{/\.(mp4|webm|mov)(\?|$)/i.test(t.video) ? <video src={t.video} controls style={{ width: "100%", height: "100%" }} /> : <iframe src={t.video} title={t.title} allow="autoplay; fullscreen" allowFullScreen style={{ width: "100%", height: "100%", border: "none" }} />}</div>}
          <div>
            {!t.video && <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: TB.slate, background: TB.paper, borderRadius: 99, padding: "4px 10px", marginBottom: 10 }}><L.PlayCircle size={14} /> Video coming -- the steps are below.</div>}
            <ol style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: TB.ink, lineHeight: 1.7 }}>{t.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
          </div>
        </div>}
      </div>)}
    </div>
    <div style={{ marginTop: 20, fontSize: 13, color: TB.slate }}>Stuck? <a href="mailto:hello@tagup.app" style={{ color: TB.ink, fontWeight: 700 }}>hello@tagup.app</a> -- a person answers.</div>
  </div>;
}

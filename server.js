import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

// SQLite
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.status(200).send("ok"));

/* ================================
   DATABASE (SQLite on Render disk)
   ================================ */

const DB_PATH = process.env.DB_PATH || "/var/data/maledane.db";
let db;

async function initDb() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA foreign_keys = ON;");

  await db.exec(`
    CREATE TABLE IF NOT EXISTS kontakt_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      topic TEXT,
      message TEXT NOT NULL,
      payload_json TEXT
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS poptavky (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      full_name TEXT NOT NULL,
      company TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      vat TEXT,
      message TEXT NOT NULL,
      payload_json TEXT
    );
  `);

  // Status columns (new / in_progress / done)
  async function ensureColumn(table, column, ddl) {
    const cols = await db.all(`PRAGMA table_info(${table});`);
    const exists = cols.some((c) => c.name === column);
    if (!exists) {
      await db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`);
    }
  }
  await ensureColumn("kontakt_messages", "status", `status TEXT NOT NULL DEFAULT 'new'`);
  await ensureColumn("poptavky", "status", `status TEXT NOT NULL DEFAULT 'new'`);

  console.log(`✅ SQLite ready at ${DB_PATH}`);
}

function requireDb(req, res) {
  if (!db) {
    res.status(503).json({ error: "DB not ready yet" });
    return false;
  }
  return true;
}

/* ================================
   BASIC AUTH (Admin)
   ================================ */

function parseBasicAuth(header) {
  if (!header || !header.startsWith("Basic ")) return null;
  const b64 = header.slice(6);
  let decoded = "";
  try {
    decoded = Buffer.from(b64, "base64").toString("utf8");
  } catch {
    return null;
  }
  const idx = decoded.indexOf(":");
  if (idx < 0) return null;
  return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
}

function requireAdmin(req, res, next) {
  const ADMIN_USER = process.env.ADMIN_USER || "";
  const ADMIN_PASS = process.env.ADMIN_PASS || "";

  if (!ADMIN_USER || !ADMIN_PASS) {
    return res.status(403).send("Admin is not configured.");
  }

  const creds = parseBasicAuth(req.headers.authorization);
  if (!creds || creds.user !== ADMIN_USER || creds.pass !== ADMIN_PASS) {
    res.setHeader("WWW-Authenticate", 'Basic realm="Admin"');
    return res.status(401).send("Authentication required.");
  }
  next();
}

/* ================================
   FORMS: SAVE TO DATABASE
   ================================ */

app.post("/api/forms/kontakt", async (req, res) => {
  try {
    if (!requireDb(req, res)) return;

    const body = req.body || {};
    const name = (body.name || "").toString().trim();
    const email = (body.email || "").toString().trim();
    const phone = (body.phone || "").toString().trim();
    const topic = (body.topic || "").toString().trim();
    const message = (body.message || "").toString().trim();

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const payload_json = JSON.stringify(body);

    const result = await db.run(
      `
      INSERT INTO kontakt_messages (name, email, phone, topic, message, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
      [name, email, phone || null, topic || null, message, payload_json]
    );

    res.json({ success: true, id: result.lastID });
  } catch (err) {
    console.error("Kontakt save error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/forms/poptavka", async (req, res) => {
  try {
    if (!requireDb(req, res)) return;

    const body = req.body || {};
    const fullName = (body.fullName || "").toString().trim();
    const company = (body.company || "").toString().trim();
    const email = (body.email || "").toString().trim();
    const phone = (body.phone || "").toString().trim();
    const vat = (body.vat || "").toString().trim();
    const message = (body.message || "").toString().trim();

    if (!fullName || !company || !email || !phone || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const payload_json = JSON.stringify(body);

    const result = await db.run(
      `
      INSERT INTO poptavky (full_name, company, email, phone, vat, message, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [fullName, company, email, phone, vat || null, message, payload_json]
    );

    res.json({ success: true, id: result.lastID });
  } catch (err) {
    console.error("Poptavka save error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   ADMIN: VIEW + STATUS + DELETE
   ================================ */

app.get("/admin", requireAdmin, (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Admin | Malé Daně</title>
  <style>
    body{font-family: system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial; margin:20px; color:#0f172a;}
    h1{margin:0 0 14px;}
    .row{display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px;}
    button{border:1px solid #cbd5e1; background:#fff; padding:8px 10px; border-radius:10px; cursor:pointer;}
    button:hover{background:#f8fafc;}
    select{border:1px solid #cbd5e1; background:#fff; padding:8px 10px; border-radius:10px;}
    table{width:100%; border-collapse:collapse; margin-top:10px;}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px 8px; text-align:left; vertical-align:top; font-size:14px;}
    th{font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:#475569;}
    .muted{color:#64748b; font-size:12px;}
    .danger{border-color:#fecaca;}
    .danger:hover{background:#fff1f2;}
    .btn{border:1px solid #cbd5e1; background:#fff; padding:7px 10px; border-radius:10px; cursor:pointer; font-size:13px;}
    .btn:hover{background:#f8fafc;}
    .btn.small{padding:6px 9px; border-radius:10px; font-size:12px;}
    .btn.primary{border-color:#86efac;}
    .btn.primary:hover{background:#ecfdf5;}
    .btn.blue{border-color:#bae6fd;}
    .btn.blue:hover{background:#eff6ff;}
    .badge{display:inline-block; padding:3px 8px; border-radius:999px; font-size:12px; border:1px solid #e2e8f0; background:#f8fafc; color:#0f172a;}
    .badge.new{border-color:#86efac; background:#ecfdf5;}
    .badge.in_progress{border-color:#93c5fd; background:#eff6ff;}
    .badge.done{border-color:#e2e8f0; background:#f1f5f9; color:#475569;}
    .actions{display:flex; gap:8px; flex-wrap:wrap;}
    pre{white-space:pre-wrap; word-break:break-word; margin:0;}
    summary{cursor:pointer;}
    a{color:inherit;}
    .pill{display:inline-block; padding:5px 10px; border-radius:999px; border:1px solid #e2e8f0; background:#f8fafc; font-size:12px; color:#334155;}

    /* Tabs */
    .tabs{display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin:8px 0 16px;}
    .tab{
      padding:10px 12px;
      border-radius:999px;
      border:1px solid #cbd5e1;
      background:#fff;
      cursor:pointer;
      display:flex; gap:8px; align-items:center;
      font-size:14px;
    }
    .tab:hover{background:#f8fafc;}
    .tab.active{
      border-color:#86efac;
      background:#ecfdf5;
    }
    .tab .count{
      font-size:12px;
      padding:3px 8px;
      border-radius:999px;
      border:1px solid #e2e8f0;
      background:#fff;
      color:#334155;
    }
    .panel{display:none;}
    .panel.active{display:block;}

    .panel-head{
      display:flex;
      align-items:center;
      justify-content:flex-start;
      gap:12px;
      flex-wrap:wrap;
      margin-bottom:8px;
    }
    .panel-head h2{margin:0;}
    .panel-controls{display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-left:12px;}
  
    .kv{
      display:grid;
      grid-template-columns: 92px 1fr; /* label width */
      gap:6px 10px;                    /* row gap, column gap */
      align-items:start;
    }
    .kv .k{
      color:#64748b;                   /* muted label */
      font-size:12px;
      text-transform:none;
      white-space:nowrap;
    }
    .kv .v{
      color:#0f172a;
      font-size:13px;
      word-break:break-word;
    }
    .kv .v b{
      font-weight:700;
    }
    

    /* --- Responsive admin table --- */
    .table-wrap{
      width:100%;
      overflow-x:auto;
      -webkit-overflow-scrolling: touch;
      border-radius:12px;
    }
    table{ min-width: 980px; } /* prevents columns from collapsing too much */

    .nowrap{
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      display:block;
      max-width: 260px;
    }

    .msg-preview{
      max-width: 320px;
      white-space:nowrap;
      overflow:hidden;
      text-overflow:ellipsis;
      display:block;
    }

    /* Mobile tweaks */
    @media (max-width: 720px){
      body{ margin:14px; }
      th,td{ padding:8px 6px; }
      .tab{ padding:8px 10px; }
      .panel-head{ gap:10px; }
      .panel-controls{ margin-left:0; }
      .kv{ grid-template-columns: 72px 1fr; }
    }

  </style>
</head>
<body>
  <h1>Admin</h1>
  <div class="row">
    <button id="refresh">Obnovit</button>
    <button id="showAll" class="btn">Zobrazit vše</button>
    <span class="muted">Tip: /admin je chráněný Basic Auth (ADMIN_USER / ADMIN_PASS)</span>
  </div>

  <div class="tabs" role="tablist" aria-label="Admin sekce">
    <button class="tab active" id="tab-kontakt" data-tab="kontakt" role="tab" aria-selected="true">
      Kontakt <span class="count" id="tabCountKontakt">—</span>
    </button>
    <button class="tab" id="tab-poptavka" data-tab="poptavka" role="tab" aria-selected="false">
      Poptávky <span class="count" id="tabCountPopt">—</span>
    </button>
  </div>

  <section class="panel active" id="panel-kontakt" role="tabpanel" aria-labelledby="tab-kontakt">
    <div class="panel-head">
      <h2>Kontakt</h2>
      <div class="panel-controls">
        <span class="pill" id="kontaktCounts">—</span>
        <label class="muted">Filtr:</label>
        <select id="kontaktFilter">
          <option value="new" selected>Nové</option>
          <option value="in_progress">Rozpracované</option>
          <option value="done">Vyřízené</option>
          <option value="all">Vše</option>
        </select>
      </div>
    </div>
    <div id="kontakt"></div>
  </section>

  <section class="panel" id="panel-poptavka" role="tabpanel" aria-labelledby="tab-poptavka">
    <div class="panel-head">
      <h2>Poptávky</h2>
      <div class="panel-controls">
        <span class="pill" id="poptCounts">—</span>
        <label class="muted">Filtr:</label>
        <select id="poptFilter">
          <option value="new" selected>Nové</option>
          <option value="in_progress">Rozpracované</option>
          <option value="done">Vyřízené</option>
          <option value="all">Vše</option>
        </select>
      </div>
    </div>
    <div id="poptavka"></div>
  </section>

<script>
async function fetchJson(url, opts){
  const r = await fetch(url, opts);
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function statusMeta(s){
  const v = (s || "new");
  if(v === "done") return { cls: "done", label: "Vyřízené" };
  if(v === "in_progress") return { cls: "in_progress", label: "Rozpracované" };
  return { cls: "new", label: "Nové" };
}

function previewText(txt, n=110){
  const t = (txt || "").toString().replace(/\\s+/g, " ").trim();
  if(t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}

function countStatuses(rows){
  const c = { all: rows.length, new: 0, in_progress: 0, done: 0 };
  for(const r of rows){
    const s = (r.status || "new");
    if(s === "done") c.done++;
    else if(s === "in_progress") c.in_progress++;
    else c.new++;
  }
  return c;
}

function applyFilter(rows, filter){
  if(filter === "all") return rows;
  return rows.filter(r => (r.status || "new") === filter);
}

function formatDateTimeCZ(value){
  if(!value) return "";
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return String(value);

  const pad = (n) => String(n).padStart(2, "0");
  const dd = pad(d.getDate());
  const mm = pad(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());

  return dd + "/" + mm + "/" + yyyy + " " + hh + ":" + mi;
}

function renderTable(el, rows, type, filter){
  const filtered = applyFilter(rows, filter);

  if(!filtered.length){
    el.innerHTML = '<p class="muted">Žádná data pro zvolený filtr.</p>';
    return;
  }

  el.innerHTML = \`
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Datum</th>
          <th>Status</th>
          <th>Kontakt</th>
          <th>Zpráva</th>
          <th>Akce</th>
        </tr>
      </thead>
      <tbody>
        \${filtered.map(r => {
          const s = statusMeta(r.status);
          const msg = (r.message || "");
          return \`
          <tr>
            <td>\${r.id}</td>
            <td><span class="muted">\${escapeHtml(formatDateTimeCZ(r.created_at))}</span></td>
            <td><span class="badge \${s.cls}">\${s.label}</span></td>
            <td>
              <div class="kv">
                <div class="k">Jméno</div>
                <div class="v"><b>\${escapeHtml(r.name || r.full_name || "")}</b></div>

                <div class="k">E-mail</div>
                <div class="v">
                  <a class="nowrap" href="mailto:\${escapeHtml(r.email || "")}">\${escapeHtml(r.email || "")}</a>
                </div>

                <div class="k">Telefon</div>
                <div class="v">
                  \${r.phone
                    ? \`<a class="nowrap" href="tel:\${escapeHtml(r.phone)}">\${escapeHtml(r.phone)}</a>\`
                    : "—"
                  }
                </div>

                \${r.company ? \`
                  <div class="k">Firma</div>
                  <div class="v">\${escapeHtml(r.company)}</div>
                \` : ""}

                \${r.topic ? \`
                  <div class="k">Téma</div>
                  <div class="v">\${escapeHtml(r.topic)}</div>
                \` : ""}

                \${r.vat ? \`
                  <div class="k">DPH</div>
                  <div class="v">\${escapeHtml(r.vat)}</div>
                \` : ""}
              </div>
            </td>
            <td>
              <details>
                <summary class="muted"><span class="msg-preview">\${escapeHtml(previewText(msg))}</span></summary>
                <pre>\${escapeHtml(msg)}</pre>
              </details>
            </td>
            <td>
              <div class="actions">
                \${r.status !== "done" ? \`<button class="btn small primary" data-status="done" data-id="\${r.id}" data-type="\${type}">Vyřídit</button>\` : \`\`}
                \${r.status !== "in_progress" ? \`<button class="btn small blue" data-status="in_progress" data-id="\${r.id}" data-type="\${type}">Rozpracovat</button>\` : \`\`}
                \${r.status !== "new" ? \`<button class="btn small" data-status="new" data-id="\${r.id}" data-type="\${type}">Zpět na Nové</button>\` : \`\`}
                <button class="btn small danger" data-del="\${r.id}" data-type="\${type}">Smazat</button>
              </div>
            </td>
          </tr>
          \`;
        }).join("")}
      </tbody>
    </table>
  \`;

  el.querySelectorAll("button[data-del]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-del");
      const t = btn.getAttribute("data-type");
      if(!confirm("Opravdu smazat ID " + id + "?")) return;
      await fetchJson("/api/admin/" + t + "/" + id, { method: "DELETE" });
      await loadAll();
    });
  });

  el.querySelectorAll("button[data-status]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-id");
      const t = btn.getAttribute("data-type");
      const status = btn.getAttribute("data-status");
      await fetchJson(\`/api/admin/\${t}/\${id}/status\`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      await loadAll();
    });
  });
}

/* Tabs */
const LS_TAB_KEY = "md_admin_active_tab";
function setActiveTab(tab){
  document.querySelectorAll(".tab").forEach(b => {
    const isActive = b.dataset.tab === tab;
    b.classList.toggle("active", isActive);
    b.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll(".panel").forEach(p => {
    p.classList.toggle("active", p.id === "panel-" + tab);
  });
  localStorage.setItem(LS_TAB_KEY, tab);
}
document.querySelectorAll(".tab").forEach(b => {
  b.addEventListener("click", () => setActiveTab(b.dataset.tab));
});
setActiveTab(localStorage.getItem(LS_TAB_KEY) || "kontakt");

let cacheKontakt = [];
let cachePopt = [];

function updateHeadings(){
  const kc = countStatuses(cacheKontakt);
  const pc = countStatuses(cachePopt);

  document.getElementById("kontaktCounts").textContent =
    \`Nové: \${kc.new} / Rozprac: \${kc.in_progress} / Vyříz: \${kc.done} / Vše: \${kc.all}\`;

  document.getElementById("poptCounts").textContent =
    \`Nové: \${pc.new} / Rozprac: \${pc.in_progress} / Vyříz: \${pc.done} / Vše: \${pc.all}\`;

  // Tab count badges show "new / all"
  document.getElementById("tabCountKontakt").textContent = \`\${kc.new} / \${kc.all}\`;
  document.getElementById("tabCountPopt").textContent = \`\${pc.new} / \${pc.all}\`;
}

function rerender(){
  const kontaktEl = document.getElementById("kontakt");
  const poptEl = document.getElementById("poptavka");
  const kf = document.getElementById("kontaktFilter").value;
  const pf = document.getElementById("poptFilter").value;

  renderTable(kontaktEl, cacheKontakt, "kontakt", kf);
  renderTable(poptEl, cachePopt, "poptavka", pf);
}

async function loadAll(){
  const kontaktEl = document.getElementById("kontakt");
  const poptEl = document.getElementById("poptavka");

  kontaktEl.innerHTML = '<p class="muted">Načítám…</p>';
  poptEl.innerHTML = '<p class="muted">Načítám…</p>';

  const kontakt = await fetchJson("/api/admin/kontakt");
  const poptavky = await fetchJson("/api/admin/poptavka");

  cacheKontakt = kontakt.rows || [];
  cachePopt = poptavky.rows || [];

  updateHeadings();
  rerender();
}

document.getElementById("refresh").addEventListener("click", loadAll);

document.getElementById("kontaktFilter").addEventListener("change", rerender);
document.getElementById("poptFilter").addEventListener("change", rerender);

// Show All affects BOTH filters (so switching tabs shows all too)
document.getElementById("showAll").addEventListener("click", () => {
  document.getElementById("kontaktFilter").value = "all";
  document.getElementById("poptFilter").value = "all";
  rerender();
});

loadAll();
</script>
</body>
</html>
  `);
});

app.get("/api/admin/kontakt", requireAdmin, async (req, res) => {
  try {
    if (!requireDb(req, res)) return;
    const rows = await db.all(
      `SELECT id, created_at, status, name, email, phone, topic, message
       FROM kontakt_messages
       ORDER BY id DESC
       LIMIT 500`
    );
    res.json({ rows });
  } catch (err) {
    console.error("Admin kontakt list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/admin/poptavka", requireAdmin, async (req, res) => {
  try {
    if (!requireDb(req, res)) return;
    const rows = await db.all(
      `SELECT id, created_at, status, full_name, company, email, phone, vat, message
       FROM poptavky
       ORDER BY id DESC
       LIMIT 500`
    );
    res.json({ rows });
  } catch (err) {
    console.error("Admin poptavka list error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/admin/kontakt/:id/status", requireAdmin, async (req, res) => {
  try {
    if (!requireDb(req, res)) return;
    const id = Number(req.params.id);
    const status = (req.body?.status || "").toString().trim();
    const allowed = new Set(["new", "in_progress", "done"]);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    if (!allowed.has(status)) return res.status(400).json({ error: "Bad status" });

    await db.run(`UPDATE kontakt_messages SET status = ? WHERE id = ?`, [status, id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Admin kontakt status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/api/admin/poptavka/:id/status", requireAdmin, async (req, res) => {
  try {
    if (!requireDb(req, res)) return;
    const id = Number(req.params.id);
    const status = (req.body?.status || "").toString().trim();
    const allowed = new Set(["new", "in_progress", "done"]);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });
    if (!allowed.has(status)) return res.status(400).json({ error: "Bad status" });

    await db.run(`UPDATE poptavky SET status = ? WHERE id = ?`, [status, id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Admin poptavka status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/admin/kontakt/:id", requireAdmin, async (req, res) => {
  try {
    if (!requireDb(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });

    await db.run(`DELETE FROM kontakt_messages WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Admin kontakt delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/admin/poptavka/:id", requireAdmin, async (req, res) => {
  try {
    if (!requireDb(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "Bad id" });

    await db.run(`DELETE FROM poptavky WHERE id = ?`, [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Admin poptavka delete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   AI CHAT ENDPOINT
   ================================ */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ================================
   CTA helpers (organic + link + rules)
   ================================ */

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function countAssistantMessages(messages) {
  return (messages || []).reduce((acc, m) => acc + (m?.role === "assistant" ? 1 : 0), 0);
}

function getLastUserText(messages) {
  const lastUser = [...(messages || [])].reverse().find((m) => m?.role === "user")?.content;
  return (lastUser || "").toString();
}

function shouldShowCTAValid(messages) {
  const assistantCount = countAssistantMessages(messages);
  const lastUser = getLastUserText(messages);
  const interval = 2 + (simpleHash(lastUser) % 2);
  const nextAssistantIndex = assistantCount + 1;
  return nextAssistantIndex % interval === 0;
}

function getTone(messages) {
  const assistantCount = countAssistantMessages(messages);
  return assistantCount < 2 ? "soft" : "normal";
}

function alreadyMentionsKontakt(text) {
  const t = (text || "").toString();
  return /\bkontakt\b/i.test(t) || /\/kontakt\.html/i.test(t);
}

function getCTA({ kind = "valid", tone = "normal" } = {}) {
  const kontakt = `<a href="/kontakt.html">Kontakt</a>`;
  const validSoft = [
    `Pokud budete chtít, můžete se nám ozvat přes ${kontakt}.`,
    `Když budete potřebovat, napište nám přes ${kontakt}.`,
    `Pro jistotu nám klidně napište přes ${kontakt}.`,
    `Pokud chcete, probereme to spolu — ozvěte se přes ${kontakt}.`
  ];
  const validNormal = [
    `Chcete to řešit konkrétně pro vás? Napište nám přes ${kontakt}.`,
    `Rádi se na to podíváme individuálně — napište nám přes ${kontakt}.`,
    `Máte konkrétní situaci? Napište nám přes ${kontakt} a probereme to.`,
    `Pro individuální řešení se nám klidně ozvěte přes ${kontakt}.`
  ];
  const refusalSoft = [
    `S tímto vám tady nepomohu, ale s účetnictvím, daněmi nebo mzdami ano. Napište nám přes ${kontakt}.`,
    `Tento asistent je jen pro účetnictví/daně/mzdy. Pokud máte takový dotaz, ozvěte se přes ${kontakt}.`
  ];
  const refusalNormal = [
    `Tento AI asistent odpovídá jen na účetnictví, daně a mzdy. Pokud máte dotaz k těmto službám, napište nám přes ${kontakt}.`,
    `Mimo účetnictví/daně/mzdy bohužel neodpovídám. Pro konzultaci nám napište přes ${kontakt}.`
  ];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  if (kind === "refusal") return tone === "soft" ? pick(refusalSoft) : pick(refusalNormal);
  return tone === "soft" ? pick(validSoft) : pick(validNormal);
}

async function isInScope(messages) {
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const gate = await openai.responses.create({
    model: process.env.OPENAI_GUARD_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini",
    input: [
      {
        role: "system",
        content: `
Jsi klasifikátor dotazů pro účetní kancelář v ČR.
Rozhodni, zda je dotaz V SOULADU se službami: účetnictví, daně (DPH, daň z příjmu), mzdy/HR, podnikání/finance pro malé firmy, fakturace, evidence, OSSZ/VZP (obecně), daňová přiznání.
MIMO SOULAD je vše ostatní (zeměpis, historie, sport, zdraví, recepty, atd.).

Vrať pouze JSON v tomto formátu:
{"in_scope": true/false}.
Bez dalšího textu.
`.trim()
      },
      { role: "user", content: lastUser }
    ],
    max_output_tokens: 40
  });

  try {
    const obj = JSON.parse(gate.output_text || "{}");
    return Boolean(obj.in_scope);
  } catch {
    return false;
  }
}

app.post("/api/chat", async (req, res) => {
  try {
    const systemPrompt = `
Jsi AI asistent účetní kanceláře Malé Daně (ČR).
Odpovídej česky, stručně a srozumitelně.
Nevymýšlej daňová čísla, sazby ani termíny.
Pokud je dotaz složitý nebo individuální, doporuč kontakt.

DŮLEŽITÉ:
Na konci odpovědi NEPIŠ výzvu ke kontaktu ani slovo „Kontakt“ (žádné „napište přes Kontakt“ apod.).
Výzvu ke kontaktu přidáváme automaticky my.
`.trim();

    const body = req.body || {};
    let input = [];

    if (Array.isArray(body.messages) && body.messages.length) {
      input = body.messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
        .slice(-16)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content.toString().slice(0, 2000)
        }));
    } else {
      const userMessage = (body.message || "").toString().slice(0, 2000);
      if (!userMessage.trim()) return res.status(400).json({ error: "Missing message(s)" });
      input = [{ role: "user", content: userMessage }];
    }

    const tone = getTone(input);

    const ok = await isInScope(input);
    if (!ok) {
      const refusalCTA = getCTA({ kind: "refusal", tone: "soft" });
      return res.json({
        reply:
          "Děkuji za dotaz. Tento AI asistent odpovídá pouze na otázky z oblasti účetnictví, daní, mezd a souvisejících podnikatelských témat. " +
          "Pokud máte otázku k těmto službám, napište ji prosím konkrétně. " +
          refusalCTA
      });
    }

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [{ role: "system", content: systemPrompt }, ...input],
      max_output_tokens: 250
    });

    const reply = response.output_text?.trim() || "Děkuji za dotaz. Můžete jej prosím upřesnit?";

    let final = reply;
    const showCTA = shouldShowCTAValid(input);
    if (showCTA && !alreadyMentionsKontakt(final)) {
      final = `${final} ${getCTA({ kind: "valid", tone })}`;
    }

    res.json({ reply: final });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   START SERVER
   ================================ */

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("❌ DB init failed:", err);
    app.listen(PORT, () => console.log(`Server running on port ${PORT} (DB FAILED)`));
  });
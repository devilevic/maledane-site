import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

// NEW: SQLite (persistent disk on Render)
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse JSON bodies (needed for chat + forms)
app.use(express.json({ limit: "1mb" }));

// Serve static site
app.use(express.static(path.join(__dirname, "public")));

// Health check
app.get("/health", (req, res) => res.status(200).send("ok"));

/* ================================
   DATABASE (SQLite on /var/data)
   ================================ */

const DB_PATH = process.env.DB_PATH || "/var/data/maledane.db";
let db;

async function initDb() {
  db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database
  });

  // Better concurrency for SQLite
  await db.exec("PRAGMA journal_mode = WAL;");
  await db.exec("PRAGMA foreign_keys = ON;");

  // Kontakt form submissions
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

  // Poptavka form submissions
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
  // header: "Basic base64(user:pass)"
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
  return {
    user: decoded.slice(0, idx),
    pass: decoded.slice(idx + 1)
  };
}

function requireAdmin(req, res, next) {
  const ADMIN_USER = process.env.ADMIN_USER || "";
  const ADMIN_PASS = process.env.ADMIN_PASS || "";

  // If not configured, block access
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

// Kontakt form -> DB
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

// Poptavka form -> DB
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
   ADMIN: VIEW + DELETE
   ================================ */

// Admin page (served by server, not from /public, so it can be protected)
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
    table{width:100%; border-collapse:collapse; margin-top:10px;}
    th,td{border-bottom:1px solid #e2e8f0; padding:10px 8px; text-align:left; vertical-align:top; font-size:14px;}
    th{font-size:12px; text-transform:uppercase; letter-spacing:.08em; color:#475569;}
    .muted{color:#64748b; font-size:12px;}
    .danger{border-color:#fecaca;}
    .danger:hover{background:#fff1f2;}
    .grid{display:grid; grid-template-columns: 1fr; gap:22px;}
    @media(min-width: 980px){ .grid{grid-template-columns: 1fr 1fr;} }
    pre{white-space:pre-wrap; word-break:break-word; margin:0;}
  </style>
</head>
<body>
  <h1>Admin</h1>
  <div class="row">
    <button id="refresh">Obnovit</button>
    <span class="muted">Tip: /admin je chráněný Basic Auth (ADMIN_USER / ADMIN_PASS)</span>
  </div>

  <div class="grid">
    <section>
      <h2>Kontakt</h2>
      <div id="kontakt"></div>
    </section>
    <section>
      <h2>Poptávky</h2>
      <div id="poptavka"></div>
    </section>
  </div>

<script>
async function fetchJson(url, opts){
  const r = await fetch(url, opts);
  if(!r.ok) throw new Error("HTTP " + r.status);
  return await r.json();
}

function renderTable(el, rows, type){
  if(!rows.length){
    el.innerHTML = '<p class="muted">Žádná data.</p>';
    return;
  }

  el.innerHTML = \`
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>Datum</th>
          <th>Kontakt</th>
          <th>Zpráva</th>
          <th>Akce</th>
        </tr>
      </thead>
      <tbody>
        \${rows.map(r => \`
          <tr>
            <td>\${r.id}</td>
            <td><span class="muted">\${r.created_at}</span></td>
            <td>
              <div><b>\${escapeHtml(r.name || r.full_name || "")}</b></div>
              <div class="muted">\${escapeHtml(r.email || "")}</div>
              <div class="muted">\${escapeHtml(r.phone || "")}</div>
              \${r.company ? '<div class="muted">' + escapeHtml(r.company) + '</div>' : ''}
              \${r.topic ? '<div class="muted">' + escapeHtml(r.topic) + '</div>' : ''}
              \${r.vat ? '<div class="muted">DPH: ' + escapeHtml(r.vat) + '</div>' : ''}
            </td>
            <td><pre>\${escapeHtml(r.message || "")}</pre></td>
            <td>
              <button class="danger" data-del="\${r.id}" data-type="\${type}">Smazat</button>
            </td>
          </tr>
        \`).join("")}
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
}

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

async function loadAll(){
  const kontaktEl = document.getElementById("kontakt");
  const poptEl = document.getElementById("poptavka");

  kontaktEl.innerHTML = '<p class="muted">Načítám…</p>';
  poptEl.innerHTML = '<p class="muted">Načítám…</p>';

  const kontakt = await fetchJson("/api/admin/kontakt");
  const poptavky = await fetchJson("/api/admin/poptavka");

  renderTable(kontaktEl, kontakt.rows, "kontakt");
  renderTable(poptEl, poptavky.rows, "poptavka");
}

document.getElementById("refresh").addEventListener("click", loadAll);
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
      `SELECT id, created_at, name, email, phone, topic, message
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
      `SELECT id, created_at, full_name, company, email, phone, vat, message
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
  return (messages || []).reduce(
    (acc, m) => acc + (m?.role === "assistant" ? 1 : 0),
    0
  );
}

function getLastUserText(messages) {
  const lastUser = [...(messages || [])]
    .reverse()
    .find((m) => m?.role === "user")?.content;
  return (lastUser || "").toString();
}

// Valid answers: show CTA every 2–3 assistant replies (deterministic per chat)
function shouldShowCTAValid(messages) {
  const assistantCount = countAssistantMessages(messages); // how many assistant messages already in history
  const lastUser = getLastUserText(messages);
  const interval = 2 + (simpleHash(lastUser) % 2); // 2 or 3
  const nextAssistantIndex = assistantCount + 1; // including the reply we are about to send
  return nextAssistantIndex % interval === 0;
}

function getTone(messages) {
  // "Exploring" early in the conversation
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

  if (kind === "refusal") {
    return tone === "soft" ? pick(refusalSoft) : pick(refusalNormal);
  }
  return tone === "soft" ? pick(validSoft) : pick(validNormal);
}

async function isInScope(messages) {
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";

  const gate = await openai.responses.create({
    model:
      process.env.OPENAI_GUARD_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4.1-mini",
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
    // If parsing fails, be conservative: treat as out-of-scope
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

    // New: history mode
    if (Array.isArray(body.messages) && body.messages.length) {
      input = body.messages
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        )
        .slice(-16) // safety cap
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content.toString().slice(0, 2000)
        }));
    } else {
      // Backward compatible: single message mode
      const userMessage = (body.message || "").toString().slice(0, 2000);
      if (!userMessage.trim()) {
        return res.status(400).json({ error: "Missing message(s)" });
      }
      input = [{ role: "user", content: userMessage }];
    }

    const tone = getTone(input);

    // Scope guard: politely refuse unrelated questions
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

    const reply =
      response.output_text?.trim() ||
      "Děkuji za dotaz. Můžete jej prosím upřesnit?";

    // Valid answer CTA: only every 2–3 messages, softer early; never duplicate
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

app.post("/api/chat/stream", async (req, res) => {
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
        .filter(
          (m) =>
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
        )
        .slice(-16)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content.toString().slice(0, 2000)
        }));
    } else {
      const userMessage = (body.message || "").toString().slice(0, 2000);
      if (!userMessage.trim()) {
        return res.status(400).json({ error: "Missing message(s)" });
      }
      input = [{ role: "user", content: userMessage }];
    }

    const tone = getTone(input);

    // Reuse your existing scope guard
    const ok = await isInScope(input);
    if (!ok) {
      // stream a single “out of scope” message as SSE then end
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const msg =
        "Děkuji za dotaz. Tento AI asistent odpovídá pouze na otázky z oblasti účetnictví, daní, mezd a souvisejících podnikatelských témat. " +
        "Pokud máte otázku k těmto službám, napište ji prosím konkrétně. " +
        getCTA({ kind: "refusal", tone: "soft" });

      res.write(`data: ${JSON.stringify({ delta: msg })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // SSE headers
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    const stream = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [{ role: "system", content: systemPrompt }, ...input],
      max_output_tokens: 250,
      stream: true
    });

    let full = "";
    for await (const event of stream) {
      if (event?.type === "response.output_text.delta" && event.delta) {
        full += event.delta;
        res.write(`data: ${JSON.stringify({ delta: event.delta })}\n\n`);
      }
      if (event?.type === "response.completed") {
        // Valid answer CTA: only every 2–3 messages; softer early; never duplicate
        const showCTA = shouldShowCTAValid(input);
        if (showCTA && !alreadyMentionsKontakt(full)) {
          const cta = ` ${getCTA({ kind: "valid", tone })}`;
          res.write(`data: ${JSON.stringify({ delta: cta })}\n\n`);
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      }
      if (event?.type === "error") {
        res.write(`data: ${JSON.stringify({ error: "stream_error" })}\n\n`);
      }
    }

    res.end();
  } catch (err) {
    console.error("Chat stream error:", err);
    // if headers already sent, end SSE
    try {
      res.write(`data: ${JSON.stringify({ error: "server_error" })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } catch {}
    res.end();
  }
});

/* ================================
   START SERVER
   ================================ */

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ DB init failed:", err);
    // still start server so site loads, but forms/admin will fail until fixed
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT} (DB FAILED)`);
    });
  });
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";

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
   AI CHAT ENDPOINT
   ================================ */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* ================================
   CTA helper (organic + link)
   ================================ */
function getCTA() {
  const kontakt = `<a href="/kontakt.html">Kontakt</a>`;
  const variants = [
    `Chcete, ať to probereme? Napište nám přes ${kontakt}`,
    `Pokud chcete řešit konkrétní případ, ozvěte se nám přes ${kontakt}`,
    `Rádi vám s tím pomůžeme individuálně — napište nám přes ${kontakt}`,
    `Máte konkrétní situaci? Napište nám přes ${kontakt} a probereme to`,
    `Pro individuální řešení se nám klidně ozvěte přes ${kontakt}`
  ];
  return variants[Math.floor(Math.random() * variants.length)];
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

    // Scope guard: politely refuse unrelated questions
    const ok = await isInScope(input);
    if (!ok) {
      return res.json({
        reply:
          "Děkuji za dotaz. Tento AI asistent odpovídá pouze na otázky z oblasti účetnictví, daní, mezd a souvisejících podnikatelských témat. " +
          "Pokud máte otázku k těmto službám, napište ji prosím konkrétně. " +
          getCTA()
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

    res.json({ reply: `${reply} ${getCTA()}` });
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
        getCTA();

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
        // append CTA at the end (as one final delta)
        const cta = ` ${getCTA()}`;
        res.write(`data: ${JSON.stringify({ delta: cta })}\n\n`);
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
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
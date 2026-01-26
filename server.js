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

async function isInScope(messages) {
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content || "";

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
Na závěr často nabídni: „Chcete, ať to probereme? Napište nám přes Kontakt.“
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
          "Chcete, ať to probereme? Napište nám přes Kontakt."
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

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ================================
   START SERVER
   ================================ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
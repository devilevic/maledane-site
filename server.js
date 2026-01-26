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

app.post("/api/chat", async (req, res) => {
  try {
    const userMessage = (req.body?.message || "").toString().slice(0, 2000);

    if (!userMessage.trim()) {
      return res.status(400).json({ error: "Missing message" });
    }

    const systemPrompt = `
Jsi AI asistent účetní kanceláře Malé Daně (ČR).
Odpovídej česky, stručně a srozumitelně.
Nevymýšlej daňová čísla, sazby ani termíny.
Pokud je dotaz složitý nebo individuální, doporuč kontakt.
Na závěr často nabídni: „Chcete, ať to probereme? Napište nám přes Kontakt.“
`.trim();

    const response = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ],
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
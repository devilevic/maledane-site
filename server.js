import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static site
app.use(express.static(path.join(__dirname, "public")));

// Optional: health check
app.get("/health", (req, res) => res.status(200).send("ok"));

// For direct navigation to pages, let static files handle it.
// If later you use client-side routing, we can add a fallback.

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
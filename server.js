// Ocean AI backend server
// This holds your Google API key safely and talks to Gemini/Imagen on
// behalf of the browser page (ocean-ai.html), so the key is never
// exposed to anyone visiting your site.

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

if (!GOOGLE_API_KEY) {
  console.error(
    "Missing GOOGLE_API_KEY environment variable. Set it in your hosting provider's settings before deploying."
  );
}

const GEMINI_MODEL = "gemini-3.5-flash";
const IMAGE_MODEL = "gemini-2.5-flash-image";

// Simple health check so you can confirm the server is alive
app.get("/", (req, res) => {
  res.json({ status: "Ocean AI backend is running" });
});

// Diagnostic: lists the models YOUR key can actually use, straight from
// Google. Visit https://YOUR-RENDER-URL.onrender.com/api/models in a
// browser to see ground truth instead of guessing model names.
app.get("/api/models", async (req, res) => {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${GOOGLE_API_KEY}`
    );
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    const usable = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => m.name.replace("models/", ""));
    res.json({ usableModels: usable });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---- CHAT ----
// Expects: { messages: [{role: "user"|"model", content: "..."}], mode: "chat"|"search"|"news"|"code" }
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, mode } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

    const systemInstructions = {
      chat: "You are Ocean AI, a sharp, knowledgeable, direct AI assistant. No filler phrases. Use markdown when it helps.",
      search: "You are Ocean AI. Search the web to answer this query and cite your sources.",
      news: "You are Ocean AI. Summarize the latest news on this topic in a short list of headlines with 1-2 sentence summaries each.",
      code: "You are Ocean AI. Write clean, well-commented, working code. Specify the language and briefly explain what it does.",
    };
    const systemText = systemInstructions[mode] || systemInstructions.chat;

    // Gemini expects roles "user" and "model" (not "assistant")
    const contents = messages.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const body = {
      contents,
      systemInstruction: { parts: [{ text: systemText }] },
    };

    if (mode === "chat" || mode === "search" || mode === "news") {
      body.tools = [{ googleSearch: {} }];
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      return res.status(response.status).json({ error: message });
    }

    const text =
      data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("\n") ||
      "No response — try again.";

    res.json({ reply: text });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ---- IMAGE GENERATION ----
// Expects: { prompt: "description of the image" }
// Note: Google's older Imagen API is being phased out — this uses
// Gemini's built-in image generation model instead, which is the
// currently recommended path (sometimes called "Nano Banana").
app.post("/api/image", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;

    const response = await fetchWithRetry(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const message = data?.error?.message || `HTTP ${response.status}`;
      return res.status(response.status).json({ error: message });
    }

    // Image model returns inline image data inside the response parts
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const images = parts
      .filter((p) => p.inlineData && p.inlineData.data)
      .map((p) => `data:${p.inlineData.mimeType || "image/png"};base64,${p.inlineData.data}`);

    if (images.length === 0) {
      // finishReason "SAFETY" (or similar) means the request was
      // intentionally blocked by content policy, not a technical failure.
      if (candidate?.finishReason && candidate.finishReason !== "STOP") {
        return res.status(422).json({
          error: "This request couldn't be generated due to content guidelines. Try a different description.",
        });
      }
      return res.status(502).json({ error: "No images returned — try a different prompt." });
    }

    res.json({ images });
  } catch (err) {
    console.error("Image error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Retries on 429 (rate limit) or 503 (overloaded) with short backoff
async function fetchWithRetry(url, opts, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, opts);
    if (response.status === 429 || response.status === 503) {
      lastErr = response;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      return response;
    }
    return response;
  }
  return lastErr;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Ocean AI backend listening on port ${PORT}`);
});

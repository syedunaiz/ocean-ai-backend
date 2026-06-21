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

const GEMINI_MODEL = "gemini-2.5-flash";

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

    // Heuristic: if the latest message looks like arithmetic/calculation,
    // use code execution instead of search — guarantees a real computed
    // answer instead of the model guessing at large sums.
    const lastUserMsg = messages[messages.length - 1]?.content || "";
    const looksLikeMath = /[\d][\d,.\s]*[\+\-\*\/×÷][\d,.\s+\-*/×÷]*[\d]/.test(lastUserMsg);

    if (looksLikeMath) {
      body.tools = [{ codeExecution: {} }];
    } else if (mode === "code") {
      body.tools = [{ codeExecution: {} }];
    } else if (mode === "chat" || mode === "search" || mode === "news") {
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
      if (response.status === 429) {
        return res.status(429).json({
          error: "Rate limit hit — wait about a minute before sending another message.",
        });
      }
      return res.status(response.status).json({ error: message });
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts
      .map((p) => {
        if (p.text) return p.text;
        if (p.executableCode) return "\n```python\n" + p.executableCode.code + "\n```\n";
        if (p.codeExecutionResult) return "**Result:** " + p.codeExecutionResult.output;
        return "";
      })
      .join("\n")
      .trim() || "No response — try again.";

    res.json({ reply: text });
  } catch (err) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ---- IMAGE GENERATION ----
// Expects: { prompt: "description of the image" }
// Uses pollinations.ai — a free, no-login image generator. Honest
// tradeoff: it's $0 but has no uptime guarantee and can go down without
// warning. Google's paid image API is more reliable if this matters later.
app.post("/api/image", async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt is required" });
    }

    // Ask Gemini (text, which IS free and working) to expand the prompt
    // into a richer description, improving output quality.
    let enrichedPrompt = prompt;
    try {
      const promptUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_API_KEY}`;
      const promptRes = await fetch(promptUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          systemInstruction: {
            parts: [{
              text: "You are an image prompt expert. Output ONLY a vivid, highly detailed image generation prompt (60-100 words) describing composition, lighting, color, and style. No explanation, no preamble.",
            }],
          },
        }),
      });
      const promptData = await promptRes.json();
      const text = promptData?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "").join("").trim();
      if (text) enrichedPrompt = text;
    } catch (e) {
      // If prompt enrichment fails, fall back to the raw prompt — not fatal.
      console.error("Prompt enrichment failed, using raw prompt:", e.message);
    }

    const qualityTags = ", highly detailed, sharp focus, professional, 8k";
    const fullPrompt = enrichedPrompt + qualityTags;
    const seeds = [42, 137];
    const images = seeds.map(
      (s) =>
        `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=1024&seed=${s}&nologo=true&enhance=true`
    );

    res.json({ images, promptUsed: enrichedPrompt });
  } catch (err) {
    console.error("Image error:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Retries on 503 (temporarily overloaded) only. Deliberately does NOT
// retry on 429 (rate limit) — retrying a rate-limited request just adds
// to the count and makes the limit worse, not better.
async function fetchWithRetry(url, opts, maxRetries = 2) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, opts);
    if (response.status === 503) {
      lastErr = response;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
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

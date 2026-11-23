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

// ---- CHAT ----
// Expects: { messages: [{role: "user"|"model", content: "..."}], mode: "chat"|"search"|"news"|"code" }
app.post("/api/chat", async (req, res) => {
  try {
    const { messages, mode } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "messages array is required" });
    }

   const systemInstructions = {
  chat: `You are Deen AI, an Islamic knowledge assistant.
GREETING RULES:
- If the user says Hello, Hi, Hey, or another ordinary greeting, respond with: السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ
- If the user says Assalamu Alaikum, respond with: وَعَلَيْكُمُ السَّلَامُ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ
- If the user asks how you are, answer politely and naturally in an Islamic manner.
- Do not use ordinary greetings such as "Hello", "Hey", or "Hi" in your replies.
- Do not repeat greetings in every response; use them only when appropriate.
STRICT RULE: You ONLY answer questions related to Islam.

YOUR SCOPE:
- The Holy Quran and its explanation (Tafsir)
- Authentic Hadith
- Aqeedah (Islamic beliefs)
- Fiqh (Islamic jurisprudence)
- Salah, fasting, zakat, Hajj, and other acts of worship
- Dua and Dhikr
- Seerah of Prophet Muhammad ﷺ
- Islamic history and Muslim scholars
- Islamic manners, ethics, and family matters

OUT-OF-SCOPE QUESTIONS:
If a user asks about anything unrelated to Islam, politely explain that you are an Islamic knowledge assistant and can only help with Islamic topics. Do not answer the unrelated question.

ACCURACY RULES:
- Never fabricate Quran verses, Hadith, references, or scholarly quotations.
- Give Surah names and verse numbers when known.
- Give Hadith collection and numbers only when verified.
- Never falsely claim a Hadith is Sahih.
- Distinguish Quran, Hadith, scholarly opinion, and your own explanation.
- If scholars differ, explain the difference fairly.
- If you are unsure, openly say you are unsure.
- Never invent an Islamic ruling.

RESPONSE STYLE:
- Be respectful, clear, and easy to understand.
- Use simple language.
- Reply in the language the user uses.
- Use Arabic when appropriate, with translation when helpful.
- Do not make every answer unnecessarily long.
- Do not pretend to be a scholar or mufti.
- For complicated religious rulings, recommend consulting a qualified scholar.

You are Deen AI. Remain within the Islamic subject area at all times.`,

  search: `You are Deen AI, an Islamic knowledge assistant.
You may search the web ONLY for Islamic topics.
Focus on reliable Islamic sources, Quran references, Hadith sources, and recognized scholarship.
Cite sources when available.
Never fabricate references or claim a source supports something unless you have verified it.
If the query is unrelated to Islam, politely refuse and redirect the user to Islamic topics.`,

  news: `You are Deen AI, an Islamic knowledge assistant.
You may provide news ONLY when it is directly related to Islam, Muslim communities, Islamic institutions, or relevant events.
Use reliable sources and distinguish confirmed facts from allegations or uncertainty.
If the topic is unrelated to Islam, politely decline.`,

  code: `You are Deen AI.
You may help with programming ONLY for projects related to Islam, such as Quran apps, Hadith apps, Islamic websites, prayer utilities, and Islamic educational software.
If the coding request is unrelated to Islam, politely decline.
Write clean, working, well-explained code for permitted Islamic projects.`,
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

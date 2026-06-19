# Ocean AI Backend — Setup Guide

This server keeps your Google API key private and safely handles chat +
image requests for Ocean AI. You need to deploy it yourself — Claude can't
host this for you, but these steps are exact and beginner-friendly.

## What you need
- Your Google API key (from aistudio.google.com) — keep it secret, never
  paste it into chat, code comments, or commit it to GitHub.
- A free account on a hosting service. **Render.com** is recommended:
  free tier, simple, no credit card needed to start.

## Step 1 — Put this code on GitHub (or upload directly to Render)
1. Create a free GitHub account if you don't have one.
2. Create a new repository, e.g. `ocean-ai-backend`.
3. Upload `server.js` and `package.json` (this folder) to it.

## Step 2 — Deploy on Render
1. Go to render.com and sign up (you can sign in with GitHub).
2. Click **New +** → **Web Service**.
3. Connect your `ocean-ai-backend` GitHub repo.
4. Settings:
   - **Build command:** `npm install`
   - **Start command:** `npm start`
   - **Instance type:** Free
5. Under **Environment Variables**, add:
   - Key: `GOOGLE_API_KEY`
   - Value: (paste your real key here — this box is private, only your
     server reads it, it is never sent to visitors of your site)
6. Click **Create Web Service**. Wait a couple of minutes for it to build.
7. Render will give you a URL like `https://ocean-ai-backend.onrender.com`
   — that's your live backend address.

## Step 3 — Point Ocean AI's frontend at your backend
In `ocean-ai.html`, the fetch calls currently point at
`https://api.anthropic.com/...` (the test version that only works inside
Claude chat). Once your backend is live, those need to change to:
- `https://YOUR-RENDER-URL.onrender.com/api/chat`
- `https://YOUR-RENDER-URL.onrender.com/api/image`

Send me your Render URL once you have it (the URL is fine to share — it's
not a secret, only the key inside Render's settings is) and I'll update
`ocean-ai.html` to call it correctly.

## Free tier note
Render's free tier "sleeps" after 15 minutes of no traffic and takes
~30-60 seconds to wake back up on the next request. That's normal, not
a bug — just expect the first message after a quiet period to be slow.

## Cost note
Gemini chat has a free usage tier. Image generation is billed per image
once you exceed any free quota — check current pricing at
ai.google.dev/pricing before heavy use, so there are no surprises.

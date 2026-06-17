# 🧠 MindMirror

> Private on-device mental health journal powered by local AI.  
> Zero cloud. Zero data leaks. Your thoughts never leave your device.

Built for **QVAC Hackathon I** — Psy Models Track

---

## 🎯 What is MindMirror?

MindMirror is a fully local, privacy-first mental health journal that uses
multiple AI agents running entirely on your device to analyze your mood,
detect stress patterns, and provide weekly reflections — without ever
sending your data to the cloud.

---

## 🤖 Multi-Agent Architecture

| Agent | Model | Purpose |
|-------|-------|---------|
| Agent 1 — MoodAnalyzer | Llama 3.2 1B Instruct | Analyzes journal entries for mood & stress scores |
| Agent 2 — MemoryAgent | GTE Large FP16 | RAG semantic search across all journal history |
| Agent 3 — ReflectionAgent | MedGemma 4B | Deep weekly mental health insight generation |

All models run via the **QVAC SDK** — 100% on-device inference.  
No API keys. No internet required after first model download.

---

## ✨ Features

- 📓 **Journal** — Write daily thoughts, auto-analyzed by AI
- 📊 **Analytics** — Mood & stress trend charts from your data
- 🔍 **RAG Chatbot** — Ask anything about your journal history
- 🧘 **Reflections** — Weekly AI mental health insights via MedGemma
- 🔒 **100% Private** — All inference on-device, zero cloud

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+
- QVAC SDK installed
- 8GB RAM minimum

### Installation

```bash
git clone https://github.com/Prithiv04/MindMirror.git
cd MindMirror
npm install
npm run dev
```

Open **http://localhost:3000** in your browser.

> ⚠️ AI models download automatically on first run (~2-4GB total).  
> Subsequent runs use cached models — fully offline.

---

## 🗺️ Agent Map
User ↔ UI (Journal / Analytics / Reflections / Chatbot)

↓

Express Server (server.js)

↓

┌─────────────────────────────────────────┐

│ /api/analytics  → Agent 1 (Llama 1B)   │

│ /api/reflection → Agent 3 (MedGemma 4B)│

│ /api/chat       → Agent 2 (GTE RAG)    │

└─────────────────────────────────────────┘

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js v24 + Express |
| AI Inference | QVAC SDK (local) |
| LLM | Llama 3.2 1B Instruct Q4 |
| Medical AI | MedGemma 4B IT Q4 |
| Embeddings | GTE Large FP16 |
| Vector Store | QVAC RAG |
| Frontend | HTML + CSS + Chart.js |

---

## 🔒 Privacy by Design

- ✅ All inference runs locally via QVAC SDK
- ✅ No API keys required
- ✅ No data ever leaves your device
- ✅ Journal entries stored only in local filesystem
- ✅ Works fully offline after initial model download

---

## 👤 Built By

**Prithiv** — [@Prithiv04](https://github.com/Prithiv04)

Built solo in 11 days on an 8GB laptop. No GPU. No cloud. 🔥

---

## 📄 License

MIT

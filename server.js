import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { getEntries, saveEntry } from "./journal.js";
import { 
  ensureModels, 
  unloadModels, 
  analyzeEntry, 
  reindexAllEntries, 
  ingestEntry, 
  generateInsights,
  getModelStatus
} from "./analyze.js";
import { close as closeQVAC } from "@qvac/sdk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// API: Get status of the local AI models
app.get("/api/status", (req, res) => {
  try {
    const status = getModelStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API: Get all journal entries
app.get("/api/entries", async (req, res) => {
  try {
    // Extend response timeout to 5 minutes (300000 ms)
    res.setTimeout(300000);
    const entries = await getEntries();
    // Return entries in reverse chronological order (newest first)
    res.json([...entries].reverse());
  } catch (error) {
    console.error("Error fetching entries:", error);
    res.status(500).json({ error: "Failed to read journal entries." });
  }
});

// API: Add a new journal entry
app.post("/api/entries", async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ error: "Journal entry content is required." });
    }

    console.log("Processing new journal entry...");
    
    // 1. Analyze mood and metrics via local LLM
    const analysis = await analyzeEntry(content);
    
    // 2. Save entry with analysis to entries.json
    const newEntry = await saveEntry(content, analysis);
    
    // 3. Index entry in QVAC RAG workspace
    try {
      await ingestEntry(newEntry);
    } catch (ragErr) {
      console.error("RAG indexing failed, but entry was saved:", ragErr);
      // We don't fail the request if RAG fails, but log it
    }

    res.status(201).json(newEntry);
  } catch (error) {
    console.error("Error creating journal entry:", error);
    res.status(500).json({ error: "Failed to analyze and save journal entry. Make sure local QVAC models are ready." });
  }
});

// API: Generate weekly reflection insights
app.get("/api/insights", async (req, res) => {
  try {
    // Extend response timeout to 5 minutes (300000 ms)
    res.setTimeout(300000);
    const entries = await getEntries();
    const insightsMarkdown = await generateInsights("", entries);
    res.json({ insights: insightsMarkdown });
  } catch (error) {
    console.error("Error generating weekly insights:", error);
    res.status(500).json({ error: "Failed to generate reflection insights." });
  }
});

// API: Specific semantic search Q&A query over history
app.post("/api/insights/query", async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || typeof query !== "string" || !query.trim()) {
      return res.status(400).json({ error: "Query is required." });
    }

    console.log(`Processing insights search query: "${query}"`);
    const entries = await getEntries();
    const responseMarkdown = await generateInsights(query, entries);
    res.json({ answer: responseMarkdown });
  } catch (error) {
    console.error("Error querying journal insights:", error);
    res.status(500).json({ error: "Failed to retrieve insights from history." });
  }
});

// Serve the index.html fallback for client-side routing if needed (optional)
app.get("/*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Start server and initialize AI models
const server = app.listen(PORT, async () => {
  console.log(`===================================================`);
  console.log(`🚀 MindMirror local backend running at: http://localhost:${PORT}`);
  console.log(`   Running fully offline on Node.js ${process.version}`);
  console.log(`===================================================`);

  // Extend server timeout to 5 minutes (300000 ms) to accommodate slow model inference
  server.setTimeout(300000);
  
  try {
    // 1. Trigger model loading on startup asynchronously
    console.log("Initializing local QVAC AI Models...");
    await ensureModels();
    
    // 2. Synchronize the RAG index with the entries.json
    console.log("Synchronizing RAG database with local entries...");
    const entries = await getEntries();
    await reindexAllEntries(entries);
    console.log("RAG database synchronization complete.");
    console.log("✨ MindMirror local AI is ready for private inference!");
  } catch (error) {
    console.error("❌ Failed to initialize QVAC AI: ", error);
    console.log("Ensure the QVAC provider is installed and your system has sufficient RAM.");
  }
});

// Graceful teardown on termination signals
const handleGracefulShutdown = async () => {
  console.log("\nShutdown signal received. Cleaning up resources...");
  
  // Close HTTP server first
  server.close(() => {
    console.log("Express HTTP server stopped.");
  });

  try {
    // Unload QVAC models to free RAM
    await unloadModels();
    // Close the QVAC SDK provider connection
    await closeQVAC();
    console.log("QVAC SDK worker connection closed successfully.");
  } catch (error) {
    console.error("Error during QVAC cleanup:", error);
  }
  
  console.log("Goodbye!");
  process.exit(0);
};

process.on("SIGINT", handleGracefulShutdown);
process.on("SIGTERM", handleGracefulShutdown);

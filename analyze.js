// MindMirror Multi-Agent Architecture
// Agent 1 - MoodAnalyzer: Llama 3.2 1B (mood analysis + weekly reflection)
// Agent 2 - MemoryAgent: GTE Large FP16 (semantic memory + RAG search)
import {
  loadModel,
  unloadModel,
  completion,
  ragIngest,
  ragSearch,
  ragCloseWorkspace,
  LLAMA_3_2_1B_INST_Q4_0,
  GTE_LARGE_FP16
} from "@qvac/sdk";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROFILE_FILE = path.join(__dirname, "profile.json");

let llmModelId = null;
let embedModelId = null;

let loadingPromise = null;

/**
 * Ensures that both the LLM and Embedding models are loaded.
 * Reuses already loaded instances if available.
 * @returns {Promise<Object>} Object containing llmModelId and embedModelId.
 */
export async function ensureModels() {
  if (llmModelId && embedModelId) {
    return { llmModelId, embedModelId };
  }
  if (loadingPromise) {
    return loadingPromise;
  }
  loadingPromise = (async () => {
    try {
      if (!llmModelId) {
        console.log("Loading LLM Model (Llama 3.2 1B)...");
        llmModelId = await loadModel({
          modelSrc: LLAMA_3_2_1B_INST_Q4_0,
          modelType: "llamacpp-completion",
          onProgress: (p) => {
            const pct = p.percentage > 1 ? Math.min(100, p.percentage).toFixed(1) : (p.percentage * 100).toFixed(1);
            process.stdout.write(`\r  LLM: ${pct}%   `);
          }
        });
        console.log("LLM Model loaded successfully. ID:", llmModelId);
        console.log('Agent 1 (MoodAnalyzer): Llama 3.2 1B - loaded');
      }
      if (!embedModelId) {
        console.log("\nLoading Embedding Model (GTE Large)...");
        embedModelId = await loadModel({
          modelSrc: GTE_LARGE_FP16,
          modelType: "llamacpp-embedding",
          onProgress: (p) => {
            const pct = p.percentage > 1 ? Math.min(100, p.percentage).toFixed(1) : (p.percentage * 100).toFixed(1);
            process.stdout.write(`\r  Embeddings: ${pct}%   `);
          }
        });
        console.log('Agent 2 (MemoryAgent): GTE Large FP16 - loaded');
        console.log("Embedding Model loaded successfully. ID:", embedModelId);
      }
      return { llmModelId, embedModelId };
    } catch (error) {
      console.error("Error loading models:", error);
      loadingPromise = null;
      throw error;
    }
  })();
  return loadingPromise;
}

/**
 * Unloads all models to free memory.
 */
export async function unloadModels() {
  try {
    if (llmModelId) {
      console.log("Unloading LLM Model...");
      await unloadModel({ modelId: llmModelId });
      llmModelId = null;
    }
    if (embedModelId) {
      console.log("Unloading Embedding Model...");
      await unloadModel({ modelId: embedModelId });
      embedModelId = null;
    }

    loadingPromise = null;
  } catch (error) {
    console.error("Error during model unloading:", error);
  }
}

export function getModelStatus() {
  return {
    llmLoaded: !!llmModelId,
    embedLoaded: !!embedModelId,
    loading: !!loadingPromise
  };
}

function formatEntryForRAG(entry) {
  const dateStr = new Date(entry.timestamp).toDateString();
  const sleepStr = entry.analysis.sleepQuality !== null ? `${entry.analysis.sleepQuality}/10` : "N/A";
  return `Date: ${dateStr}\nMood: ${entry.analysis.mood} (Score: ${entry.analysis.moodScore}/10)\nStress Level: ${entry.analysis.stressLevel}/10\nSleep Quality: ${sleepStr}\nKeywords: ${entry.analysis.keywords.join(", ")}\nJournal Text:\n${entry.content}`;
}

const SYSTEM_ANALYSIS_PROMPT = `You are MindMirror AI. Analyze the journal entry and output ONLY JSON:\n{\n  "mood": "string",\n  "moodScore": number,\n  "stressLevel": number,\n  "sleepQuality": number or null,\n  "keywords": ["string"],\n  "summary": "string"\n}`;

export async function analyzeEntry(content) {
  if (!llmModelId) {
    await ensureModels();
  }
  const history = [
    { role: "system", content: SYSTEM_ANALYSIS_PROMPT },
    { role: "user", content: `Analyze this journal entry:\n\n"${content}"` }
  ];
  console.log("Invoking local LLM for mood analysis...");
  const run = completion({
    modelId: llmModelId,
    history,
    stream: false,
    responseFormat: { type: "json_object" }
  });
  const finalResult = await run.final;
  const text = finalResult.contentText.trim();
  console.log("Analysis raw response:", text);
  try {
    let cleanText = text;
    if (cleanText.startsWith("```json")) cleanText = cleanText.substring(7);
    if (cleanText.endsWith("```")) cleanText = cleanText.substring(0, cleanText.length - 3);
    cleanText = cleanText.trim();
    let result = JSON.parse(cleanText);
    if (result.moodScore > 10) result.moodScore = Math.round(result.moodScore / 10);
    if (result.stressLevel > 10) result.stressLevel = Math.round(result.stressLevel / 10);
    if (result.sleepQuality > 10) result.sleepQuality = Math.round(result.sleepQuality / 10);
    return result;
  } catch (error) {
    console.error("Failed to parse LLM analysis response. Falling back to default metrics.", error);
    return {
      mood: "Neutral",
      moodScore: 5,
      stressLevel: 5,
      sleepQuality: null,
      keywords: ["general"],
      summary: "MindMirror recorded your entry but was unable to compute precise mood metrics."
    };
  }
}

export async function reindexAllEntries(entries) {
  const { embedModelId } = await ensureModels();
  try {
    console.log("Deleting old RAG workspace...");
    await ragCloseWorkspace({ workspace: "mindmirror", deleteOnClose: true }).catch(() => {});
  } catch (e) {
    console.log("RAG workspace not found or unable to close, initializing fresh.");
  }
  if (!entries || entries.length === 0) {
    console.log("No entries found to index.");
    return;
  }
  console.log(`Re-indexing ${entries.length} entries into RAG...`);
  const documents = entries.map(formatEntryForRAG);
  const result = await ragIngest({
    modelId: embedModelId,
    workspace: "mindmirror",
    documents,
    chunk: false
  });
  console.log("RAG ingestion result:", result);
}

export async function ingestEntry(entry) {
  const { embedModelId } = await ensureModels();
  const document = formatEntryForRAG(entry);
  console.log(`Ingesting entry ${entry.id} into RAG...`);
  const result = await ragIngest({
    modelId: embedModelId,
    workspace: "mindmirror",
    documents: [document],
    chunk: false
  });
  return result;
}

export async function searchRAG(query, topK = 5) {
  const { embedModelId } = await ensureModels();
  console.log(`Searching RAG for: "${query}"...`);
  const results = await ragSearch({
    modelId: embedModelId,
    workspace: "mindmirror",
    query,
    topK
  });
  return results;
}

const SYSTEM_INSIGHTS_PROMPT = `You are MindMirror, a private journaling assistant. Analyze journal patterns and give concise wellness insights. Focus on trends, avoid clinical advice, and stay encouraging.`;

export async function generateInsights(userQuery = "", allEntries = []) {
  // Ensure LLM (Llama 3.2 1B) is loaded
  await ensureModels();

  let contextTexts = [];
  if (userQuery) {
    console.log(`Generating insights for user query: "${userQuery}"`);
    const ragResults = await searchRAG(userQuery, 3);
    contextTexts = ragResults.map(r => {
      const txt = r.content;
      return txt.length > 150 ? txt.slice(0, 150) + "…" : txt;
    });
  } else {
    console.log("Generating general weekly reflection insights...");
    const recentEntries = allEntries.slice(-3);
    const recentTexts = recentEntries.map(formatEntryForRAG);
    const ragResults = await searchRAG("mood patterns, anxiety, stressors, sleep quality", 3);
    const ragTexts = ragResults.map(r => {
      const txt = r.content;
      return txt.length > 150 ? txt.slice(0, 150) + "…" : txt;
    });
    const uniqueDocs = new Set([...recentTexts, ...ragTexts]);
    contextTexts = Array.from(uniqueDocs);
  }

  if (contextTexts.length === 0) {
    return `### Get Started with MindMirror!\nYou haven't written any journal entries yet. MindMirror runs entirely locally on your device to ensure total privacy. \n\nWrite your first few journal entries above, and MindMirror will analyze your mood, stress levels, and sleep patterns to unlock personalized, private AI insights!`;
  }

  const ragContext = contextTexts.join("\n\n---\n\n");
  
  // Read name from profile.json
  let userName = "";
  try {
    const profileData = await fs.readFile(PROFILE_FILE, "utf-8");
    const profile = JSON.parse(profileData);
    userName = profile.name || "";
  } catch (error) {
    // Skip gracefully if file doesn't exist or fails to parse
  }

  let systemPrompt = `You are MindMirror, a private mental health journal AI. You are talking to {{name}}. Based on these journal entries, give a SHORT and concise response in 3-4 sentences maximum. Be warm, direct and human. No bullet points, no headers, no long analysis.

Journal context: ${ragContext}

User asked: ${userQuery}

Respond in 3-4 sentences only:`;

  if (userName) {
    systemPrompt = systemPrompt.replace(/{{name}}/g, userName);
  } else {
    systemPrompt = systemPrompt.replace(/You are talking to {{name}}\.\s*/g, "");
  }

  const history = [{ role: "system", content: systemPrompt }];

  console.log("Querying LLM for concise insights...");
  const run = completion({ modelId: llmModelId, history, stream: false });
  const finalResult = await run.final;
  return finalResult.contentText;
}

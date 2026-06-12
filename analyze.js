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


// In-memory cache for loaded model IDs
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
        console.log("Embedding Model loaded successfully. ID:", embedModelId);
      }
      
      return { llmModelId, embedModelId };
    } catch (error) {
      console.error("Error loading models:", error);
      loadingPromise = null; // Clear the promise so next call can retry
      throw error;
    }
  })();

  return loadingPromise;
}

/**
 * Unloads both models if they are loaded to free memory.
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

/**
 * Checks the status of the models in memory.
 * @returns {Object} Status details
 */
export function getModelStatus() {
  return {
    llmLoaded: !!llmModelId,
    embedLoaded: !!embedModelId,
    loading: !!loadingPromise
  };
}

/**
 * Formats a journal entry object into a canonical text string for RAG ingestion.
 * @param {Object} entry - Journal entry with timestamp, content, and analysis metrics.
 * @returns {string} Formatted text.
 */
function formatEntryForRAG(entry) {
  const dateStr = new Date(entry.timestamp).toDateString();
  const sleepStr = entry.analysis.sleepQuality !== null ? `${entry.analysis.sleepQuality}/10` : "N/A";
  return `Date: ${dateStr}
Mood: ${entry.analysis.mood} (Score: ${entry.analysis.moodScore}/10)
Stress Level: ${entry.analysis.stressLevel}/10
Sleep Quality: ${sleepStr}
Keywords: ${entry.analysis.keywords.join(", ")}
Journal Text:
${entry.content}`;
}

const SYSTEM_ANALYSIS_PROMPT = `You are MindMirror AI. Analyze the journal entry and output ONLY JSON:
{
  "mood": "string",
  "moodScore": number,
  "stressLevel": number,
  "sleepQuality": number or null,
  "keywords": ["string"],
  "summary": "string"
}`;

/**
 * Analyzes the emotional content and metrics of a journal entry.
 * @param {string} content - Journal text.
 * @returns {Promise<Object>} Mood analysis metrics.
 */
export async function analyzeEntry(content) {
  // Ensure the LLM model is loaded before use
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
    // Attempt parsing. Sometimes the model wraps JSON in markdown blocks, let's strip them just in case
    let cleanText = text;
    if (cleanText.startsWith("```json")) {
      cleanText = cleanText.substring(7);
    }
    if (cleanText.endsWith("```")) {
      cleanText = cleanText.substring(0, cleanText.length - 3);
    }
    cleanText = cleanText.trim();
    
    return JSON.parse(cleanText);
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

/**
 * Re-indexes all existing journal entries into the RAG workspace.
 * Deletes any existing 'mindmirror' workspace first to prevent duplicates.
 * @param {Array} entries - All journal entries.
 */
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
    chunk: false // Treat each entry as a whole document
  });
  console.log("RAG ingestion result:", result);
}

/**
 * Ingests a newly created journal entry into the RAG workspace.
 * @param {Object} entry - The newly saved journal entry.
 */
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

/**
 * Searches the journal entries in the RAG workspace.
 * @param {string} query - The search query.
 * @param {number} topK - Max results.
 * @returns {Promise<Array>} List of semantic search matches.
 */
export async function searchRAG(query, topK = 5) {
  const { embedModelId } = await ensureModels();
  
  console.log(`Searching RAG for: "${query}"...`);
  const results = await ragSearch({
    modelId: embedModelId,
    workspace: "mindmirror",
    query,
    topK
  });
  return results; // Returns Array of { id, content, score }
}

const SYSTEM_INSIGHTS_PROMPT = `You are MindMirror, a private journaling assistant. Analyze journal patterns and give concise wellness insights. Focus on trends, avoid clinical advice, and stay encouraging.`;

/**
 * Generates synthesized insights based on recent journal entries and RAG context.
 * @param {string} userQuery - Optional specific question (e.g. "Why am I feeling anxious?").
 * @param {Array} allEntries - All journal entries from the JSON file.
 * @returns {Promise<string>} Markdown text with insights.
 */
export async function generateInsights(userQuery = "", allEntries = []) {
  // Ensure the LLM model is loaded before use
  if (!llmModelId) {
    await ensureModels();
  }

  let contextTexts = [];

  if (userQuery) {
    // Specific query: limit to top 3 results
    console.log(`Generating insights for user query: "${userQuery}"`);
    const ragResults = await searchRAG(userQuery, 3);
    // Truncate each entry to 150 characters
    contextTexts = ragResults.map(r => {
      const txt = r.content;
      return txt.length > 150 ? txt.slice(0, 150) + "…" : txt;
    });
  } else {
    // If it's a general reflection, get the last 3 entries (chronological coverage)
    // AND query the RAG database for wellness trends to enrich context
    console.log("Generating general weekly reflection insights...");
    const recentEntries = allEntries.slice(-3);
    const recentTexts = recentEntries.map(formatEntryForRAG);
    
    const ragResults = await searchRAG("mood patterns, anxiety, stressors, sleep quality", 3);
    const ragTexts = ragResults.map(r => {
      const txt = r.content;
      return txt.length > 150 ? txt.slice(0, 150) + "…" : txt;
    });
    
    // Deduplicate documents using a Set
    const uniqueDocs = new Set([...recentTexts, ...ragTexts]);
    contextTexts = Array.from(uniqueDocs);
  }

  if (contextTexts.length === 0) {
    return `### Get Started with MindMirror!
You haven't written any journal entries yet. MindMirror runs entirely locally on your device to ensure total privacy. 

Write your first few journal entries above, and MindMirror will analyze your mood, stress levels, and sleep patterns to unlock personalized, private AI insights!`;
  }

  const promptContent = userQuery
    ? `Analyze my journal history to address this specific question: "${userQuery}"\n\nHere are the most relevant journal entries from my history:\n\n${contextTexts.join("\n\n---\n\n")}`
    : `Generate a comprehensive mental health insights report using my recent journal entries:\n\n${contextTexts.join("\n\n---\n\n")}`;

  const history = [
    { role: "system", content: SYSTEM_INSIGHTS_PROMPT },
    { role: "user", content: promptContent }
  ];

  console.log("Querying LLM for synthesized insights report...");
  let attempt = 0;
  let finalResult;
  while (attempt < 2) {
    // Ensure the model is loaded before each attempt
    if (!llmModelId) {
      await ensureModels();
    }
    try {
      const run = completion({
        modelId: llmModelId,
        history,
        stream: false,
      });
      finalResult = await run.final;
      break; // success
    } catch (err) {
      if (err && err.code === 52002) {
        console.warn('MODEL_NOT_FOUND (code 52002): Reloading LLM model and retrying...');
        llmModelId = null;
        await ensureModels();
        attempt++;
        continue;
      }
      throw err; // other errors propagate
    }
  }
  if (!finalResult) {
    throw new Error('Failed to obtain LLM response after retries');
  }
  return finalResult.contentText
}

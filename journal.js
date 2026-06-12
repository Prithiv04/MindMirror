import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ENTRIES_FILE = path.join(__dirname, "entries.json");

/**
 * Reads the list of journal entries from entries.json.
 * If the file does not exist, it initializes it as an empty array.
 * @returns {Promise<Array>} List of journal entries.
 */
export async function getEntries() {
  try {
    const data = await fs.readFile(ENTRIES_FILE, "utf-8");
    return JSON.parse(data || "[]");
  } catch (error) {
    if (error.code === "ENOENT") {
      // If file doesn't exist, create it with empty array
      await fs.writeFile(ENTRIES_FILE, "[]", "utf-8");
      return [];
    }
    throw error;
  }
}

/**
 * Saves a new journal entry to entries.json.
 * @param {string} content - The journal text.
 * @param {Object} analysis - The mood analysis JSON object from local LLM.
 * @returns {Promise<Object>} The newly created journal entry object.
 */
export async function saveEntry(content, analysis) {
  const entries = await getEntries();
  
  const newEntry = {
    id: Date.now().toString(),
    timestamp: new Date().toISOString(),
    content,
    analysis
  };
  
  entries.push(newEntry);
  await fs.writeFile(ENTRIES_FILE, JSON.stringify(entries, null, 2), "utf-8");
  return newEntry;
}

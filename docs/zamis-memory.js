const DB_NAME = "zamis-memory";
const DB_VERSION = 1;
const MIGRATION_KEY = "legacy-local-storage-v1";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
  });
}

function readLegacyJSON(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

export function meaningfulWords(text) {
  return new Set(String(text).toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []);
}

export function memoryScore(query, content) {
  const queryWords = meaningfulWords(query);
  if (!queryWords.size) return 0;
  return [...meaningfulWords(content)].filter((word) => queryWords.has(word)).length;
}

export class ZamisMemory {
  constructor() {
    this.database = null;
  }

  async init() {
    if (!globalThis.indexedDB) throw new Error("IndexedDB is unavailable in this browser.");

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;

      if (!database.objectStoreNames.contains("memories")) {
        const memories = database.createObjectStore("memories", { keyPath: "id", autoIncrement: true });
        memories.createIndex("content", "content", { unique: true });
        memories.createIndex("category", "category");
        memories.createIndex("createdAt", "createdAt");
      }

      if (!database.objectStoreNames.contains("conversations")) {
        const conversations = database.createObjectStore("conversations", { keyPath: "id", autoIncrement: true });
        conversations.createIndex("createdAt", "createdAt");
      }

      if (!database.objectStoreNames.contains("profile")) {
        database.createObjectStore("profile", { keyPath: "key" });
      }

      if (!database.objectStoreNames.contains("knowledge")) {
        const knowledge = database.createObjectStore("knowledge", { keyPath: "id", autoIncrement: true });
        knowledge.createIndex("createdAt", "createdAt");
      }
    });

    this.database = await requestResult(request);
    this.database.addEventListener("versionchange", () => this.database.close());
    await this.migrateLegacyStorage();
    return this;
  }

  store(name, mode = "readonly") {
    if (!this.database) throw new Error("ZamisMemory.init() must be called first.");
    const transaction = this.database.transaction(name, mode);
    return { transaction, store: transaction.objectStore(name) };
  }

  async getProfile(key) {
    const { store } = this.store("profile");
    const record = await requestResult(store.get(key));
    return record?.value;
  }

  async setProfile(key, value) {
    const { transaction, store } = this.store("profile", "readwrite");
    const completed = transactionComplete(transaction);
    store.put({ key, value, updatedAt: new Date().toISOString() });
    await completed;
  }

  async addMemory(content, options = {}) {
    const normalized = String(content).trim();
    if (!normalized) return null;

    const { transaction, store } = this.store("memories", "readwrite");
    const completed = transactionComplete(transaction);
    const existing = await requestResult(store.index("content").get(normalized));
    const now = new Date().toISOString();
    const record = existing
      ? { ...existing, ...options, content: normalized, updatedAt: now }
      : {
          content: normalized,
          category: options.category ?? "general",
          importance: options.importance ?? "normal",
          createdAt: now,
          updatedAt: now,
        };
    const id = await requestResult(store.put(record));
    await completed;
    return id;
  }

  async findRelevant(query, limit = 4) {
    const { store } = this.store("memories");
    const records = await requestResult(store.getAll());
    return records
      .map((record) => ({ ...record, score: memoryScore(query, record.content) }))
      .filter((record) => record.score > 0)
      .sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)))
      .slice(0, limit)
      .map((record) => record.content);
  }

  async appendMessage(role, content, createdAt = new Date().toISOString()) {
    if (!['user', 'assistant'].includes(role) || !String(content).trim()) return null;
    const { transaction, store } = this.store("conversations", "readwrite");
    const completed = transactionComplete(transaction);
    const id = await requestResult(store.add({ role, content: String(content), createdAt }));
    await completed;
    return id;
  }

  async loadRecentMessages(limit = 40) {
    const { store } = this.store("conversations");
    const records = await requestResult(store.index("createdAt").getAll());
    return records.slice(-limit).map(({ role, content }) => ({ role, content }));
  }

  async clearConversation() {
    const { transaction, store } = this.store("conversations", "readwrite");
    const completed = transactionComplete(transaction);
    store.clear();
    await completed;
  }

  async migrateLegacyStorage() {
    if (await this.getProfile(MIGRATION_KEY)) return;

    const legacyMemories = [
      ...(readLegacyJSON("zamis-memories") ?? []),
      ...(readLegacyJSON("zamis-memory") ?? []),
      ...(readLegacyJSON("nava-ipad-memories") ?? []),
    ];
    for (const content of legacyMemories) {
      if (typeof content === "string") {
        await this.addMemory(content, { category: "legacy", importance: "normal" });
      }
    }

    const histories = [
      readLegacyJSON("zamis-history"),
      readLegacyJSON("nava-ipad-history"),
    ];
    const legacyHistory = histories.find((items) => Array.isArray(items) && items.length) ?? [];
    for (const message of legacyHistory.slice(-40)) {
      if (message && typeof message.content === "string") {
        await this.appendMessage(message.role, message.content);
      }
    }

    await this.setProfile(MIGRATION_KEY, true);
  }
}

import { CreateMLCEngine } from "https://esm.run/@mlc-ai/web-llm@0.2.85";

const MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";
const SYSTEM_PROMPT = `You are Nava, Amin's private on-device AI assistant.
Reply in the same language as the user. Write natural Persian for Persian messages and natural English for English messages.
Be warm, concise, honest, and useful. Ask a short clarifying question when necessary.
Use saved memories and web context only when relevant. Never invent sources or claim consciousness.
Do not reveal chain-of-thought. Give the final answer directly.`;

const elements = {
  setup: document.querySelector("#setup"),
  load: document.querySelector("#load-model"),
  progress: document.querySelector("#progress-bar"),
  progressLabel: document.querySelector("#progress-label"),
  status: document.querySelector("#status"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chat-form"),
  prompt: document.querySelector("#prompt"),
  send: document.querySelector("#send"),
  web: document.querySelector("#web-toggle"),
  clear: document.querySelector("#clear-chat"),
};

let engine = null;
let busy = false;
let history = readJSON("nava-ipad-history", []);
let memories = readJSON("nava-ipad-memories", []);

function readJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function persist() {
  localStorage.setItem("nava-ipad-history", JSON.stringify(history.slice(-40)));
  localStorage.setItem("nava-ipad-memories", JSON.stringify(memories.slice(-100)));
}

function addMessage(text, role, sources = [], save = true) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.dir = "auto";
  article.textContent = text;

  if (sources.length) {
    const sourceBox = document.createElement("div");
    sourceBox.className = "sources";
    for (const [index, source] of sources.entries()) {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `[${index + 1}] ${source.title}`;
      sourceBox.appendChild(link);
    }
    article.appendChild(sourceBox);
  }

  elements.messages.appendChild(article);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  if (save && (role === "user" || role === "assistant")) {
    history.push({ role, content: text });
    persist();
  }
  return article;
}

function restoreHistory() {
  if (!history.length) return;
  elements.messages.replaceChildren();
  for (const item of history.slice(-20)) addMessage(item.content, item.role, [], false);
}

function setBusy(value) {
  busy = value;
  elements.prompt.disabled = value || !engine;
  elements.send.disabled = value || !engine;
}

function parseProgress(report) {
  const match = String(report.progress ?? report.text ?? "").match(/(\d+(?:\.\d+)?)%/);
  const fraction = typeof report.progress === "number" ? report.progress : null;
  return fraction !== null ? Math.round(fraction * 100) : match ? Number(match[1]) : 0;
}

async function loadModel() {
  if (!navigator.gpu) {
    elements.progressLabel.textContent = "WebGPU is unavailable. Update iPadOS and open this page in Safari.";
    elements.status.textContent = "WebGPU unavailable";
    return;
  }
  elements.load.disabled = true;
  elements.status.textContent = "Loading local model…";
  try {
    engine = await CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        const percent = Math.min(100, parseProgress(report));
        elements.progress.style.width = `${percent}%`;
        elements.progressLabel.textContent = report.text || `Downloading model… ${percent}%`;
      },
    });
    elements.progress.style.width = "100%";
    elements.setup.classList.add("ready");
    elements.status.textContent = "Ready • On-device • Private";
    setBusy(false);
    elements.prompt.focus();
  } catch (error) {
    console.error(error);
    elements.load.disabled = false;
    elements.status.textContent = "Model load failed";
    elements.progressLabel.textContent = `Could not load the model: ${error.message}`;
  }
}

function meaningfulWords(text) {
  return new Set(
    text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
  );
}

function relevantMemories(query) {
  const queryWords = meaningfulWords(query);
  return memories
    .map((content) => ({
      content,
      score: [...meaningfulWords(content)].filter((word) => queryWords.has(word)).length,
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((item) => item.content);
}

function extractMemory(message) {
  const patterns = [
    /^remember that\s+/i,
    /^به خاطر بسپار(?:\s+که)?\s+/u,
    /^یادت بمونه(?:\s+که)?\s+/u,
    /^یادت بماند(?:\s+که)?\s+/u,
  ];
  for (const pattern of patterns) {
    if (pattern.test(message)) return message.replace(pattern, "").trim();
  }
  return "";
}

function looksPersian(text) {
  return /[\u0600-\u06ff]/.test(text);
}

function isQuestion(text) {
  return /[?؟]/.test(text) || /^(what|who|when|where|why|how|چی|چه|کی|کجا|چرا|چطور)\b/iu.test(text.trim());
}

async function wikipediaSearch(query) {
  if (!navigator.onLine || !elements.web.checked || !isQuestion(query)) return { context: "", sources: [] };
  const language = looksPersian(query) ? "fa" : "en";
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: "3",
    prop: "extracts|info",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    format: "json",
    origin: "*",
  });

  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    const data = await response.json();
    const pages = Object.values(data.query?.pages ?? {}).slice(0, 3);
    return {
      context: pages.map((page, index) => `[${index + 1}] ${page.title}\n${String(page.extract ?? "").slice(0, 1200)}`).join("\n\n"),
      sources: pages.map((page) => ({ title: page.title, url: page.fullurl })),
    };
  } catch (error) {
    console.warn("Online research failed", error);
    return { context: "", sources: [] };
  }
}

async function answer(message, placeholder) {
  const saved = extractMemory(message);
  if (saved && !memories.includes(saved)) {
    memories.push(saved);
    persist();
  }

  const related = relevantMemories(message);
  const research = await wikipediaSearch(message);
  const contextParts = [];
  if (related.length) contextParts.push(`Relevant saved memories:\n- ${related.join("\n- ")}`);
  if (research.context) contextParts.push(`Current online context. Cite it with [1], [2], or [3]:\n${research.context}`);

  const system = contextParts.length
    ? `${SYSTEM_PROMPT}\n\n${contextParts.join("\n\n")}`
    : SYSTEM_PROMPT;
  const messages = [
    { role: "system", content: system },
    ...history.slice(-12, -1),
    { role: "user", content: message },
  ];

  const stream = await engine.chat.completions.create({
    messages,
    temperature: 0.55,
    top_p: 0.9,
    max_tokens: 320,
    stream: true,
  });

  let text = "";
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content ?? "";
    placeholder.firstChild.textContent = text;
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }
  history.push({ role: "assistant", content: text });
  persist();

  if (research.sources.length) {
    const sourceBox = document.createElement("div");
    sourceBox.className = "sources";
    research.sources.forEach((source, index) => {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `[${index + 1}] ${source.title}`;
      sourceBox.appendChild(link);
    });
    placeholder.appendChild(sourceBox);
  }
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = elements.prompt.value.trim();
  if (!message || busy || !engine) return;
  addMessage(message, "user");
  elements.prompt.value = "";
  setBusy(true);
  elements.status.textContent = elements.web.checked ? "Thinking locally • Web available" : "Thinking locally • Offline";
  const placeholder = addMessage("…", "assistant", [], false);
  try {
    await answer(message, placeholder);
    elements.status.textContent = "Ready • On-device • Private";
  } catch (error) {
    console.error(error);
    placeholder.textContent = looksPersian(message)
      ? "نتوانستم پاسخ را کامل کنم. دوباره امتحان کن."
      : "I could not complete that response. Please try again.";
    elements.status.textContent = "Generation error";
  } finally {
    setBusy(false);
    elements.prompt.focus();
  }
});

elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

elements.clear.addEventListener("click", () => {
  history = [];
  persist();
  elements.messages.replaceChildren();
  addMessage("Chat cleared. Your explicit memories are still saved.", "assistant", [], false);
});

elements.load.addEventListener("click", loadModel);
restoreHistory();

if (!navigator.gpu) {
  elements.status.textContent = "WebGPU unavailable";
  elements.progressLabel.textContent = "Open in Safari on iPadOS 26 or newer.";
} else {
  elements.status.textContent = "Compatible • Model not loaded";
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

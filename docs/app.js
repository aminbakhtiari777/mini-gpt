import {
  CreateMLCEngine,
  deleteModelAllInfoInCache,
  hasModelInCache,
} from "https://esm.run/@mlc-ai/web-llm@0.2.85";
import { ZamisMemory } from "./zamis-memory.js?v=15";
import { createVoiceController, detectSpeechLanguage } from "./zamis-voice.js?v=15";
import { readAttachment, releaseAttachment } from "./zamis-files.js?v=15";
import {
  SYSTEM_PROMPT,
  cleanModelResponse,
  correctionReply,
  currentDateReply,
  directReply,
  isDateQuery,
  isEncyclopedicQuery,
  isPersonalRecallQuery,
  shouldSearchWeb,
  summarizeExtract,
} from "./zamis-brain.js?v=15";

const MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";

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
  voiceOrb: document.querySelector("#voice-orb"),
  voiceSetup: document.querySelector("#voice-setup"),
  enableVoice: document.querySelector("#enable-voice"),
  listen: document.querySelector("#listen-toggle"),
  listenLabel: document.querySelector("#listen-label"),
  speechLanguage: document.querySelector("#speech-language"),
  speak: document.querySelector("#speak-toggle"),
  web: document.querySelector("#web-toggle"),
  clear: document.querySelector("#clear-chat"),
  appMode: document.querySelector("#app-mode"),
  attach: document.querySelector("#attach"),
  fileInput: document.querySelector("#file-input"),
  attachmentChip: document.querySelector("#attachment-chip"),
  attachmentPreview: document.querySelector("#attachment-preview"),
  attachmentName: document.querySelector("#attachment-name"),
  removeAttachment: document.querySelector("#remove-attachment"),
  openSettings: document.querySelector("#open-settings"),
  settingsDialog: document.querySelector("#settings-dialog"),
  apiBase: document.querySelector("#api-base"),
  deviceKey: document.querySelector("#device-key"),
  saveSettings: document.querySelector("#save-settings"),
};

let engine = null;
let busy = false;
let modelProgress = 0;
let history = [];
let pendingAttachment = null;
let lastSpeechLanguage = localStorage.getItem("zamis-last-speech-language") || "fa-IR";
const memory = new ZamisMemory();
const voice = createVoiceController({
  apiBase: () => localStorage.getItem("zamis-api-base") || "",
  deviceKey: () => localStorage.getItem("zamis-device-key") || "",
  onStateChange: (state) => {
    document.body.dataset.voiceState = state;
    elements.voiceOrb.dataset.state = state;
    elements.listen.checked = !["off", "error"].includes(state);
    elements.listenLabel.textContent = state === "armed" || state === "hearing-command" ? "Awake" : "Standby";
    elements.voiceSetup.hidden = !["off", "error"].includes(state);
  },
  onError: (error) => {
    elements.status.textContent = error?.message || String(error);
  },
  onStatus: (message) => {
    if (!busy) elements.status.textContent = message;
  },
  onVoiceProgress: (percent) => {
    elements.enableVoice.textContent = percent < 100 ? `Preparing ${percent}%` : "Active";
  },
  onAudioLevel: (level) => {
    elements.voiceOrb.style.setProperty("--voice-level", String(level));
  },
  onWake: (recognitionLanguage) => {
    lastSpeechLanguage = recognitionLanguage;
    voice.speak(recognitionLanguage === "fa-IR" ? "بله امین" : "Yes, Amin?");
  },
  onTranscript: (transcript, detail) => {
    elements.prompt.value = transcript;
    if (!detail?.final) elements.status.textContent = `شنیدم: ${transcript}`;
  },
  onCommand: (transcript, recognitionLanguage) => {
    elements.prompt.value = transcript;
    lastSpeechLanguage = detectSpeechLanguage(transcript, recognitionLanguage);
    localStorage.setItem("zamis-last-speech-language", lastSpeechLanguage);
    if (executeLocalVoiceAction(transcript)) return;
    setTimeout(() => elements.form.requestSubmit(), 500);
  },
});

elements.speak.checked = localStorage.getItem("zamis-speak-enabled") !== "false";
elements.speechLanguage.value = localStorage.getItem("zamis-speech-language") || "auto";

function addMessage(text, role, sources = [], save = true, attachment = null) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  article.dir = "auto";
  article.textContent = text;

  if (attachment) {
    const badge = document.createElement("span");
    badge.className = "message-attachment";
    badge.textContent = `📎 ${attachment.name}`;
    article.appendChild(badge);
  }

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
    void memory.appendMessage(role, text).catch((error) => console.warn("Memory write failed", error));
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
  elements.attach.disabled = value || !engine;
}

function executeLocalVoiceAction(message) {
  const text = String(message).toLocaleLowerCase().replace(/[،,.!?؟]/gu, " ").replace(/\s+/gu, " ").trim();
  let reply = "";
  if (/(چت|گفتگو).*(پاک|حذف)|clear (the )?chat/iu.test(text)) {
    history = [];
    void memory.clearConversation();
    elements.messages.replaceChildren();
    reply = "گفتگو پاک شد؛ حافظه‌های صریح باقی ماندند.";
  } else if (/(وب|اینترنت).*(روشن|فعال)|turn (the )?web on/iu.test(text)) {
    elements.web.checked = true;
    reply = "جستجوی وب روشن شد.";
  } else if (/(وب|اینترنت).*(خاموش|غیرفعال)|turn (the )?web off/iu.test(text)) {
    elements.web.checked = false;
    reply = "جستجوی وب خاموش شد.";
  } else if (/تنظیمات.*باز|open settings/iu.test(text)) {
    elements.openSettings.click();
    reply = "تنظیمات باز شد.";
  }
  if (!reply) return false;
  elements.prompt.value = "";
  addMessage(reply, "assistant", [], false);
  if (elements.speak.checked) voice.speak(reply);
  return true;
}

function parseProgress(report) {
  const match = String(report.progress ?? report.text ?? "").match(/(\d+(?:\.\d+)?)%/);
  const fraction = typeof report.progress === "number" ? report.progress : null;
  return fraction !== null ? Math.round(fraction * 100) : match ? Number(match[1]) : 0;
}

async function loadModel({ automatic = false } = {}) {
  if (!navigator.gpu) {
    elements.progressLabel.textContent = "WebGPU is unavailable. Update iPadOS and open this page in Safari.";
    elements.status.textContent = "WebGPU unavailable";
    return;
  }
  elements.load.disabled = true;
  modelProgress = 0;
  const cached = await hasModelInCache(MODEL_ID).catch(() => false);
  elements.status.textContent = cached ? "Loading cached model…" : "Downloading local model…";
  elements.progressLabel.textContent = cached
    ? "Loading the saved model into memory…"
    : "Downloading the model for first use…";
  void navigator.storage?.persist?.().catch(() => false);
  try {
    engine = await CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report) => {
        modelProgress = Math.max(modelProgress, Math.min(100, parseProgress(report)));
        const percent = modelProgress;
        elements.progress.style.width = `${percent}%`;
        elements.progressLabel.textContent = `${cached ? "Loading saved model" : "Downloading model"}… ${percent}%`;
        if (automatic) elements.status.textContent = `Starting Zamis… ${percent}%`;
      },
    });
    elements.progress.style.width = "100%";
    elements.setup.classList.add("ready");
    elements.status.textContent = "Ready • On-device • Private";
    setBusy(false);
    elements.prompt.focus();
  } catch (error) {
    console.error(error);
    elements.setup.classList.remove("ready");
    elements.load.disabled = false;
    const errorMessage = String(error?.message ?? error);
    const corruptCache = /tensor-cache|shard size|record range|cache.*(?:corrupt|invalid)/iu.test(errorMessage);

    if (corruptCache) {
      elements.status.textContent = "Repairing incomplete model cache…";
      elements.progressLabel.textContent = "The previous model download was incomplete. Removing only the damaged 3B cache…";
      try {
        await deleteModelAllInfoInCache(MODEL_ID);
        elements.status.textContent = "Model cache repaired";
        elements.load.textContent = "Download clean AI model • ~2.5 GB";
        elements.progress.style.width = "0%";
        elements.progressLabel.textContent = "Damaged files were removed. Tap the button to download the 3B model again.";
      } catch (repairError) {
        console.error("Model cache repair failed", repairError);
        elements.status.textContent = "Model cache repair failed";
        elements.progressLabel.textContent = "Could not repair the model cache automatically. Reload the app and try again.";
      }
      return;
    }

    elements.status.textContent = "Model load failed";
    elements.progressLabel.textContent = `Could not load the model: ${errorMessage}`;
  }
}

async function updateModelButton() {
  try {
    const cached = await hasModelInCache(MODEL_ID);
    elements.load.textContent = cached
      ? "Load cached AI model"
      : "Download AI model • ~2.5 GB";
    elements.progressLabel.textContent = cached
      ? "The model is saved on this iPad. Loading it does not download it again."
      : "Keep Safari open during the first download.";
  } catch (error) {
    console.warn("Could not inspect the model cache", error);
  }
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

async function wikipediaSearch(query) {
  if (!navigator.onLine || !elements.web.checked || !shouldSearchWeb(query)) {
    return { context: "", sources: [], summary: "" };
  }
  const language = looksPersian(query) ? "fa" : "en";
  const searchQuery = String(query)
    .replace(/^(?:راجع به|درباره(?:‌ی| ی)?)\s*/u, "")
    .replace(/\s*(?:چیست|چیه|کیست|کجاست|را توضیح بده|توضیح بده|بگو)$/u, "")
    .trim() || query;
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.search = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: searchQuery,
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
    const pages = Object.values(data.query?.pages ?? {})
      .sort((a, b) => (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER))
      .slice(0, 3);
    return {
      context: pages.map((page, index) => `[${index + 1}] ${page.title}\n${String(page.extract ?? "").slice(0, 1200)}`).join("\n\n"),
      sources: pages.map((page) => ({ title: page.title, url: page.fullurl })),
      summary: summarizeExtract(pages[0]?.extract ?? ""),
    };
  } catch (error) {
    console.warn("Online research failed", error);
    return { context: "", sources: [], summary: "" };
  }
}

function appendSources(container, sources) {
  if (!sources.length) return;
  const sourceBox = document.createElement("div");
  sourceBox.className = "sources";
  sources.forEach((source, index) => {
    const link = document.createElement("a");
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `[${index + 1}] ${source.title}`;
    sourceBox.appendChild(link);
  });
  container.appendChild(sourceBox);
}

async function cloudReply(message, attachmentContext = "") {
  const base = (localStorage.getItem("zamis-api-base") || "").replace(/\/$/u, "");
  if (!base) return "";
  const deviceKey = localStorage.getItem("zamis-device-key") || "";
  const response = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(deviceKey ? { "X-Zamis-Key": deviceKey } : {}),
    },
    body: JSON.stringify({ message, attachmentContext }),
  });
  if (!response.ok) throw new Error(`Cloud assistant is unavailable (${response.status}).`);
  const data = await response.json();
  return String(data.text || "").trim();
}

async function answer(message, placeholder, attachmentContext = "") {
  const saved = extractMemory(message);
  if (saved) await memory.addMemory(saved, { importance: "high" });

  if (isPersonalRecallQuery(message)) {
    const savedFacts = await memory.listMemories(5);
    const details = savedFacts.length
      ? ` چیزهایی که خواسته‌ای نگه دارم: ${savedFacts.join("؛ ")}.`
      : " هنوز اطلاعات شخصی دیگری از تو ذخیره نکرده‌ام.";
    const personalReply = `آره امین؛ می‌دانم تو مالک و توسعه‌دهندهٔ زمیس هستی.${details}`;
    placeholder.firstChild.textContent = personalReply;
    history.push({ role: "assistant", content: personalReply });
    await memory.appendMessage("assistant", personalReply);
    return;
  }

  if (isDateQuery(message) || /تاریخ.*(?:اشتباه|غلط)/u.test(message)) {
    const dateReply = currentDateReply();
    placeholder.firstChild.textContent = dateReply;
    history.push({ role: "assistant", content: dateReply });
    await memory.appendMessage("assistant", dateReply);
    return;
  }

  const correction = correctionReply(message);
  if (correction) {
    placeholder.firstChild.textContent = correction;
    history.push({ role: "assistant", content: correction });
    await memory.appendMessage("assistant", correction);
    return;
  }

  const immediate = directReply(message);
  if (immediate) {
    placeholder.firstChild.textContent = immediate;
    history.push({ role: "assistant", content: immediate });
    await memory.appendMessage("assistant", immediate);
    return;
  }

  if (localStorage.getItem("zamis-api-base")) {
    try {
      const response = await cloudReply(message, attachmentContext);
      if (response) {
        placeholder.firstChild.textContent = response;
        history.push({ role: "assistant", content: response });
        await memory.appendMessage("assistant", response);
        return;
      }
    } catch (error) {
      console.warn("Cloud answer failed; using the local model", error);
      elements.status.textContent = "Cloud unavailable • Using local model";
    }
  }

  const related = await memory.findRelevant(message, 4);
  const research = await wikipediaSearch(message);

  if (research.summary && isEncyclopedicQuery(message)) {
    placeholder.firstChild.textContent = research.summary;
    history.push({ role: "assistant", content: research.summary });
    await memory.appendMessage("assistant", research.summary);
    appendSources(placeholder, research.sources.slice(0, 1));
    return;
  }

  const contextParts = [];
  if (attachmentContext) contextParts.push(attachmentContext);
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
    temperature: 0.1,
    top_p: 0.9,
    repetition_penalty: 1.03,
    max_tokens: 180,
    stream: true,
  });

  let text = "";
  for await (const chunk of stream) {
    text += chunk.choices[0]?.delta?.content ?? "";
    placeholder.firstChild.textContent = text;
    elements.messages.scrollTop = elements.messages.scrollHeight;
  }
  text = cleanModelResponse(text, message);
  placeholder.firstChild.textContent = text;
  history.push({ role: "assistant", content: text });
  await memory.appendMessage("assistant", text);

  appendSources(placeholder, research.sources);
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const attachment = pendingAttachment;
  const message = elements.prompt.value.trim() || (attachment ? "این فایل را بررسی کن." : "");
  if (!message || busy || !engine) return;
  addMessage(message, "user", [], true, attachment);
  elements.prompt.value = "";
  clearAttachment();
  setBusy(true);
  elements.status.textContent = elements.web.checked ? "Thinking locally • Web available" : "Thinking locally • Offline";
  const placeholder = addMessage("…", "assistant", [], false);
  try {
    await answer(message, placeholder, attachment?.context || "");
    elements.status.textContent = voice.isEnabled() ? "Ready • Say “Zamis” or “زمیس”" : "Ready • On-device • Private";
    if (elements.speak.checked) voice.speak(placeholder.firstChild?.textContent ?? placeholder.textContent);
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

async function activateVoice() {
  if (!voice.inputSupported) {
    elements.status.textContent = "Voice standby is unavailable in this browser.";
    return;
  }
  elements.enableVoice.disabled = true;
  localStorage.setItem("zamis-voice-standby", "true");
  try {
    await voice.enableAlwaysOn(elements.speechLanguage.value);
  } catch (error) {
    console.error("Could not activate voice standby", error);
    elements.status.textContent = error?.message || "Voice standby could not start.";
    elements.voiceSetup.hidden = false;
  } finally {
    elements.enableVoice.disabled = false;
  }
}

elements.enableVoice.addEventListener("click", activateVoice);
elements.listen.addEventListener("change", async () => {
  if (elements.listen.checked) await activateVoice();
  else {
    localStorage.setItem("zamis-voice-standby", "false");
    await voice.disableAlwaysOn();
  }
});

function clearAttachment() {
  releaseAttachment(pendingAttachment);
  pendingAttachment = null;
  elements.fileInput.value = "";
  elements.attachmentChip.hidden = true;
  elements.attachmentPreview.hidden = true;
  elements.attachmentPreview.removeAttribute("src");
  elements.attachmentName.textContent = "";
}

elements.attach.addEventListener("click", () => elements.fileInput.click());
elements.removeAttachment.addEventListener("click", clearAttachment);
elements.fileInput.addEventListener("change", async () => {
  const [file] = elements.fileInput.files;
  if (!file) return;
  clearAttachment();
  elements.status.textContent = "Reading attachment…";
  try {
    pendingAttachment = await readAttachment(file);
    elements.attachmentName.textContent = pendingAttachment.name;
    if (pendingAttachment.previewUrl) {
      elements.attachmentPreview.src = pendingAttachment.previewUrl;
      elements.attachmentPreview.hidden = false;
    }
    elements.attachmentChip.hidden = false;
    elements.status.textContent = "Attachment ready";
  } catch (error) {
    elements.status.textContent = error.message;
  }
});

elements.speak.addEventListener("change", () => {
  localStorage.setItem("zamis-speak-enabled", String(elements.speak.checked));
  if (!elements.speak.checked) globalThis.speechSynthesis?.cancel?.();
});

elements.openSettings.addEventListener("click", () => {
  elements.apiBase.value = localStorage.getItem("zamis-api-base") || "";
  elements.deviceKey.value = localStorage.getItem("zamis-device-key") || "";
  elements.settingsDialog.showModal();
});

elements.saveSettings.addEventListener("click", () => {
  const base = elements.apiBase.value.trim().replace(/\/$/u, "");
  const key = elements.deviceKey.value.trim();
  if (base) localStorage.setItem("zamis-api-base", base);
  else localStorage.removeItem("zamis-api-base");
  if (key) localStorage.setItem("zamis-device-key", key);
  else localStorage.removeItem("zamis-device-key");
  elements.status.textContent = base ? "Secure cloud voice configured" : "Local fallback mode";
});

elements.speechLanguage.addEventListener("change", () => {
  localStorage.setItem("zamis-speech-language", elements.speechLanguage.value);
  if (voice.isEnabled()) {
    void voice.disableAlwaysOn().then(activateVoice);
  }
});

elements.prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

elements.clear.addEventListener("click", async () => {
  history = [];
  await memory.clearConversation();
  elements.messages.replaceChildren();
  addMessage("Chat cleared. Your explicit memories are still saved.", "assistant", [], false);
});

elements.load.addEventListener("click", loadModel);
await memory.init();
history = await memory.loadRecentMessages(40);
restoreHistory();
void navigator.storage?.persist?.().catch(() => false);

const standalone = window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
elements.appMode.textContent = standalone
  ? "Installed • Local model • Local memory"
  : "Install: Share → Add to Home Screen";

if (!navigator.gpu) {
  elements.status.textContent = "WebGPU unavailable";
  elements.progressLabel.textContent = "Open in Safari on iPadOS 26 or newer.";
} else {
  const cached = await hasModelInCache(MODEL_ID).catch(() => false);
  if (cached) {
    elements.setup.classList.add("ready");
    elements.status.textContent = "Starting Zamis…";
    await loadModel({ automatic: true });
  } else {
    elements.status.textContent = "Compatible • Model not loaded";
    await updateModelButton();
  }
}

if (localStorage.getItem("zamis-voice-standby") === "true") {
  void activateVoice();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(console.warn);
}

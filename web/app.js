const form = document.querySelector("#chat-form");
const promptInput = document.querySelector("#prompt");
const messages = document.querySelector("#messages");
const statusElement = document.querySelector("#status");
const webToggle = document.querySelector("#web-toggle");
const submitButton = form.querySelector("button");
let activeModel = "Fallback engine";

function createSessionId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const randomPart = Math.random().toString(36).slice(2);
  return `session-${Date.now()}-${randomPart}`;
}

const sessionId = localStorage.getItem("minigpt-session") || createSessionId();
localStorage.setItem("minigpt-session", sessionId);

function setReadyStatus() {
  statusElement.textContent = `Ready • ${activeModel}`;
}

async function loadEngineStatus() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const health = await response.json();
    activeModel = health.engine === "OllamaEngine"
      ? `Ollama • ${health.model}`
      : "Fallback engine";
    setReadyStatus();
  } catch (error) {
    statusElement.textContent = "Server unavailable";
    console.warn("Health check failed", error);
  }
}

function addMessage(text, role, metadata = "", sources = []) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  message.dir = "auto";
  message.textContent = text;

  if (metadata) {
    const details = document.createElement("small");
    details.className = "meta";
    details.textContent = metadata;
    message.appendChild(details);
  }

  if (sources.length > 0) {
    const sourceList = document.createElement("div");
    sourceList.className = "sources";

    sources.forEach((source, index) => {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = `[${index + 1}] ${source.title}`;
      sourceList.appendChild(link);
    });

    message.appendChild(sourceList);
  }

  messages.appendChild(message);
  messages.scrollTop = messages.scrollHeight;
  return message;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  promptInput.disabled = isBusy;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userMessage = promptInput.value.trim();
  if (!userMessage) return;

  addMessage(userMessage, "user");
  promptInput.value = "";
  setBusy(true);

  const pendingMessage = addMessage("Thinking…", "assistant");
  statusElement.textContent = webToggle.checked
    ? "Checking local knowledge and the web…"
    : "Offline mode…";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: userMessage,
        session_id: sessionId,
        allow_web: webToggle.checked,
      }),
    });

    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}`);
    }

    const result = await response.json();
    pendingMessage.remove();
    addMessage(
      result.answer,
      "assistant",
      `${result.mode} • ${Math.round(result.confidence * 100)}% confidence`,
      result.sources,
    );
    setReadyStatus();
  } catch (error) {
    pendingMessage.textContent = "Mini-GPT is unavailable. Verify that the server is running.";
    statusElement.textContent = "Connection error";
    console.error(error);
  } finally {
    setBusy(false);
    promptInput.focus();
  }
});

promptInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}

webToggle.addEventListener("change", setReadyStatus);
loadEngineStatus();

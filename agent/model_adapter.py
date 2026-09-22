from __future__ import annotations

import json
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


SYSTEM_PROMPT = """You are Nava, Amin's private local AI assistant.
Reply in the same language as the user, including natural Persian when the user writes Persian.
Be warm, direct, concise, and useful. Ask one clear follow-up question when essential information is missing.
Use supplied context only when it is relevant. Never invent facts, memories, sources, or personal experiences.
Do not expose private chain-of-thought. Give only the final answer and a brief explanation when useful.
You are software with an empathetic conversational style, not a conscious person."""


class LanguageEngine(Protocol):
    def answer(
        self,
        prompt: str,
        context: str = "",
        history: list[dict] | None = None,
    ) -> tuple[str, float]: ...


class OllamaEngine:
    """Chat engine backed by Ollama's local HTTP API."""

    def __init__(
        self,
        base_url: str,
        model: str,
        timeout: float = 120,
        context_length: int = 4096,
        opener=None,
    ):
        self.base_url = base_url.rstrip("/")
        self.model_name = model
        self.timeout = timeout
        self.context_length = context_length
        self._opener = opener or urlopen
        self._available: bool | None = None
        self._error: str | None = None

    def _request(self, path: str, payload: dict | None = None, timeout: float | None = None) -> dict:
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.base_url}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="GET" if data is None else "POST",
        )
        with self._opener(request, timeout=timeout or self.timeout) as response:
            return json.loads(response.read().decode("utf-8"))

    def _check_available(self) -> bool:
        if self._available is not None:
            return self._available
        try:
            response = self._request("/api/tags", timeout=min(2.0, self.timeout))
            names = {
                model.get("name") or model.get("model")
                for model in response.get("models", [])
            }
            self._available = self.model_name in names
            if not self._available:
                self._error = f"Ollama is running, but model '{self.model_name}' is not installed."
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            self._available = False
            self._error = f"Ollama is unavailable: {type(exc).__name__}: {exc}"
        return self._available

    @property
    def available(self) -> bool:
        return self._check_available()

    @property
    def error(self) -> str | None:
        self._check_available()
        return self._error

    def answer(
        self,
        prompt: str,
        context: str = "",
        history: list[dict] | None = None,
    ) -> tuple[str, float]:
        if not self.available:
            return "The local Ollama model is unavailable.", 0.05

        system = SYSTEM_PROMPT
        if context:
            system += f"\n\nRelevant local or researched context:\n{context[:3500]}"
        messages = [{"role": "system", "content": system}]
        for item in (history or [])[-6:]:
            role = item.get("role")
            content = str(item.get("content", "")).strip()
            if role in {"user", "assistant"} and content:
                messages.append({"role": role, "content": content[:1500]})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model_name,
            "messages": messages,
            "stream": False,
            "think": False,
            "keep_alive": "30m",
            "options": {
                "temperature": 0.55,
                "top_p": 0.9,
                "repeat_penalty": 1.1,
                "num_ctx": self.context_length,
                "num_predict": 320,
            },
        }
        try:
            response = self._request("/api/chat", payload)
            content = str(response.get("message", {}).get("content", "")).strip()
        except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
            self._error = f"Ollama request failed: {type(exc).__name__}: {exc}"
            return "The local Ollama model could not answer this request.", 0.05
        if not content:
            return "I could not produce a useful answer yet.", 0.1
        # The model is capable of fluent conversation, but factual confidence
        # remains conservative so online questions can still use retrieval.
        return content, 0.5


class LocalMiniGPTEngine:
    def __init__(self):
        self._generator = None
        self._error: str | None = None

    def _load(self):
        if self._generator is not None or self._error is not None:
            return
        try:
            from src.inference import generate_text

            self._generator = generate_text
        except Exception as exc:  # TensorFlow is an optional heavy runtime dependency.
            self._error = f"{type(exc).__name__}: {exc}"

    @property
    def available(self) -> bool:
        self._load()
        return self._generator is not None

    @property
    def error(self) -> str | None:
        self._load()
        return self._error

    def answer(
        self,
        prompt: str,
        context: str = "",
        history: list[dict] | None = None,
    ) -> tuple[str, float]:
        normalized = prompt.strip().casefold().rstrip(".!؟?")
        greetings = {
            "hello": "Hello! I'm Mini-GPT. How can I help you?",
            "hi": "Hi! What would you like to talk about?",
            "سلام": "سلام امین! چه چیزی می‌خواهی بدانیم یا با هم بسازیم؟",
            "سلام خوبی": "سلام امین! خوبم و آماده‌ام. تو چطوری؟",
        }
        if normalized in greetings:
            return greetings[normalized], 0.95
        self._load()
        if self._generator is None:
            fallback = "I do not have enough local knowledge to answer that reliably."
            return fallback, 0.1
        model_prompt = prompt if not context else f"Context: {context[:1000]}\nUser: {prompt}\nAssistant:"
        generated = self._generator(model_prompt, max_new_words=48, temperature=0.65, top_k=12)
        completion = generated[len(model_prompt):].strip() if generated.startswith(model_prompt) else generated.strip()
        if not completion:
            return "I am not sure yet.", 0.15
        words = completion.casefold().split()
        unique_ratio = len(set(words)) / max(1, len(words))
        adjacent_repeats = sum(left == right for left, right in zip(words, words[1:]))
        length_score = min(1.0, len(words) / 18)
        confidence = 0.08 + unique_ratio * 0.12 + length_score * 0.1
        confidence -= min(0.15, adjacent_repeats * 0.05)
        # The bundled checkpoint is educational and story-trained. It must not
        # claim high factual confidence without retrieved evidence.
        return completion, max(0.05, min(confidence, 0.3))


class DeterministicFallbackEngine:
    """Keeps the app useful when TensorFlow or the checkpoint is unavailable."""

    def answer(
        self,
        prompt: str,
        context: str = "",
        history: list[dict] | None = None,
    ) -> tuple[str, float]:
        if context:
            return f"Based on my saved knowledge: {context[:700]}", 0.45
        return "I do not have enough reliable offline knowledge about that yet.", 0.1

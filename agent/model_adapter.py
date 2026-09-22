from __future__ import annotations

from typing import Protocol


class LanguageEngine(Protocol):
    def answer(self, prompt: str, context: str = "") -> tuple[str, float]: ...


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

    def answer(self, prompt: str, context: str = "") -> tuple[str, float]:
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

    def answer(self, prompt: str, context: str = "") -> tuple[str, float]:
        if context:
            return f"Based on my saved knowledge: {context[:700]}", 0.45
        return "I do not have enough reliable offline knowledge about that yet.", 0.1

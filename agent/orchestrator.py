from __future__ import annotations

import re
import uuid

from .config import AgentConfig
from .memory import MemoryStore
from .model_adapter import DeterministicFallbackEngine, LanguageEngine, LocalMiniGPTEngine
from .personality import apply_personality
from .search import CompositeSearchProvider, DuckDuckGoSearchProvider, SearchProvider, WikipediaSearchProvider
from .text import best_excerpt, lexical_score, looks_persian
from .types import AgentAnswer, Evidence, SourceDocument


FRESHNESS_TERMS = {
    "today", "latest", "current", "now", "price", "weather", "news", "2025", "2026",
    "امروز", "جدید", "آخرین", "الان", "قیمت", "هوا", "خبر", "فعلی",
}
QUESTION_WORDS = {"what", "who", "when", "where", "why", "how", "چی", "چه", "کی", "کجا", "چرا", "چطور"}


class MiniGPTAgent:
    def __init__(
        self,
        config: AgentConfig | None = None,
        engine: LanguageEngine | None = None,
        search_provider: SearchProvider | None = None,
        memory: MemoryStore | None = None,
    ):
        self.config = config or AgentConfig()
        self.memory = memory or MemoryStore(self.config.database_path)
        primary_engine = engine or LocalMiniGPTEngine()
        if isinstance(primary_engine, LocalMiniGPTEngine) and not primary_engine.available:
            primary_engine = DeterministicFallbackEngine()
        self.engine = primary_engine
        self.search_provider = search_provider or CompositeSearchProvider(
            [WikipediaSearchProvider(self.config.request_timeout), DuckDuckGoSearchProvider(self.config.request_timeout)]
        )

    @staticmethod
    def _clarification(message: str) -> str | None:
        words = message.strip().split()
        vague = {"این", "اون", "آن", "it", "this", "that"}
        if len(words) <= 2 and any(word.casefold() in vague for word in words):
            return "دقیقاً درباره چه موضوعی می‌خواهی بدانم؟ یک نام یا توضیح کوتاه اضافه کن."
        if not message.strip():
            return "چه چیزی می‌خواهی از من بپرسی؟"
        return None

    @staticmethod
    def _normalized_message(message: str) -> str:
        lowered = message.casefold().replace("؟", " ")
        return re.sub(r"[^\w\u0600-\u06ff]+", " ", lowered).strip()

    @classmethod
    def _casual_response(cls, message: str) -> str | None:
        normalized = cls._normalized_message(message)
        wellbeing = {
            "how are you", "how are u", "how r you", "how r u", "how is it going",
            "how s it going", "حالت چطوره", "حالت چطور است", "خوبی", "چطوری",
        }
        identity = (
            "do you know me",
            "who am i",
            "i am your creator",
            "i m your creator",
            "منو میشناسی",
            "من را می شناسی",
            "من سازنده تو هستم",
        )
        thanks = {"thanks", "thank you", "مرسی", "ممنون", "متشکرم"}
        goodbyes = {"bye", "goodbye", "خداحافظ", "فعلا"}
        greetings = {
            "hello", "hi", "hey", "سلام", "درود", "صبح بخیر", "شب بخیر",
        }
        help_requests = {
            "help", "help me", "i need help", "i need your help", "can you help me",
            "could you help me", "i want help", "کمک", "کمکم کن", "کمک میخوام", "کمک می خوام",
            "کمک می خواهم", "به کمک نیاز دارم", "میشه کمکم کنی", "می تونی کمکم کنی",
        }
        persian_requests = {
            "فارسی", "فارسی صحبت کن", "فارسی حرف بزن", "فارسی میفهمی", "فارسی می فهمی",
            "فارسی بلدی", "persian", "speak persian", "do you speak persian",
        }

        if normalized in greetings:
            if looks_persian(message):
                return "سلام امین! من اینجام. چطور می‌توانم کمکت کنم؟"
            return "Hello, Amin! I'm here. How can I help?"
        if normalized in wellbeing:
            if looks_persian(message):
                return "خوبم امین، ممنون. آماده‌ام با هم روی پروژه کار کنیم یا درباره هر موضوعی صحبت کنیم."
            return "I'm doing well, Amin—thanks for asking. What would you like to work on?"
        if any(phrase in normalized for phrase in identity):
            if looks_persian(message):
                return "بله، تو را به نام امین می‌شناسم؛ کسی که این پروژه Mini-GPT را ساخته و توسعه می‌دهد. فقط اطلاعاتی را نگه می‌دارم که خودت صریحاً به من بگویی یا بخواهی به خاطر بسپارم."
            return "Yes. I know you as Amin, the person building and improving this Mini-GPT project. I only retain information you explicitly share or ask me to remember."
        if normalized in thanks:
            return "خواهش می‌کنم امین." if looks_persian(message) else "You're welcome, Amin."
        if normalized in goodbyes:
            return "فعلاً امین؛ هر وقت خواستی برگرد." if looks_persian(message) else "See you, Amin."
        if normalized in help_requests:
            if looks_persian(message):
                return "حتماً امین. بگو دقیقاً در چه موضوعی کمک می‌خواهی؟"
            return "Of course, Amin. Tell me what you need help with."
        if normalized in persian_requests:
            return "بله امین، فارسی را می‌فهمم و می‌توانم فارسی با تو صحبت کنم. چه کمکی می‌خواهی؟"
        return None

    @staticmethod
    def _requests_memory(message: str) -> bool:
        lowered = message.casefold()
        return any(phrase in lowered for phrase in ("remember that", "به خاطر بسپار", "یادت بمونه", "یادت بماند"))

    @staticmethod
    def _memory_content(message: str) -> str:
        patterns = (
            r"^\s*remember that\s+",
            r"^\s*به خاطر بسپار(?:\s+که)?\s+",
            r"^\s*یادت بمونه(?:\s+که)?\s+",
            r"^\s*یادت بماند(?:\s+که)?\s+",
        )
        content = message
        for pattern in patterns:
            content = re.sub(pattern, "", content, count=1, flags=re.I)
        return content.strip(" .،") or message

    @staticmethod
    def _needs_fresh_information(message: str) -> bool:
        lowered = message.casefold()
        return any(term in lowered for term in FRESHNESS_TERMS)

    @staticmethod
    def _is_question(message: str) -> bool:
        lowered = message.casefold().strip()
        return (
            "?" in message
            or "؟" in message
            or any(lowered == word or lowered.startswith(f"{word} ") for word in QUESTION_WORDS)
        )

    @staticmethod
    def _next_query(original: str, round_number: int, evidence: list[Evidence]) -> str:
        if round_number == 1:
            return original
        weak_terms = " ".join(re.findall(r"[\w\u0600-\u06ff]+", original)[:8])
        if round_number == 2:
            return f"{weak_terms} official explanation"
        known_titles = " ".join(item.document.title for item in evidence[-2:])
        return f"{weak_terms} facts sources {known_titles[:100]}"

    def _cached_context(self, message: str) -> tuple[str, float]:
        parts: list[str] = []
        scores: list[float] = []
        for item in self.memory.relevant_memories(message):
            content = item["content"]
            parts.append(content)
            scores.append(lexical_score(message, content))
        for item in self.memory.search_cached_documents(message):
            excerpt, score = best_excerpt(message, item["content"], sentence_limit=2)
            if excerpt and score >= 0.18:
                parts.append(excerpt)
                scores.append(score)
        return "\n".join(parts[:5]), max(scores, default=0.0)

    def _collect_evidence(self, message: str) -> tuple[list[Evidence], int, float]:
        evidence: list[Evidence] = []
        seen: set[str] = set()
        confidence = 0.0
        completed_rounds = 0
        for round_number in range(1, self.config.max_search_rounds + 1):
            completed_rounds = round_number
            query = self._next_query(message, round_number, evidence)
            documents = self.search_provider.search(query, self.config.results_per_round)
            if not documents:
                break
            for document in documents:
                key = document.url or document.title.casefold()
                if key in seen:
                    continue
                seen.add(key)
                excerpt, score = best_excerpt(message, document.text, sentence_limit=2)
                if score < 0.12 or not excerpt:
                    continue
                evidence.append(Evidence(document=document, excerpt=excerpt, score=score))
                self.memory.cache_document(document.url, document.title, document.text, document.provider)
            evidence.sort(key=lambda item: item.score, reverse=True)
            source_factor = min(1.0, len(evidence) / max(1, self.config.min_sources))
            relevance = sum(item.score for item in evidence[:3]) / max(1, min(3, len(evidence)))
            confidence = min(0.95, relevance * 0.7 + source_factor * 0.3)
            if len(evidence) >= self.config.min_sources and confidence >= self.config.min_confidence:
                break
        return evidence, completed_rounds, confidence

    @staticmethod
    def _evidence_answer(message: str, evidence: list[Evidence]) -> str:
        chosen = evidence[:3]
        if not chosen:
            return "اطلاعات قابل‌اعتماد کافی پیدا نکردم. می‌توانی سؤال را دقیق‌تر کنی؟" if looks_persian(message) else "I could not find enough reliable information. Could you make the question more specific?"
        items = [f"{item.excerpt[:450].strip()} [{index}]" for index, item in enumerate(chosen, start=1)]
        if looks_persian(message):
            return "خلاصه منابع:\n\n" + "\n\n".join(items)
        return "Summary from the available sources:\n\n" + "\n\n".join(items)

    @staticmethod
    def _insufficient_answer(message: str) -> str:
        if looks_persian(message):
            return "دانش آفلاین من برای پاسخ مطمئن به این سؤال کافی نیست. اینترنت را فعال کن یا اطلاعات بیشتری در اختیارم بگذار."
        return "My offline knowledge is not sufficient for a reliable answer. Enable web search or give me more context."

    @staticmethod
    def _unclear_message_answer(message: str) -> str:
        if looks_persian(message):
            return "منظورت را کامل متوجه نشدم. لطفاً کمی واضح‌تر یا کامل‌تر بنویس تا درست کمکت کنم."
        return "I didn't fully understand that. Please add a little more detail so I can help properly."

    def chat(self, message: str, session_id: str | None = None, allow_web: bool = True) -> AgentAnswer:
        session_id = session_id or str(uuid.uuid4())
        message = message.strip()
        clarification = self._clarification(message)
        if clarification:
            return AgentAnswer(clarification, "clarification", 1.0, needs_clarification=True)

        self.memory.add_message(session_id, "user", message)
        learned = False
        if self._requests_memory(message) or self.config.remember_by_default:
            learned = self.memory.remember(
                self._memory_content(message),
                {"source": "user", "session_id": session_id},
            )

        casual_answer = self._casual_response(message)
        if casual_answer:
            result = AgentAnswer(casual_answer, "conversation", 0.98, learned=learned)
            self.memory.add_message(session_id, "assistant", result.answer)
            return result

        context, context_score = self._cached_context(message)
        local_answer, local_confidence = self.engine.answer(message, context)
        if context and self._is_question(message):
            cached_excerpt, cached_score = best_excerpt(message, context, sentence_limit=3)
            if cached_excerpt and cached_score >= 0.18:
                if looks_persian(message):
                    local_answer = "بر اساس دانش ذخیره‌شده محلی:\n\n" + cached_excerpt
                else:
                    local_answer = "Based on locally saved knowledge:\n\n" + cached_excerpt
                local_confidence = max(local_confidence, min(0.82, 0.35 + cached_score * 0.5))
        must_search = self._needs_fresh_information(message)
        should_search = allow_web and not self.config.offline_only and self._is_question(message) and (
            must_search or max(local_confidence, context_score) < self.config.min_confidence
        )

        if should_search:
            try:
                evidence, rounds, web_confidence = self._collect_evidence(message)
            except Exception:
                evidence, rounds, web_confidence = [], 0, 0.0
            if evidence:
                answer = self._evidence_answer(message, evidence)
                sources = [item.document for item in evidence[:3]]
                result = AgentAnswer(answer, "web", web_confidence, sources, rounds, learned=learned)
            else:
                safe_answer = local_answer if local_confidence >= 0.35 or context else self._insufficient_answer(message)
                result = AgentAnswer(
                    safe_answer,
                    "offline-fallback",
                    local_confidence,
                    search_rounds=rounds,
                    learned=learned,
                )
        else:
            mode = "memory" if context else "offline"
            confidence = max(local_confidence, context_score)
            safe_answer = local_answer
            if confidence < 0.35 and not context:
                safe_answer = (
                    self._insufficient_answer(message)
                    if self._is_question(message)
                    else self._unclear_message_answer(message)
                )
            result = AgentAnswer(safe_answer, mode, confidence, learned=learned)

        result.answer = apply_personality(result.answer, message)
        self.memory.add_message(session_id, "assistant", result.answer)
        return result

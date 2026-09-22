from __future__ import annotations

from pathlib import Path

from agent.config import AgentConfig
from agent.memory import MemoryStore
from agent.orchestrator import MiniGPTAgent
from agent.search import CompositeSearchProvider
from agent.text import best_excerpt, lexical_score, normalize_text
from agent.types import SourceDocument


class FakeEngine:
    def __init__(self, answer="local answer", confidence=0.2):
        self.response = answer, confidence

    def answer(self, prompt: str, context: str = ""):
        return self.response


class FakeSearch:
    def __init__(self):
        self.calls = 0

    def search(self, query: str, limit: int = 4):
        self.calls += 1
        return [
            SourceDocument(
                f"Source {self.calls}",
                f"https://example.com/{self.calls}",
                "Python is a programming language. Python is used for machine learning and web development.",
                "fake",
            )
        ]


def make_agent(tmp_path: Path, engine=None, search=None, **overrides):
    values = {
        "database_path": tmp_path / "memory.db",
        "max_search_rounds": 3,
        "results_per_round": 4,
        "min_sources": 2,
        "min_confidence": 0.3,
    }
    values.update(overrides)
    config = AgentConfig(**values)
    return MiniGPTAgent(config, engine or FakeEngine(), search or FakeSearch())


def test_html_is_cleaned():
    assert normalize_text("<style>x</style><p>Hello <b>world</b></p>") == "Hello world"


def test_best_excerpt_prefers_relevant_sentence():
    excerpt, score = best_excerpt("machine learning", "Cats are friendly animals. Machine learning trains useful models.")
    assert "Machine learning" in excerpt
    assert score > 0


def test_memory_round_trip(tmp_path):
    store = MemoryStore(tmp_path / "db.sqlite")
    assert store.remember("Amin likes Python")
    assert not store.remember("Amin likes Python")
    assert store.relevant_memories("What does Amin like?")[0]["content"] == "Amin likes Python"


def test_agent_uses_offline_when_confident(tmp_path):
    search = FakeSearch()
    agent = make_agent(tmp_path, FakeEngine("known answer", 0.9), search)
    result = agent.chat("What is Python?", allow_web=True)
    assert result.mode == "offline"
    assert search.calls == 0


def test_agent_searches_until_enough_sources(tmp_path):
    search = FakeSearch()
    agent = make_agent(tmp_path, FakeEngine(confidence=0.1), search)
    result = agent.chat("What is Python?", allow_web=True)
    assert result.mode == "web"
    assert result.search_rounds == 2
    assert len(result.sources) == 2


def test_agent_falls_back_when_web_returns_nothing(tmp_path):
    class EmptySearch:
        def search(self, query, limit=4):
            return []

    agent = make_agent(tmp_path, FakeEngine("offline result", 0.1), EmptySearch())
    result = agent.chat("What is an unknown thing?", allow_web=True)
    assert result.mode == "offline-fallback"
    assert result.search_rounds == 1
    assert "not sufficient" in result.answer


def test_agent_asks_for_clarification(tmp_path):
    agent = make_agent(tmp_path)
    result = agent.chat("این چیه؟")
    assert result.needs_clarification
    assert result.mode == "clarification"


def test_explicit_memory_is_saved(tmp_path):
    agent = make_agent(tmp_path, FakeEngine(confidence=0.9))
    result = agent.chat("به خاطر بسپار که رنگ مورد علاقه من آبی است", allow_web=False)
    assert result.learned
    memories = agent.memory.list_memories()
    assert memories[0]["content"] == "رنگ مورد علاقه من آبی است"


def test_low_confidence_offline_question_is_honest(tmp_path):
    agent = make_agent(tmp_path, FakeEngine("made up answer", 0.1))
    result = agent.chat("What is something obscure?", allow_web=False)
    assert result.mode == "offline"
    assert "not sufficient" in result.answer


def test_composite_search_uses_multiple_providers():
    class Provider:
        def __init__(self, name):
            self.name = name

        def search(self, query, limit=4):
            return [SourceDocument(self.name, f"https://{self.name}.example", query, self.name)]

    provider = CompositeSearchProvider([Provider("one"), Provider("two")])
    results = provider.search("query", limit=4)
    assert {item.provider for item in results} == {"one", "two"}


def test_cached_knowledge_supports_offline_answer(tmp_path):
    agent = make_agent(tmp_path, FakeEngine("bad model text", 0.1))
    agent.memory.cache_document(
        "https://example.com/python",
        "Python",
        "Python is a programming language used for machine learning and web applications.",
        "test",
    )
    result = agent.chat("What is Python?", allow_web=False)
    assert result.mode == "memory"
    assert "locally saved knowledge" in result.answer
    assert "programming language" in result.answer


def test_casual_question_does_not_use_cached_web_content(tmp_path):
    search = FakeSearch()
    agent = make_agent(tmp_path, FakeEngine("irrelevant model text", 0.1), search)
    agent.memory.cache_document(
        "https://example.com/noisy",
        "How are you examples",
        "<nav>Menu Home Fashion Finance</nav> Thirty ways to say how are you.",
        "test",
    )

    result = agent.chat("how are u?", allow_web=True)

    assert result.mode == "conversation"
    assert result.confidence == 0.98
    assert search.calls == 0
    assert "doing well" in result.answer
    assert "saved knowledge" not in result.answer


def test_creator_question_gets_concise_identity_response(tmp_path):
    search = FakeSearch()
    agent = make_agent(tmp_path, FakeEngine("irrelevant model text", 0.1), search)

    result = agent.chat("I am your creator, do you know me?", allow_web=True)

    assert result.mode == "conversation"
    assert search.calls == 0
    assert "Amin" in result.answer
    assert len(result.answer) < 250


def test_help_request_does_not_use_irrelevant_memory(tmp_path):
    search = FakeSearch()
    agent = make_agent(tmp_path, FakeEngine("day day", 0.78), search)
    agent.memory.remember("day day")

    result = agent.chat("I need help", allow_web=True)

    assert result.mode == "conversation"
    assert result.confidence == 0.98
    assert result.answer == "Of course, Amin. Tell me what you need help with."
    assert search.calls == 0


def test_persian_help_request_is_conversational(tmp_path):
    agent = make_agent(tmp_path, FakeEngine("متن نامرتبط", 0.9))

    result = agent.chat("کمک می‌خوام", allow_web=False)

    assert result.mode == "conversation"
    assert "دقیقاً در چه موضوعی" in result.answer


def test_persian_language_question_is_conversational(tmp_path):
    search = FakeSearch()
    agent = make_agent(tmp_path, FakeEngine("random story text", 0.19), search)

    result = agent.chat("فارسی میفهمی؟", allow_web=True)

    assert result.mode == "conversation"
    assert "فارسی را می‌فهمم" in result.answer
    assert search.calls == 0


def test_language_switch_word_is_conversational(tmp_path):
    agent = make_agent(tmp_path, FakeEngine("random story text", 0.19))

    result = agent.chat("فارسی", allow_web=False)

    assert result.mode == "conversation"
    assert "فارسی" in result.answer
    assert "random story" not in result.answer


def test_low_confidence_statement_never_exposes_model_gibberish(tmp_path):
    agent = make_agent(tmp_path, FakeEngine("day day random story", 0.19))

    result = agent.chat("یک جمله نامشخص", allow_web=False)

    assert result.mode == "offline"
    assert "کامل متوجه نشدم" in result.answer
    assert "day day" not in result.answer


def test_lexical_score_ignores_generic_question_words():
    assert lexical_score("how are u?", "How are you? Menu Home Contact") == 0


def test_html_cleaner_removes_navigation_boilerplate():
    value = "<nav>Menu Home Contact</nav><main>Python is useful.</main><footer>Terms</footer>"
    assert normalize_text(value) == "Python is useful."

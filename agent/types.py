from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(slots=True)
class SourceDocument:
    title: str
    url: str
    text: str
    provider: str = "web"


@dataclass(slots=True)
class Evidence:
    document: SourceDocument
    excerpt: str
    score: float


@dataclass(slots=True)
class AgentAnswer:
    answer: str
    mode: str
    confidence: float
    sources: list[SourceDocument] = field(default_factory=list)
    search_rounds: int = 0
    needs_clarification: bool = False
    learned: bool = False

    def to_dict(self) -> dict:
        return {
            "answer": self.answer,
            "mode": self.mode,
            "confidence": round(self.confidence, 3),
            "search_rounds": self.search_rounds,
            "needs_clarification": self.needs_clarification,
            "learned": self.learned,
            "sources": [
                {"title": source.title, "url": source.url, "provider": source.provider}
                for source in self.sources
            ],
        }

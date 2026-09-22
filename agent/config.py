from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


@dataclass(slots=True)
class AgentConfig:
    database_path: Path = field(
        default_factory=lambda: Path(
            os.getenv("MINIGPT_DB_PATH", ROOT / "runtime" / "minigpt.db")
        )
    )
    max_search_rounds: int = int(os.getenv("MINIGPT_MAX_SEARCH_ROUNDS", "3"))
    results_per_round: int = int(os.getenv("MINIGPT_RESULTS_PER_ROUND", "4"))
    min_sources: int = int(os.getenv("MINIGPT_MIN_SOURCES", "2"))
    min_confidence: float = float(os.getenv("MINIGPT_MIN_CONFIDENCE", "0.55"))
    request_timeout: float = float(os.getenv("MINIGPT_REQUEST_TIMEOUT", "5"))
    offline_only: bool = os.getenv("MINIGPT_OFFLINE", "0") == "1"
    remember_by_default: bool = os.getenv("MINIGPT_REMEMBER", "0") == "1"
    max_context_messages: int = int(os.getenv("MINIGPT_CONTEXT_MESSAGES", "6"))
    ollama_enabled: bool = os.getenv("MINIGPT_OLLAMA_ENABLED", "1") == "1"
    ollama_url: str = os.getenv("MINIGPT_OLLAMA_URL", "http://127.0.0.1:11434")
    ollama_model: str = os.getenv("MINIGPT_OLLAMA_MODEL", "qwen3:4b")
    ollama_timeout: float = float(os.getenv("MINIGPT_OLLAMA_TIMEOUT", "120"))
    ollama_context_length: int = int(os.getenv("MINIGPT_OLLAMA_CONTEXT", "2048"))

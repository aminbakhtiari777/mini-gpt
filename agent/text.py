from __future__ import annotations

import html
import re
from collections import Counter


WORD_RE = re.compile(r"[\w\u0600-\u06ff]+", re.UNICODE)
SENTENCE_RE = re.compile(r"(?<=[.!?؟])\s+|\n+")


def normalize_text(value: str) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"<script\b[^>]*>.*?</script>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<style\b[^>]*>.*?</style>", " ", value, flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def tokens(value: str) -> list[str]:
    return [token.casefold() for token in WORD_RE.findall(value)]


def sentences(value: str) -> list[str]:
    return [part.strip() for part in SENTENCE_RE.split(normalize_text(value)) if len(part.strip()) > 20]


def lexical_score(query: str, text: str) -> float:
    query_tokens = set(tokens(query))
    if not query_tokens:
        return 0.0
    counts = Counter(tokens(text))
    hits = sum(min(counts[token], 3) for token in query_tokens)
    coverage = sum(1 for token in query_tokens if counts[token]) / len(query_tokens)
    return min(1.0, (hits / max(1, len(query_tokens) * 2)) + coverage * 0.55)


def best_excerpt(query: str, text: str, sentence_limit: int = 3) -> tuple[str, float]:
    ranked = sorted(
        ((lexical_score(query, sentence), index, sentence) for index, sentence in enumerate(sentences(text))),
        reverse=True,
    )
    selected = sorted(ranked[:sentence_limit], key=lambda item: item[1])
    if not selected:
        clean = normalize_text(text)
        return clean[:700], lexical_score(query, clean)
    excerpt = " ".join(item[2] for item in selected)
    return excerpt[:1200], sum(item[0] for item in selected) / len(selected)


def looks_persian(value: str) -> bool:
    chars = re.findall(r"[\u0600-\u06ff]", value)
    return len(chars) >= 2

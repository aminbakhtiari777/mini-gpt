from __future__ import annotations

import re
import json
import math
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, unquote, urlencode, urlparse
from urllib.request import Request, urlopen

from .text import looks_persian, normalize_text
from .types import SourceDocument


class SearchProvider(Protocol):
    def search(self, query: str, limit: int = 4) -> list[SourceDocument]: ...


class WikipediaSearchProvider:
    """No-key factual search with full article extracts."""

    def __init__(self, timeout: float = 8):
        self.timeout = timeout

    def search(self, query: str, limit: int = 4) -> list[SourceDocument]:
        language = "fa" if looks_persian(query) else "en"
        endpoint = f"https://{language}.wikipedia.org/w/api.php"
        params = {
            "action": "query",
            "generator": "search",
            "gsrsearch": query,
            "gsrlimit": limit,
            "prop": "extracts|info",
            "explaintext": 1,
            "exintro": 0,
            "inprop": "url",
            "format": "json",
            "formatversion": 2,
        }
        request = Request(f"{endpoint}?{urlencode(params)}", headers={"User-Agent": "MiniGPT-Agent/1.0"})
        with urlopen(request, timeout=self.timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
        pages = payload.get("query", {}).get("pages", [])
        return [
            SourceDocument(
                title=page.get("title", "Wikipedia"),
                url=page.get("fullurl", ""),
                text=normalize_text(page.get("extract", "")),
                provider="wikipedia",
            )
            for page in pages
            if page.get("extract")
        ]


class DuckDuckGoSearchProvider:
    """General web search using the lightweight HTML endpoint, without an API key."""

    SEARCH_URL = "https://html.duckduckgo.com/html/"

    def __init__(self, timeout: float = 8):
        self.timeout = timeout
        self.headers = {"User-Agent": "MiniGPT-Agent/1.0 (+local educational project)"}

    @staticmethod
    def _real_url(value: str) -> str:
        parsed = urlparse(value)
        target = parse_qs(parsed.query).get("uddg", [value])[0]
        return unquote(target)

    def _fetch_document(self, result: tuple[str, str]) -> SourceDocument | None:
        href, title_html = result
        url = self._real_url(href)
        try:
            page_request = Request(url, headers=self.headers)
            with urlopen(page_request, timeout=self.timeout) as page:
                page_html = page.read().decode("utf-8", errors="replace")
        except (HTTPError, URLError, TimeoutError, ValueError):
            return None
        text = normalize_text(page_html)
        if len(text) < 200:
            return None
        return SourceDocument(
            title=normalize_text(title_html),
            url=url,
            text=text[:30000],
            provider="duckduckgo",
        )

    def search(self, query: str, limit: int = 4) -> list[SourceDocument]:
        body = urlencode({"q": query}).encode("utf-8")
        request = Request(self.SEARCH_URL, data=body, headers=self.headers, method="POST")
        with urlopen(request, timeout=self.timeout) as response:
            search_html = response.read().decode("utf-8", errors="replace")
        result_pattern = re.compile(
            r'class="result__a"[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.I | re.S
        )
        results = result_pattern.findall(search_html)[:limit]
        documents: list[SourceDocument] = []
        with ThreadPoolExecutor(max_workers=max(1, len(results))) as executor:
            futures = [executor.submit(self._fetch_document, result) for result in results]
            for future in as_completed(futures):
                document = future.result()
                if document is not None:
                    documents.append(document)
        return documents


class CompositeSearchProvider:
    def __init__(self, providers: list[SearchProvider]):
        self.providers = providers

    def search(self, query: str, limit: int = 4) -> list[SourceDocument]:
        documents: list[SourceDocument] = []
        seen: set[str] = set()
        per_provider = max(2, math.ceil(limit / max(1, len(self.providers))))
        provider_results: list[list[SourceDocument]] = []
        with ThreadPoolExecutor(max_workers=max(1, len(self.providers))) as executor:
            futures = [executor.submit(provider.search, query, per_provider) for provider in self.providers]
            for future in futures:
                try:
                    provider_results.append(future.result())
                except (HTTPError, URLError, TimeoutError, ValueError, KeyError, OSError):
                    provider_results.append([])
        for results in provider_results:
            for document in results:
                key = document.url or document.title.casefold()
                if key in seen:
                    continue
                seen.add(key)
                documents.append(document)
        return documents[:limit]

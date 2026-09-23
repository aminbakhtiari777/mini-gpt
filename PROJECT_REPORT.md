# Zamis Local AI Lab — Engineering Report

## Executive summary

Zamis is a bilingual Persian-English assistant prototype created to study local-first AI under real resource constraints. It began as a small Transformer learning project and expanded into an agent backend, persistent memory system, retrieval pipeline, FastAPI service, Docker setup, web interface, and an experimental on-device iPad edition.

The project reached its primary research goal: it demonstrated a complete request-to-response system and identified the boundary between feasible on-device features and features that require stronger compute or a secure cloud backend.

**Final classification:** functional engineering prototype; archived as a portfolio case study.

## Problem statement

The target experience combined several demanding requirements:

- understand conversational Persian and English;
- accept typed and spoken input;
- maintain explicit long-term memory;
- answer from local knowledge when offline;
- search for evidence when online;
- run privately on an iPad without a permanent desktop server;
- remain installable and usable as a Progressive Web App.

No single low-resource runtime satisfies all of these goals at production quality. Zamis therefore explored two complementary architectures.

## Architecture A — Python agent

The backend edition uses FastAPI and a modular agent pipeline:

1. validate the request and session;
2. classify conversational, factual, ambiguous, and memory-related intent;
3. retrieve relevant explicit memories and cached documents;
4. query the configured local model;
5. route low-confidence factual requests to bounded web retrieval;
6. clean, rank, and deduplicate evidence;
7. compose a response with mode, confidence, and sources;
8. persist conversation state.

Inference choices:

- bundled 5,216,912-parameter educational Transformer;
- optional Ollama instruction model;
- deterministic responses for a narrow set of high-confidence interactions;
- honest fallback when evidence is insufficient.

## Architecture B — iPad WebGPU prototype

The iPad edition uses browser-native technologies:

- WebLLM and WebGPU for quantized model inference;
- IndexedDB for messages and explicit memories;
- Web Audio and browser speech services for voice experiments;
- service workers for the PWA shell;
- PDF/text parsing for lightweight attachments;
- an optional serverless boundary for stronger transcription or reasoning.

The most recent local model experiment used `Qwen2.5-3B-Instruct-q4f16_1-MLC`.

## Validated behavior

The repository contains 23 Python behavior tests covering:

- HTML and navigation-noise cleaning;
- lexical evidence scoring;
- memory persistence and deduplication;
- local-confidence routing;
- bounded multi-round search;
- empty-network fallback;
- clarification for underspecified questions;
- explicit Persian memory extraction;
- conservative low-confidence answers;
- multi-provider retrieval;
- cached offline knowledge;
- casual conversation isolation from irrelevant web memory;
- creator identity behavior;
- Persian conversational fallbacks;
- Ollama history/context transfer and missing-model reporting.

The JavaScript voice smoke test covers wake phrases, armed-command routing, irrelevant-speech rejection, device-recognition event flow, PCM resampling, and valid WAV generation.

Static checks validate JavaScript syntax, JSON files, the PWA shell, and required DOM contracts.

## Resource assessment

### iPad edition

- Model download: approximately 2.5 GB for the selected browser build
- Runtime memory: several GB, varying with Safari/WebGPU/context state
- Storage headroom: at least 5 GB recommended for cache and temporary data
- Main risks: memory eviction, slow initialization, browser cache removal, thermal throttling, and PWA audio restrictions

### Desktop local edition

- Python 3.11
- 4–8 GB RAM for the educational stack
- approximately 3 GB free disk for the full environment
- 8–16 GB RAM and additional disk recommended for an Ollama instruction model

### Production-quality continuation

- secure HTTPS application backend;
- hosted model/API budget or workstation-class inference hardware;
- protected secret storage;
- authentication and per-device authorization;
- rate limiting and spend controls;
- structured logs, tracing, and health monitoring;
- evaluation corpus for Persian/English speech and text;
- native iPad development for background audio behavior.

## Findings

### Successful decisions

- separating model inference from memory and retrieval;
- treating low-confidence model output conservatively;
- making personal memory explicit and deletable;
- bounding web-search rounds and retained content;
- maintaining a lightweight runtime without TensorFlow;
- testing behavior rather than only testing individual functions;
- validating the iPad concept with a real installable PWA.

### Constraints discovered

- fitting a model into browser memory does not make it sufficiently intelligent;
- stronger local models raise memory and stability costs quickly;
- cached weights avoid re-downloading but not runtime initialization;
- browser voice APIs vary by execution mode and OS policy;
- an ordinary PWA cannot behave like Siri while closed or backgrounded;
- live research and high-quality speech need infrastructure, security, and recurring compute resources.

## Why the repository remains valuable

The project demonstrates practical AI engineering judgment. It includes model code, agent orchestration, retrieval, memory, APIs, voice processing, browser inference, packaging, tests, and documented limitations. Archiving the daily-use product while preserving the engineering work prevents misleading claims and makes the project stronger as a portfolio artifact.

## Recommended future version

A future implementation should be hybrid:

1. local wake detection and privacy controls;
2. realtime multilingual transcription;
3. hosted reasoning with controlled web tools;
4. local encrypted memory with selective context sharing;
5. natural cloud TTS with a device fallback;
6. a native iPad client if persistent audio is required.

## Environment variables for the desktop prototype

| Variable | Default | Purpose |
| --- | --- | --- |
| `MINIGPT_DB_PATH` | `runtime/minigpt.db` | SQLite database path |
| `MINIGPT_MAX_SEARCH_ROUNDS` | `3` | Retrieval round limit |
| `MINIGPT_RESULTS_PER_ROUND` | `4` | Results retained per round |
| `MINIGPT_MIN_SOURCES` | `2` | Evidence threshold |
| `MINIGPT_MIN_CONFIDENCE` | `0.55` | Local answer confidence threshold |
| `MINIGPT_REQUEST_TIMEOUT` | `5` | Network timeout in seconds |
| `MINIGPT_OFFLINE` | `0` | Disable external retrieval |
| `MINIGPT_REMEMBER` | `0` | Persist all user messages when enabled |
| `MINIGPT_OLLAMA_ENABLED` | `1` | Enable Ollama detection |
| `MINIGPT_OLLAMA_URL` | `http://127.0.0.1:11434` | Local Ollama endpoint |
| `MINIGPT_OLLAMA_MODEL` | `qwen3:1.7b` | Configured Ollama model |

## Archive decision

No production service is claimed. Source code, experiments, tests, and findings remain available for technical review. Further product development is intentionally paused until sufficient inference, backend, security, and evaluation resources are available.


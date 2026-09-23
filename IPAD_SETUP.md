# Zamis iPad Prototype — Archived Setup Notes

> [!CAUTION]
> This document is retained for engineering review. The iPad build is archived and is not recommended as a daily assistant because browser memory limits and the small local model prevent production-quality reliability.

This version runs the language model directly inside Safari through WebLLM and WebGPU. It does not use Python, FastAPI, Ollama, Tailscale, or a Windows computer after deployment.

## Requirements

- iPadOS 26 or newer
- Safari with WebGPU support
- At least 3 GB of free storage
- Internet access for the first model download

The final experiment used `Qwen2.5-3B-Instruct-q4f16_1-MLC`. Its browser package is approximately 2.5 GB and requires several GB of runtime memory. Model files are cached locally by the browser.

## Deployment with GitHub Pages

1. Open the repository **Settings** page on GitHub.
2. Select **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch `mini-gpt-agent-v1` and folder `/docs`.
5. Save and wait for the GitHub Pages URL to appear.

The expected URL is:

```text
https://aminbakhtiari777.github.io/mini-gpt/
```

## Historical first-run flow

1. Open the GitHub Pages URL in Safari.
2. Select **Download AI model** and keep Safari open until it reaches 100%.
3. Send a Persian and an English test message.
4. Select **Share → Add to Home Screen**.

After the model and application files are cached, local chat can work without a network connection. The optional Web toggle uses Wikipedia while online. General live-web search requires an external search service and is intentionally not embedded with a secret API key in the client application.

## Local data

- Recent chat messages and explicit memories are stored in Safari local storage.
- Model weights are stored in Safari-managed browser cache.
- Clearing Safari website data removes both the model cache and conversation data.
- iPadOS may evict browser cache under storage pressure, requiring a model re-download.

## Remove the prototype from iPad

1. Touch and hold the Zamis Home Screen icon.
2. Select **Remove App → Delete App**.
3. Open **Settings → Apps → Safari → Advanced → Website Data**.
4. Search for `aminbakhtiari777.github.io` and delete that entry.

This removes the model cache, local conversations, memories, and settings stored for the prototype.

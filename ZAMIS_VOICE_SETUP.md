# Zamis voice architecture

## What this version does

1. Keeps a foreground-only microphone standby while the installed PWA is open.
2. Uses local PCM audio and a local Whisper Tiny model only to detect `Zamis` / `زمیس`.
3. Does not save standby audio to IndexedDB, Cache Storage, localStorage, or the server.
4. After the wake word, sends the next bounded utterance to the secure `/api/transcribe` endpoint.
5. Shows the final transcript in the composer before submitting it.
6. Uses `/api/chat` for stronger intent correction and answers when a secure API URL is configured.
7. Falls back to the on-device speech and chat models when the cloud endpoint is unavailable.

## iPad limitation

An installed web app cannot provide Siri-style background wake-word detection after iPadOS suspends it. Voice standby works only while Zamis is open and the screen is awake. A native Swift app is required for deeper iPad integration, and even native background microphone use remains subject to Apple's platform policies.

## Secure deployment

The static GitHub Pages site must never contain `OPENAI_API_KEY`. Deploy the repository's `api/` directory on a serverless host that supports Vercel Edge Functions, then configure these environment variables from `.env.example`:

- `OPENAI_API_KEY`
- `OPENAI_TRANSCRIBE_MODEL`
- `OPENAI_CHAT_MODEL`
- `ALLOWED_ORIGIN`
- `ZAMIS_APP_SECRET`

After deployment, open Zamis settings and enter:

- Secure API URL: the deployment origin, without a trailing slash.
- Device secret: the same value as `ZAMIS_APP_SECRET`.

The device secret is only a single-user access gate. For a public multi-user product, replace it with real user authentication, per-user authorization, rate limiting, abuse monitoring, and spend limits.

## Privacy behavior

- Standby audio is held briefly in RAM and discarded after wake-word classification.
- Command audio is sent to the configured transcription endpoint only after Zamis is awake.
- Conversation history and explicit memories remain in the existing local IndexedDB store.
- Image uploads are previewed locally. The current 3B model is text-only and does not pretend to inspect image pixels.
- Text files and text-based PDFs are extracted in the browser and passed as bounded context.

const PERSIAN_PATTERN = /[\u0600-\u06ff]/u;
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const WAKE_MODEL = "onnx-community/whisper-tiny";
const WAKE_PATTERN = /(ز[می]ی?س(?:ت)?|zamis|zames)/iu;
const START_PATTERN = /(ضبط(?:ش)? کن|شروع کن|گوش کن|record it|start recording|start listening|listen now)/iu;
const SPEECH_LEVEL = 0.006;
const SILENCE_MS = 900;
const MIN_SPEECH_MS = 350;
const MAX_SPEECH_MS = 15000;
const COMMAND_WINDOW_MS = 12000;

let wakeTranscriberPromise = null;
let voiceModelProgress = 0;

export function detectSpeechLanguage(text, fallback = "fa-IR") {
  const value = String(text).trim();
  if (!value) return fallback;
  return PERSIAN_PATTERN.test(value) ? "fa-IR" : "en-US";
}

export function monotonicVoiceProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return voiceModelProgress;
  voiceModelProgress = Math.max(voiceModelProgress, Math.min(95, Math.round(numeric)));
  return voiceModelProgress;
}

export function parseVoiceIntent(transcript, armed = false) {
  const text = String(transcript).replace(/[،,.!?؟]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (!text) return { type: "ignore", command: "" };
  if (armed) return { type: "command", command: text };
  const wake = WAKE_PATTERN.test(text);
  const start = START_PATTERN.test(text);
  if (!wake && !start) return { type: "ignore", command: "" };
  const command = text.replace(WAKE_PATTERN, " ").replace(START_PATTERN, " ").replace(/\s+/gu, " ").trim();
  return command ? { type: "command", command } : { type: "wake", command: "" };
}

export function chooseBestVoice(voices, language) {
  const requested = String(language).toLowerCase();
  const prefix = requested.split("-")[0];
  return [...voices]
    .map((voice) => {
      const lang = String(voice.lang).toLowerCase();
      let score = lang === requested ? 100 : (lang.startsWith(`${prefix}-`) || lang === prefix ? 60 : 0);
      if (voice.localService) score += 20;
      if (voice.default) score += 5;
      if (/premium|enhanced|siri|dariush|samantha|daniel/i.test(voice.name)) score += 10;
      return { voice, score };
    })
    .filter(({ score }) => score >= 60)
    .sort((a, b) => b.score - a.score)[0]?.voice ?? null;
}

function mergeChunks(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function resamplePcm(input, sourceRate, targetRate = 16000) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio;
    const lower = Math.floor(position);
    const upper = Math.min(lower + 1, input.length - 1);
    const weight = position - lower;
    output[index] = input[lower] * (1 - weight) + input[upper] * weight;
  }
  return output;
}

export function pcmToWav(samples, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => [...text].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  write(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Blob([buffer], { type: "audio/wav" });
}

export function createVoiceController(options = {}) {
  const root = globalThis;
  const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
  const synthesis = root.speechSynthesis;
  const rawAudioSupported = Boolean(root.navigator?.mediaDevices?.getUserMedia && (root.AudioContext || root.webkitAudioContext));
  const supported = Boolean(Recognition || rawAudioSupported);
  let enabled = false;
  let nativeMode = false;
  let nativeRecognition = null;
  let nativeRestartTimer = null;
  let stream = null;
  let context = null;
  let processor = null;
  let source = null;
  let silentGain = null;
  let preRoll = [];
  let speechChunks = [];
  let speechStartedAt = 0;
  let lastSoundAt = 0;
  let armedUntil = 0;
  let processing = false;
  let queue = [];
  let ignoreInput = false;
  let language = "auto";

  function setState(state, message = "") {
    options.onStateChange?.(state, message);
    if (message) options.onStatus?.(message);
  }

  function dispatchNativeTranscript(transcript, final = true) {
    const text = String(transcript ?? "").trim();
    if (!text || ignoreInput) return;
    options.onTranscript?.(text, { source: "device", final });
    if (!final) return;

    const armed = armedUntil > Date.now();
    const intent = parseVoiceIntent(text, armed);
    if (intent.type === "wake") {
      armedUntil = Date.now() + COMMAND_WINDOW_MS;
      setState("armed", "Zamis heard you • Say your request");
      options.onWake?.(detectSpeechLanguage(text));
    } else if (intent.type === "command") {
      armedUntil = 0;
      options.onCommand?.(intent.command, detectSpeechLanguage(intent.command), "device");
    } else {
      setState("ready", "Listening • Say “Zamis” or «زمیس»");
    }
  }

  function scheduleNativeRestart() {
    clearTimeout(nativeRestartTimer);
    if (!enabled || !nativeMode || ignoreInput) return;
    nativeRestartTimer = root.setTimeout(() => {
      if (!enabled || !nativeMode || ignoreInput) return;
      try {
        nativeRecognition?.start();
      } catch (error) {
        console.warn("Could not restart device speech recognition", error);
      }
    }, 250);
  }

  function startNativeStandby() {
    if (!Recognition) return false;
    nativeMode = true;
    nativeRecognition?.abort?.();
    nativeRecognition = new Recognition();
    nativeRecognition.lang = language === "auto" ? "fa-IR" : language;
    nativeRecognition.continuous = true;
    nativeRecognition.interimResults = true;
    nativeRecognition.maxAlternatives = 3;
    nativeRecognition.onstart = () => setState("ready", "Listening • Say “Zamis” or «زمیس»");
    nativeRecognition.onspeechstart = () => setState(armedUntil > Date.now() ? "hearing-command" : "hearing", "I can hear you…");
    nativeRecognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) dispatchNativeTranscript(transcript, true);
        else interim += transcript;
      }
      if (interim.trim()) dispatchNativeTranscript(interim, false);
    };
    nativeRecognition.onerror = (event) => {
      const code = event.error || "unknown";
      if (code === "aborted" || code === "no-speech") return;
      if (code === "not-allowed" || code === "service-not-allowed") {
        enabled = false;
        setState("error", "Microphone access is blocked. Allow Microphone for Zamis in iPad Settings.");
        options.onError?.(new Error("Microphone access is blocked in iPad Settings."));
        return;
      }
      console.warn(`Device speech recognition error: ${code}`);
      setState("ready", `Voice service paused (${code}) • Retrying…`);
    };
    nativeRecognition.onend = scheduleNativeRestart;
    nativeRecognition.start();
    return true;
  }

  async function getWakeTranscriber() {
    if (wakeTranscriberPromise) return wakeTranscriberPromise;
    voiceModelProgress = 0;
    setState("preparing", "Preparing Zamis voice standby…");
    wakeTranscriberPromise = import(TRANSFORMERS_URL)
      .then(({ pipeline }) => pipeline("automatic-speech-recognition", WAKE_MODEL, {
        device: "wasm",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        progress_callback: (progress) => {
          if (progress.status === "progress") options.onVoiceProgress?.(monotonicVoiceProgress(progress.progress));
        },
      }))
      .catch((error) => {
        wakeTranscriberPromise = null;
        throw error;
      });
    const transcriber = await wakeTranscriberPromise;
    options.onVoiceProgress?.(100);
    return transcriber;
  }

  async function localTranscript(pcm) {
    const transcriber = await getWakeTranscriber();
    const result = await transcriber(pcm, { task: "transcribe", chunk_length_s: 15 });
    return String(result?.text ?? "").trim();
  }

  async function cloudTranscript(pcm) {
    const base = String(options.apiBase?.() ?? "").replace(/\/$/u, "");
    const form = new FormData();
    form.append("audio", pcmToWav(pcm), "voice.wav");
    form.append("language", language);
    const deviceKey = String(options.deviceKey?.() ?? "");
    const response = await fetch(`${base}/api/transcribe`, {
      method: "POST",
      headers: deviceKey ? { "X-Zamis-Key": deviceKey } : {},
      body: form,
    });
    if (!response.ok) throw new Error(`Cloud transcription is unavailable (${response.status}).`);
    const data = await response.json();
    return String(data.text ?? "").trim();
  }

  function finishSpeech() {
    if (!speechChunks.length) return;
    const raw = mergeChunks(speechChunks);
    const pcm = resamplePcm(raw, context.sampleRate);
    speechChunks = [];
    speechStartedAt = 0;
    if (pcm.length >= 1600) {
      queue.push(pcm);
      if (queue.length > 2) queue = queue.slice(-2);
      void drainQueue();
    }
  }

  async function drainQueue() {
    if (processing || !queue.length) return;
    processing = true;
    try {
      while (queue.length && enabled) {
        const pcm = queue.shift();
        const armed = armedUntil > Date.now();
        setState(armed ? "transcribing" : "processing", armed ? "Turning your speech into text…" : "Checking for “Zamis”…");
        let transcript;
        let sourceName = "local";
        if (armed) {
          try {
            transcript = await cloudTranscript(pcm);
            sourceName = "cloud";
          } catch (error) {
            console.warn("Cloud transcription failed; using local fallback", error);
            transcript = await localTranscript(pcm);
          }
        } else {
          transcript = await localTranscript(pcm);
        }
        if (!transcript || ignoreInput) continue;
        options.onTranscript?.(transcript, { source: sourceName, final: true });
        let intent = parseVoiceIntent(transcript, armed);
        if (intent.type === "wake") {
          armedUntil = Date.now() + COMMAND_WINDOW_MS;
          setState("armed", "Zamis is awake • Say your request");
          options.onWake?.(detectSpeechLanguage(transcript));
        } else if (intent.type === "command") {
          if (!armed) {
            try {
              const refined = await cloudTranscript(pcm);
              const refinedIntent = parseVoiceIntent(refined, false);
              if (refinedIntent.type === "command") {
                transcript = refined;
                intent = refinedIntent;
                sourceName = "cloud";
                options.onTranscript?.(transcript, { source: sourceName, final: true });
              }
            } catch (error) {
              console.warn("Could not refine the wake-and-command utterance", error);
            }
          }
          armedUntil = 0;
          options.onCommand?.(intent.command, detectSpeechLanguage(intent.command), sourceName);
        }
      }
    } catch (error) {
      console.error("Voice pipeline failed", error);
      setState("error", `Voice recognition failed: ${error.message}`);
      options.onError?.(error);
    } finally {
      processing = false;
      if (enabled && !ignoreInput) setState(armedUntil > Date.now() ? "armed" : "ready", armedUntil > Date.now() ? "Zamis is awake • Say your request" : "Ready • Say “Zamis” or “زمیس”");
    }
  }

  function capture(event) {
    if (!enabled || ignoreInput) return;
    const chunk = new Float32Array(event.inputBuffer.getChannelData(0));
    let energy = 0;
    for (const sample of chunk) energy += sample * sample;
    const level = Math.sqrt(energy / chunk.length);
    const now = Date.now();
    options.onAudioLevel?.(Math.min(1, level / 0.12));
    preRoll.push(chunk);
    if (preRoll.length > 3) preRoll.shift();

    if (level >= SPEECH_LEVEL) {
      lastSoundAt = now;
      if (!speechStartedAt) {
        speechStartedAt = now;
        speechChunks = [...preRoll];
        setState(armedUntil > now ? "hearing-command" : "hearing");
      }
    }
    if (speechStartedAt) speechChunks.push(chunk);
    const duration = speechStartedAt ? now - speechStartedAt : 0;
    if (speechStartedAt && ((duration >= MIN_SPEECH_MS && now - lastSoundAt >= SILENCE_MS) || duration >= MAX_SPEECH_MS)) finishSpeech();
    if (armedUntil && now > armedUntil) armedUntil = 0;
  }

  async function enableAlwaysOn(selectedLanguage = "auto") {
    if (enabled) return true;
    if (!supported) throw new Error("Voice standby is unavailable in this browser.");
    language = selectedLanguage;
    setState("requesting", "Allow microphone access to activate Zamis.");
    enabled = true;
    if (Recognition) {
      try {
        startNativeStandby();
        return true;
      } catch (error) {
        console.warn("Device speech recognition could not start; using local fallback", error);
        nativeMode = false;
      }
    }
    if (!rawAudioSupported) {
      enabled = false;
      throw new Error("Voice input is unavailable in this browser.");
    }
    stream = await root.navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    context = new AudioContext();
    await context.resume?.();
    source = context.createMediaStreamSource(stream);
    processor = context.createScriptProcessor(4096, 1, 1);
    silentGain = context.createGain();
    silentGain.gain.value = 0;
    processor.onaudioprocess = capture;
    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(context.destination);
    await getWakeTranscriber();
    setState("ready", "Ready • Say “Zamis” or “زمیس”");
    return true;
  }

  async function disableAlwaysOn() {
    enabled = false;
    nativeMode = false;
    clearTimeout(nativeRestartTimer);
    nativeRestartTimer = null;
    nativeRecognition?.abort?.();
    nativeRecognition = null;
    armedUntil = 0;
    queue = [];
    speechChunks = [];
    if (processor) processor.onaudioprocess = null;
    source?.disconnect?.();
    processor?.disconnect?.();
    silentGain?.disconnect?.();
    stream?.getTracks().forEach((track) => track.stop());
    if (context && context.state !== "closed") await context.close().catch(() => {});
    stream = null;
    context = null;
    processor = null;
    source = null;
    silentGain = null;
    setState("off", "Voice standby is off");
  }

  function speak(text) {
    if (!synthesis || !root.SpeechSynthesisUtterance) return false;
    const clean = String(text).replace(/https?:\/\/\S+/giu, "").replace(/\[\d+\]/gu, "").trim();
    if (!clean) return false;
    const speechLanguage = detectSpeechLanguage(clean);
    const utterance = new root.SpeechSynthesisUtterance(clean);
    utterance.lang = speechLanguage;
    utterance.rate = speechLanguage === "fa-IR" ? 0.92 : 0.96;
    utterance.voice = chooseBestVoice(synthesis.getVoices(), speechLanguage);
    utterance.onstart = () => {
      ignoreInput = true;
      speechChunks = [];
      nativeRecognition?.abort?.();
    };
    const resume = () => root.setTimeout(() => {
      ignoreInput = false;
      if (enabled && nativeMode) scheduleNativeRestart();
    }, 300);
    utterance.onend = resume;
    utterance.onerror = resume;
    synthesis.cancel();
    synthesis.speak(utterance);
    return true;
  }

  return {
    inputSupported: supported,
    synthesisSupported: Boolean(synthesis && root.SpeechSynthesisUtterance),
    enableAlwaysOn,
    disableAlwaysOn,
    isEnabled: () => enabled,
    speak,
  };
}

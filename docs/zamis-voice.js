const PERSIAN_PATTERN = /[\u0600-\u06ff]/u;
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const WHISPER_MODEL = "onnx-community/whisper-tiny";
const MAX_RECORDING_MS = 15000;
const SILENCE_AFTER_SPEECH_MS = 1200;
const MIN_SPEECH_MS = 350;
const SPEECH_LEVEL = 0.018;

let transcriberPromise = null;
let voiceModelProgress = 0;

export function monotonicVoiceProgress(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return voiceModelProgress;
  voiceModelProgress = Math.max(voiceModelProgress, Math.min(95, Math.round(numeric)));
  return voiceModelProgress;
}

export function detectSpeechLanguage(text, fallback = "fa-IR") {
  const value = String(text).trim();
  if (!value) return fallback;
  return PERSIAN_PATTERN.test(value) ? "fa-IR" : "en-US";
}

export function chooseBestVoice(voices, language) {
  const requested = String(language).toLowerCase();
  const prefix = requested.split("-")[0];
  return [...voices]
    .map((voice) => {
      const lang = String(voice.lang).toLowerCase();
      let score = 0;
      if (lang === requested) score += 100;
      else if (lang.startsWith(`${prefix}-`) || lang === prefix) score += 60;
      if (voice.localService) score += 20;
      if (voice.default) score += 5;
      if (/premium|enhanced|siri|dariush|samantha|daniel/i.test(voice.name)) score += 10;
      return { voice, score };
    })
    .filter(({ score }) => score >= 60)
    .sort((a, b) => b.score - a.score)[0]?.voice ?? null;
}

export function createVoiceController(options = {}) {
  const root = globalThis;
  const Recognition = root.SpeechRecognition || root.webkitSpeechRecognition;
  const synthesis = root.speechSynthesis;
  const standalone = root.matchMedia?.("(display-mode: standalone)").matches || root.navigator?.standalone === true;
  const recorderSupported = Boolean(root.navigator?.mediaDevices?.getUserMedia && root.MediaRecorder);
  let recognition = null;
  let recorder = null;
  let recordingStream = null;
  let recordingChunks = [];
  let recordingTimer = null;
  let recordingMimeType = "audio/mp4";
  let stopRequested = false;
  let meterContext = null;
  let meterFrame = null;

  function setListening(value) {
    options.onListeningChange?.(value);
  }

  function startNativeRecognition(language) {
    synthesis?.cancel();
    recognition?.abort?.();
    recognition = new Recognition();
    recognition.lang = language;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onerror = (event) => {
      setListening(false);
      const message = event.error === "not-allowed"
        ? "Microphone permission is required. Allow it in Safari settings."
        : `Voice input failed: ${event.error || "unknown error"}`;
      options.onError?.(message);
    };
    recognition.onresult = (event) => {
      let transcript = "";
      let final = false;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        transcript += event.results[index][0]?.transcript ?? "";
        final ||= event.results[index].isFinal;
      }
      options.onTranscript?.(transcript.trim(), final, language);
    };
    recognition.start();
    return true;
  }

  async function decodeAudio(blob) {
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (!AudioContext) throw new Error("Audio decoding is unavailable on this device.");
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
      const mono = new Float32Array(decoded.length);
      for (let index = 0; index < mono.length; index += 1) {
        let sample = 0;
        for (const channel of channels) sample += channel[index];
        mono[index] = sample / channels.length;
      }
      if (decoded.sampleRate === 16000) return mono;

      const ratio = decoded.sampleRate / 16000;
      const output = new Float32Array(Math.round(mono.length / ratio));
      for (let index = 0; index < output.length; index += 1) {
        const position = index * ratio;
        const lower = Math.floor(position);
        const upper = Math.min(lower + 1, mono.length - 1);
        const weight = position - lower;
        output[index] = mono[lower] * (1 - weight) + mono[upper] * weight;
      }
      return output;
    } finally {
      await context.close();
    }
  }

  async function getTranscriber() {
    if (transcriberPromise) return transcriberPromise;
    voiceModelProgress = 0;
    options.onStatus?.("Preparing private voice model… 0%");
    transcriberPromise = import(TRANSFORMERS_URL)
      .then(({ pipeline }) => pipeline("automatic-speech-recognition", WHISPER_MODEL, {
        device: "wasm",
        dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
        progress_callback: (progress) => {
          if (progress.status !== "progress") return;
          const percent = monotonicVoiceProgress(progress.progress);
          options.onStatus?.(`Preparing private voice model… ${percent}%`);
        },
      }))
      .catch((error) => {
        transcriberPromise = null;
        throw error;
      });
    const transcriber = await transcriberPromise;
    voiceModelProgress = 100;
    return transcriber;
  }

  async function transcribeRecording(blob, language) {
    if (!blob.size) throw new Error("No audio was recorded. Please try again.");
    const transcriber = await getTranscriber();
    options.onStatus?.(language === "fa-IR" ? "در حال تبدیل صدا به متن…" : "Transcribing speech…");
    const audio = await decodeAudio(blob);
    const result = await transcriber(audio, {
      language: language === "fa-IR" ? "fa" : "en",
      task: "transcribe",
      chunk_length_s: 20,
    });
    const transcript = String(result?.text ?? "").trim();
    if (!transcript) throw new Error("No speech was recognized.");
    options.onTranscript?.(transcript, true, language);
  }

  async function stopMeter() {
    if (meterFrame !== null) root.cancelAnimationFrame?.(meterFrame);
    meterFrame = null;
    if (meterContext && meterContext.state !== "closed") await meterContext.close().catch(() => {});
    meterContext = null;
  }

  function finishRecording() {
    if (stopRequested || recorder?.state !== "recording") return;
    stopRequested = true;
    clearTimeout(recordingTimer);
    try {
      recorder.requestData?.();
    } catch {
      // Safari can reject requestData while it is finalizing; stop still emits the final chunk.
    }
    recorder.stop();
  }

  function watchForSilence(stream) {
    const AudioContext = root.AudioContext || root.webkitAudioContext;
    if (!AudioContext || !root.requestAnimationFrame) return;
    meterContext = new AudioContext();
    const source = meterContext.createMediaStreamSource(stream);
    const analyser = meterContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const startedAt = Date.now();
    let speechStartedAt = 0;
    let lastSpeechAt = 0;

    const measure = () => {
      if (recorder?.state !== "recording") return;
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) energy += sample * sample;
      const level = Math.sqrt(energy / samples.length);
      const now = Date.now();
      if (level >= SPEECH_LEVEL) {
        if (!speechStartedAt) speechStartedAt = now;
        lastSpeechAt = now;
      }
      const heardSpeech = speechStartedAt && lastSpeechAt - speechStartedAt >= MIN_SPEECH_MS;
      if (heardSpeech && now - lastSpeechAt >= SILENCE_AFTER_SPEECH_MS) {
        finishRecording();
        return;
      }
      if (now - startedAt >= MAX_RECORDING_MS) {
        finishRecording();
        return;
      }
      meterFrame = root.requestAnimationFrame(measure);
    };
    meterFrame = root.requestAnimationFrame(measure);
  }

  async function startLocalRecording(language) {
    if (!recorderSupported) {
      options.onError?.("Voice input is unavailable here. Use the microphone key on the iPad keyboard.");
      return false;
    }
    try {
      synthesis?.cancel();
      recordingStream = await root.navigator.mediaDevices.getUserMedia({ audio: true });
      const preferredType = root.MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : root.MediaRecorder.isTypeSupported?.("audio/mp4") ? "audio/mp4" : "";
      recorder = preferredType
        ? new root.MediaRecorder(recordingStream, { mimeType: preferredType })
        : new root.MediaRecorder(recordingStream);
      recordingChunks = [];
      recordingMimeType = recorder.mimeType || preferredType || "audio/mp4";
      stopRequested = false;
      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordingChunks.push(event.data);
      };
      recorder.onerror = (event) => options.onError?.(`Audio recording failed: ${event.error?.message || "unknown error"}`);
      recorder.onstop = async () => {
        clearTimeout(recordingTimer);
        await stopMeter();
        recordingStream?.getTracks().forEach((track) => track.stop());
        recordingStream = null;
        setListening(false);
        const blob = new Blob(recordingChunks, { type: recordingMimeType });
        try {
          await transcribeRecording(blob, language);
        } catch (error) {
          console.error("Local speech transcription failed", error);
          options.onError?.(`Voice transcription failed: ${error.message}`);
        }
      };
      recorder.start(250);
      setListening(true);
      options.onStatus?.(language === "fa-IR" ? "گوش می‌دهم؛ بعد از صحبت خودکار ارسال می‌شود…" : "Listening; it will send after you finish speaking…");
      watchForSilence(recordingStream);
      recordingTimer = setTimeout(finishRecording, MAX_RECORDING_MS);
      return true;
    } catch (error) {
      recordingStream?.getTracks().forEach((track) => track.stop());
      recordingStream = null;
      setListening(false);
      const message = error.name === "NotAllowedError"
        ? "Microphone permission is required. Allow it in iPad Settings for Zamis."
        : `Could not start microphone: ${error.message}`;
      options.onError?.(message);
      return false;
    }
  }

  function start(language = "fa-IR") {
    if (Recognition && !standalone) return startNativeRecognition(language);
    void startLocalRecording(language);
    return recorderSupported;
  }

  function stop() {
    recognition?.stop?.();
    finishRecording();
  }

  function speak(text) {
    if (!synthesis || !root.SpeechSynthesisUtterance) return false;
    const clean = String(text)
      .replace(/https?:\/\/\S+/giu, "")
      .replace(/\[\d+\]/gu, "")
      .trim();
    if (!clean) return false;

    const language = detectSpeechLanguage(clean);
    const utterance = new root.SpeechSynthesisUtterance(clean);
    utterance.lang = language;
    utterance.rate = language === "fa-IR" ? 0.92 : 0.96;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.voice = chooseBestVoice(synthesis.getVoices(), language);
    synthesis.cancel();
    synthesis.speak(utterance);
    return true;
  }

  return {
    inputSupported: Boolean(Recognition || recorderSupported),
    recognitionSupported: Boolean(Recognition),
    usesLocalWhisper: standalone || !Recognition,
    synthesisSupported: Boolean(synthesis && root.SpeechSynthesisUtterance),
    speak,
    start,
    stop,
  };
}

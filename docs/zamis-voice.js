const PERSIAN_PATTERN = /[\u0600-\u06ff]/u;
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js";
const WHISPER_MODEL = "onnx-community/whisper-tiny";

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

  async function transcribeRecording(blob, language) {
    options.onStatus?.("Loading private voice model…");
    const { pipeline } = await import(TRANSFORMERS_URL);
    const transcriber = await pipeline("automatic-speech-recognition", WHISPER_MODEL, {
      device: "wasm",
      dtype: { encoder_model: "fp32", decoder_model_merged: "q4" },
      progress_callback: (progress) => {
        if (progress.status === "progress" && Number.isFinite(progress.progress)) {
          options.onStatus?.(`Loading voice model… ${Math.round(progress.progress)}%`);
        }
      },
    });
    try {
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
    } finally {
      await transcriber.dispose?.();
    }
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
      recorder.ondataavailable = (event) => {
        if (event.data?.size) recordingChunks.push(event.data);
      };
      recorder.onerror = (event) => options.onError?.(`Audio recording failed: ${event.error?.message || "unknown error"}`);
      recorder.onstop = async () => {
        clearTimeout(recordingTimer);
        recordingStream?.getTracks().forEach((track) => track.stop());
        recordingStream = null;
        setListening(false);
        const blob = new Blob(recordingChunks, { type: recorder.mimeType || "audio/mp4" });
        try {
          await transcribeRecording(blob, language);
        } catch (error) {
          console.error("Local speech transcription failed", error);
          options.onError?.(`Voice transcription failed: ${error.message}`);
        }
      };
      recorder.start();
      setListening(true);
      options.onStatus?.(language === "fa-IR" ? "گوش می‌دهم؛ برای پایان دوباره دکمه را بزن…" : "Listening; tap again to finish…");
      recordingTimer = setTimeout(() => recorder?.state === "recording" && recorder.stop(), 20000);
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
    if (recorder?.state === "recording") recorder.stop();
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

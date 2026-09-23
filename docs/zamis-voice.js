const PERSIAN_PATTERN = /[\u0600-\u06ff]/u;

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
  let recognition = null;

  function setListening(value) {
    options.onListeningChange?.(value);
  }

  function start(language = "fa-IR") {
    if (!Recognition) {
      options.onError?.("Speech recognition is unavailable. Use the iPad keyboard microphone instead.");
      return false;
    }

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

  function stop() {
    recognition?.stop?.();
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
    recognitionSupported: Boolean(Recognition),
    synthesisSupported: Boolean(synthesis && root.SpeechSynthesisUtterance),
    speak,
    start,
    stop,
  };
}

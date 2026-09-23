import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../docs/zamis-voice.js", import.meta.url), "utf8");
const voice = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

const cases = [
  ["زمیس", false, "wake"],
  ["ضبط کن", false, "wake"],
  ["Zamis what time is it", false, "command"],
  ["زمیس امروز چندمه", false, "command"],
  ["امروز هوا خوبه", false, "ignore"],
  ["امروز هوا خوبه", true, "command"],
];

for (const [transcript, armed, expected] of cases) {
  assert.equal(voice.parseVoiceIntent(transcript, armed).type, expected, transcript);
}

const input = new Float32Array(48_000).fill(0.25);
const resampled = voice.resamplePcm(input, 48_000, 16_000);
assert.equal(resampled.length, 16_000);

const wav = voice.pcmToWav(resampled, 16_000);
assert.equal(wav.size, 32_044);
const wavBytes = new Uint8Array(await wav.arrayBuffer());
assert.equal(new TextDecoder().decode(wavBytes.subarray(0, 4)), "RIFF");

class FakeRecognition {
  static latest;
  constructor() { FakeRecognition.latest = this; }
  start() { this.onstart?.(); }
  abort() {}
  emit(text, isFinal = true) {
    this.onresult?.({ resultIndex: 0, results: Object.assign([[{ transcript: text }]], { 0: Object.assign([{ transcript: text }], { isFinal }), length: 1 }) });
  }
}

globalThis.webkitSpeechRecognition = FakeRecognition;
const voiceEvents = [];
const controller = voice.createVoiceController({
  onWake: () => voiceEvents.push("wake"),
  onCommand: (command) => voiceEvents.push(`command:${command}`),
});
await controller.enableAlwaysOn("fa-IR");
FakeRecognition.latest.emit("زمیس");
FakeRecognition.latest.emit("ایران کجاست");
assert.deepEqual(voiceEvents, ["wake", "command:ایران کجاست"]);
await controller.disableAlwaysOn();

console.log(`voice smoke: ${cases.length} intents, device recognition, resampling, and WAV encoding passed`);

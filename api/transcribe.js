export const config = { runtime: "edge" };

function corsHeaders(request) {
  const allowed = process.env.ALLOWED_ORIGIN || "*";
  const origin = request.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowed === "*" || origin === allowed ? (allowed === "*" ? "*" : origin) : "null",
    "Access-Control-Allow-Headers": "Content-Type, X-Zamis-Key",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export default async function handler(request) {
  const headers = corsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405, headers });
  if (!process.env.OPENAI_API_KEY) return Response.json({ error: "OPENAI_API_KEY is not configured" }, { status: 503, headers });
  if (process.env.ZAMIS_APP_SECRET && request.headers.get("x-zamis-key") !== process.env.ZAMIS_APP_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const incoming = await request.formData();
    const audio = incoming.get("audio");
    if (!(audio instanceof File)) return Response.json({ error: "Audio file is required" }, { status: 400, headers });
    const outgoing = new FormData();
    outgoing.append("file", audio, audio.name || "voice.wav");
    outgoing.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-transcribe");
    outgoing.append("prompt", "Bilingual Persian and English speech for an assistant named Zamis (زمیس). Preserve names and technical terms.");
    const language = incoming.get("language");
    if (language === "fa-IR") outgoing.append("language", "fa");
    if (language === "en-US") outgoing.append("language", "en");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: outgoing,
    });
    const data = await response.json();
    if (!response.ok) return Response.json({ error: data.error?.message || "Transcription failed" }, { status: response.status, headers });
    return Response.json({ text: data.text || "" }, { headers });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers });
  }
}

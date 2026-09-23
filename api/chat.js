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

function outputText(data) {
  if (data.output_text) return data.output_text;
  return (data.output || [])
    .flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text")
    .map((item) => item.text)
    .join("\n")
    .trim();
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
    const body = await request.json();
    const message = String(body.message || "").trim();
    if (!message) return Response.json({ error: "Message is required" }, { status: 400, headers });
    const context = String(body.attachmentContext || "").slice(0, 16000);
    const input = context ? `${message}\n\nAttachment context:\n${context}` : message;
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_CHAT_MODEL || "gpt-5-mini",
        instructions: "You are Zamis, Amin's bilingual Persian-English assistant. Correct likely speech recognition mistakes from context, answer naturally in the user's language, be concise, and never claim an action succeeded unless it actually did.",
        input,
      }),
    });
    const data = await response.json();
    if (!response.ok) return Response.json({ error: data.error?.message || "Chat request failed" }, { status: response.status, headers });
    return Response.json({ text: outputText(data) }, { headers });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500, headers });
  }
}

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs";
const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs";
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_CONTEXT_CHARS = 14000;

function trimContext(text) {
  const clean = String(text).replace(/\u0000/gu, "").trim();
  return clean.length > MAX_CONTEXT_CHARS ? `${clean.slice(0, MAX_CONTEXT_CHARS)}\n[content truncated]` : clean;
}

async function readPdf(file) {
  const pdfjs = await import(PDFJS_URL);
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let number = 1; number <= Math.min(pdf.numPages, 25); number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => item.str).join(" "));
  }
  return trimContext(pages.join("\n\n"));
}

export async function readAttachment(file) {
  if (!file) throw new Error("No file selected.");
  if (file.size > MAX_FILE_BYTES) throw new Error("File is larger than 12 MB.");
  const summary = `${file.name} (${file.type || "unknown type"}, ${Math.max(1, Math.round(file.size / 1024))} KB)`;
  if (file.type.startsWith("image/")) {
    return {
      kind: "image",
      name: file.name,
      previewUrl: URL.createObjectURL(file),
      context: `The user attached ${summary}. The current local 3B model is text-only and cannot inspect image pixels. State this limitation instead of inventing details.`,
    };
  }
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    const text = await readPdf(file);
    if (!text) throw new Error("No readable text was found in this PDF.");
    return { kind: "document", name: file.name, previewUrl: "", context: `Attached PDF: ${summary}\n\n${text}` };
  }
  if (file.type.startsWith("text/") || /\.(txt|md|csv|json|js|py|html|css)$/iu.test(file.name)) {
    const text = trimContext(await file.text());
    if (!text) throw new Error("The selected file is empty.");
    return { kind: "document", name: file.name, previewUrl: "", context: `Attached text file: ${summary}\n\n${text}` };
  }
  throw new Error("Supported files: images, PDF, TXT, Markdown, CSV, JSON and code files.");
}

export function releaseAttachment(attachment) {
  if (attachment?.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
}

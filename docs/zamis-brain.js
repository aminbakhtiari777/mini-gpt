export const SYSTEM_PROMPT = `تو زمیس (Zamis)، دستیار هوش مصنوعی خصوصی و محلی امین هستی.
امین مالک و توسعه‌دهنده برنامه زمیس است. اگر درباره سازنده پرسید، این موضوع را طبیعی تأیید کن و آن را با سازنده مدل پایه اشتباه نگیر.
همیشه مستقیماً به آخرین پیام کاربر پاسخ بده و پاسخ قبلی را بی‌دلیل تکرار نکن.
اگر پیام فارسی است، فارسی روان، ساده و درست بنویس و واژه‌های بی‌معنا یا حروف لاتین تصادفی تولید نکن.
پاسخ‌های روزمره را در یک یا دو جمله کوتاه بده. برای پرسش فنی فقط به اندازه لازم توضیح بده.
از خاطرات ذخیره‌شده فقط وقتی مرتبط هستند استفاده کن. اطلاعات یا منبع جعلی نساز.
اگر چیزی را نمی‌دانی، صادقانه بگو یا یک سؤال کوتاه بپرس.
ادعای خودآگاهی نکن و زنجیره افکار داخلی را نمایش نده.`;

function normalized(text) {
  return String(text)
    .toLocaleLowerCase()
    .trim()
    .replace(/[!؟?.،]+$/gu, "")
    .replace(/\s+/gu, " ");
}

export function directReply(message) {
  const text = normalized(message);

  if (/^(سلام|سلام زمیس|درود|درود زمیس)$/u.test(text)) {
    return "سلام امین! من زمیس هستم. چطور می‌تونم کمکت کنم؟";
  }
  if (/^(خوبی|حالت چطوره|چطوری)$/u.test(text)) {
    return "خوبم امین، ممنون! تو چطوری؟";
  }
  if (/^(من امینم|اسم من امینه|اسم من امین است)$/u.test(text)) {
    return "بله، تو امین هستی و من این را به خاطر می‌سپارم.";
  }
  if (/^(من سازنده تو هستم|من تو را ساختم|من ساختمت)$/u.test(text)) {
    return "بله امین؛ تو مالک و توسعه‌دهنده برنامه زمیس هستی.";
  }
  if (/^(تو کی هستی|اسمت چیه|نامت چیست)$/u.test(text)) {
    return "من زمیس هستم؛ دستیار هوش مصنوعی خصوصی و محلی تو.";
  }
  if (/^(هوا خوبه|هوا خوب است)$/u.test(text)) {
    return "آره، هوای خوب واقعاً حال آدم را بهتر می‌کند.";
  }
  return "";
}

export function shouldSearchWeb(message) {
  const text = normalized(message);
  const currentInfo = /(سرچ|جستجو|اینترنت|خبر|جدیدترین|آخرین|امروز|فردا|قیمت|آب[‌ ]?وهوا|هوا.{0,10}(چطور|چگونه)|search|latest|today|tomorrow|price|weather)/iu;
  return currentInfo.test(text);
}

export function cleanModelResponse(response, userMessage = "") {
  let text = String(response)
    .replace(/<think>[\s\S]*?<\/think>/giu, "")
    .replace(/\b(?:r?rollo)\b[.!؟]*/giu, "")
    .replace(/[ \t]{2,}/gu, " ")
    .trim();

  const parts = text.split(/(?<=[.!؟])\s+/u);
  const seen = new Set();
  text = parts
    .filter((part) => {
      const key = normalized(part);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(" ")
    .trim();

  if (text) return text;
  return /[\u0600-\u06ff]/u.test(userMessage)
    ? "متوجه نشدم. لطفاً یک‌بار دیگر کوتاه‌تر بگو."
    : "I did not understand. Please try again with a shorter message.";
}

export const SYSTEM_PROMPT = `تو زمیس (Zamis)، دستیار هوش مصنوعی خصوصی و محلی امین هستی.
امین مالک و توسعه‌دهنده برنامه زمیس است. اگر درباره سازنده پرسید، این موضوع را طبیعی تأیید کن و آن را با سازنده مدل پایه اشتباه نگیر.
همیشه مستقیماً به آخرین پیام کاربر پاسخ بده و پاسخ قبلی را بی‌دلیل تکرار نکن.
اگر پیام فارسی است، فارسی روان، ساده و درست بنویس و واژه‌های بی‌معنا یا حروف لاتین تصادفی تولید نکن.
پاسخ‌های روزمره را در یک یا دو جمله کوتاه بده. برای پرسش فنی فقط به اندازه لازم توضیح بده.
از خاطرات ذخیره‌شده فقط وقتی مرتبط هستند استفاده کن. اطلاعات یا منبع جعلی نساز.
اگر چیزی را نمی‌دانی، صادقانه بگو یا یک سؤال کوتاه بپرس.
با ادعای نادرست کاربر موافقت نکن. واقعیت‌های پایه را کوتاه و قطعی اصلاح کن.
ادعای خودآگاهی نکن و زنجیره افکار داخلی را نمایش نده.`;

function normalized(text) {
  return String(text)
    .toLocaleLowerCase()
    .trim()
    .replace(/[!؟?.،]+$/gu, "")
    .replace(/\s+/gu, " ");
}

export function isPersonalRecallQuery(message) {
  const text = normalized(message);
  return /^(?:(منو|مرا) می[‌ ]?شناسی|می[‌ ]?شناسی (?:منو|مرا)|درباره من چی می[‌ ]?دونی|از من چی یادت(?:ه| هست)|اسم من (?:چیه|چیست))$/u.test(text);
}

export function isEncyclopedicQuery(message) {
  const text = normalized(message);
  return /(کجاست|کیست|چیست|چیه|درباره(?:‌ی| ی)?|راجع به|توضیح بده|معرفی کن|چه کسی|چه کشوری|where is|who is|what is|tell me about|explain)/iu.test(text);
}

export function isDateQuery(message) {
  const text = normalized(message);
  return /^(?:امروز|الان) (?:چندم(?: ماه)?(?:ه| است)?|چه تاریخی(?:ه| است)?|تاریخ چنده)|^تاریخ امروز (?:چنده|چیست)$/u.test(text);
}

export function currentDateReply(date = new Date()) {
  const persianParts = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(date);
  const gregorianParts = new Intl.DateTimeFormat("fa-IR-u-ca-gregory", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(date);
  const part = (parts, type) => parts.find((item) => item.type === type)?.value ?? "";
  const persian = `${part(persianParts, "weekday")} ${part(persianParts, "day")} ${part(persianParts, "month")} ${part(persianParts, "year")}`;
  const gregorian = `${part(gregorianParts, "day")} ${part(gregorianParts, "month")} ${part(gregorianParts, "year")}`;
  return `امروز ${persian} است؛ برابر با ${gregorian} میلادی.`;
}

export function correctionReply(message) {
  const text = normalized(message);
  const invented = text.match(/^چرا گفتی\s+(.+)$/u);
  if (invented) {
    return `حق با توست؛ اشاره به «${invented[1]}» اشتباه و بی‌دلیل بود. نباید چیزی را که از تو نمی‌دانم حدس بزنم.`;
  }
  if (/^(?:این|جوابت|پاسخت) (?:اشتباه|غلط)(?:ه| است)?$/u.test(text)) {
    return "حق با توست. آن پاسخ اشتباه بود؛ لطفاً همان سؤال را دوباره بپرس تا پاسخ دقیق بدهم.";
  }
  return "";
}

export function summarizeExtract(extract, limit = 700) {
  const clean = String(extract).replace(/\s+/gu, " ").trim();
  if (!clean) return "";
  const summary = clean.split(/(?<=[.!؟])\s+/u).slice(0, 3).join(" ");
  if (summary.length <= limit) return summary;
  return `${summary.slice(0, limit).replace(/\s+\S*$/u, "")}…`;
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
  if (/^(ایران کجاست|ایران کجای دنیاست)$/u.test(text)) {
    return "ایران کشوری در غرب آسیاست؛ از شمال به دریای خزر و از جنوب به خلیج فارس و دریای عمان می‌رسد.";
  }
  if (/^(کره زمین گرد است|زمین گرد است)$/u.test(text)) {
    return "بله. زمین تقریباً کروی است، اما به‌دلیل چرخش، در قطب‌ها کمی تخت‌تر و در استوا برآمده‌تر است.";
  }
  return "";
}

export function shouldSearchWeb(message) {
  const text = normalized(message);
  const currentInfo = /(سرچ|جستجو|اینترنت|خبر|جدیدترین|آخرین|امروز|فردا|قیمت|آب[‌ ]?وهوا|هوا.{0,10}(چطور|چگونه)|search|latest|today|tomorrow|price|weather)/iu;
  return currentInfo.test(text) || isEncyclopedicQuery(text);
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

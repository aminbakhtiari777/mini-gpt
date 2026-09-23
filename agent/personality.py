from __future__ import annotations


NEGATIVE = {"sad", "upset", "worried", "afraid", "غمگین", "ناراحت", "نگران", "میترسم", "می‌ترسم"}
POSITIVE = {"happy", "great", "excellent", "خوشحال", "عالی", "خوبه", "خوبم"}


def emotional_tone(message: str) -> str:
    lowered = message.casefold()
    if any(word in lowered for word in NEGATIVE):
        return "supportive"
    if any(word in lowered for word in POSITIVE):
        return "warm"
    return "calm"


def apply_personality(answer: str, message: str) -> str:
    tone = emotional_tone(message)
    if tone == "supportive":
        return "متوجه‌ام که این موضوع می‌تواند سنگین باشد. " + answer
    if tone == "warm" and any("\u0600" <= char <= "\u06ff" for char in message):
        return "خوشحالم. " + answer
    return answer

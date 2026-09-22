import numpy as np
from functools import lru_cache

try:
    from .config import (
        VOCAB_SIZE, MAX_LENGTH, EMBED_DIM, NUM_HEADS, FF_DIM,
        NUM_LAYERS, TOKENIZER_PATH, MODEL_PATH,
    )
    from .tokenizer import MiniGPTTokenizer
    from .model import build_model
except ImportError:  # Allows `python src/inference.py` during local experiments.
    from config import (
        VOCAB_SIZE, MAX_LENGTH, EMBED_DIM, NUM_HEADS, FF_DIM,
        NUM_LAYERS, TOKENIZER_PATH, MODEL_PATH,
    )
    from tokenizer import MiniGPTTokenizer
    from model import build_model


@lru_cache(maxsize=1)
def load_model_and_tokenizer():
    tokenizer = MiniGPTTokenizer(VOCAB_SIZE)
    tokenizer.load(TOKENIZER_PATH)

    model = build_model(
        VOCAB_SIZE,
        MAX_LENGTH - 1,
        EMBED_DIM,
        NUM_HEADS,
        FF_DIM,
        NUM_LAYERS,
    )

    dummy_input = np.zeros((1, MAX_LENGTH - 1), dtype=np.int32)
    model(dummy_input)

    model.load_weights(MODEL_PATH)

    return model, tokenizer


def sample_next_token(logits, temperature=0.7, top_k=10):
    logits = logits.astype("float64")
    logits = logits / temperature

    top_k_indices = np.argsort(logits)[-top_k:]
    top_k_logits = logits[top_k_indices]

    top_k_logits = top_k_logits - np.max(top_k_logits)

    probabilities = np.exp(top_k_logits)
    probabilities = probabilities / np.sum(probabilities)

    chosen_index = np.random.choice(len(top_k_indices), p=probabilities)
    next_token_id = int(top_k_indices[chosen_index])

    return next_token_id


def generate_text(prompt, max_new_words=30, temperature=0.7, top_k=10):
    model, tokenizer = load_model_and_tokenizer()

    text = prompt

    for _ in range(max_new_words):
        sequence = tokenizer.encode([text])
        padded = tokenizer.pad(sequence, MAX_LENGTH - 1)

        predictions = model.predict(padded, verbose=0)

        real_length = len(sequence[0])
        real_length = min(real_length, MAX_LENGTH - 1)

        next_token_logits = predictions[0, real_length - 1]

        next_token_id = sample_next_token(
            next_token_logits,
            temperature=temperature,
            top_k=top_k,
        )

        if next_token_id == 0:
            break

        next_word = tokenizer.decode([[next_token_id]])[0]

        if next_word == "<UNK>":
            continue

        text += " " + next_word

    return text

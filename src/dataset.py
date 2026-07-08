import numpy as np

from config import MAX_LENGTH
from tokenizer import MiniGPTTokenizer


def load_text(path):
    with open(path, "r", encoding="utf-8") as f:
        lines = f.read().splitlines()

    return [line.strip() for line in lines if line.strip()]


def create_dataset(texts, tokenizer: MiniGPTTokenizer):
    sequences = tokenizer.encode(texts)
    padded = tokenizer.pad(sequences, MAX_LENGTH)

    x = padded[:, :-1]
    y = padded[:, 1:]

    return np.array(x), np.array(y)
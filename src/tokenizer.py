from tensorflow.keras.preprocessing.text import Tokenizer
from tensorflow.keras.preprocessing.sequence import pad_sequences
from tensorflow.keras.preprocessing.text import tokenizer_from_json


class MiniGPTTokenizer:
    def __init__(self, vocab_size):
        self.tokenizer = Tokenizer(num_words=vocab_size, oov_token="<UNK>")

    def fit(self, texts):
        self.tokenizer.fit_on_texts(texts)

    def encode(self, texts):
        return self.tokenizer.texts_to_sequences(texts)

    def pad(self, sequences, max_length):
        return pad_sequences(sequences, maxlen=max_length, padding="post", truncating="post")

    def decode(self, sequences):
        return self.tokenizer.sequences_to_texts(sequences)

    def save(self, path):
        tokenizer_json = self.tokenizer.to_json()
        with open(path, "w", encoding="utf-8") as f:
            f.write(tokenizer_json)

    def load(self, path):
        with open(path, "r", encoding="utf-8") as f:
            tokenizer_json = f.read()
        self.tokenizer = tokenizer_from_json(tokenizer_json)
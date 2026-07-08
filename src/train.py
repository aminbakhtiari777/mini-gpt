import tensorflow as tf

from config import (
    VOCAB_SIZE,
    MAX_LENGTH,
    EMBED_DIM,
    NUM_HEADS,
    FF_DIM,
    NUM_LAYERS,
    BATCH_SIZE,
    EPOCHS,
    LEARNING_RATE,
    TRAIN_PATH,
    TOKENIZER_PATH,
    MODEL_PATH,
)

from tokenizer import MiniGPTTokenizer
from dataset import load_text, create_dataset
from model import build_model


def main():
    texts = load_text(TRAIN_PATH)

    tokenizer = MiniGPTTokenizer(VOCAB_SIZE)
    tokenizer.fit(texts)
    tokenizer.save(TOKENIZER_PATH)

    x, y = create_dataset(texts, tokenizer)

    model = build_model(
        VOCAB_SIZE,
        MAX_LENGTH - 1,
        EMBED_DIM,
        NUM_HEADS,
        FF_DIM,
        NUM_LAYERS,
    )

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(from_logits=True),
        metrics=["accuracy"],
    )

    model.fit(x, y, batch_size=BATCH_SIZE, epochs=EPOCHS)

    model.save_weights(MODEL_PATH)

    print("Training finished.")
    print("Model saved to:", MODEL_PATH)


if __name__ == "__main__":
    main()
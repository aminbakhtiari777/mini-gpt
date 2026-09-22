from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent.parent

VOCAB_SIZE = 10000
MAX_LENGTH = 64
EMBED_DIM = 128
NUM_HEADS = 8
FF_DIM = 512
NUM_LAYERS = 4
BATCH_SIZE = 16
EPOCHS = 10
LEARNING_RATE = 0.0005

TRAIN_PATH = PROJECT_ROOT / "data" / "train.txt"
TOKENIZER_PATH = PROJECT_ROOT / "outputs" / "tokenizer.json"
MODEL_PATH = PROJECT_ROOT / "checkpoints" / "mini_gpt_model.weights.h5"

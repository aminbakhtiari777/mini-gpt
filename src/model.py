import tensorflow as tf
from tensorflow.keras import layers


class TransformerBlock(layers.Layer):
    def __init__(self, embed_dim, num_heads, ff_dim):
        super().__init__()

        self.attention = layers.MultiHeadAttention(num_heads=num_heads, key_dim=embed_dim)

        self.ffn = tf.keras.Sequential([
            layers.Dense(ff_dim, activation="relu"),
            layers.Dense(embed_dim),
        ])

        self.layernorm1 = layers.LayerNormalization()
        self.layernorm2 = layers.LayerNormalization()

    def call(self, inputs):
        attention_output = self.attention(inputs, inputs, use_causal_mask=True)
        out1 = self.layernorm1(inputs + attention_output)
        ffn_output = self.ffn(out1)
        return self.layernorm2(out1 + ffn_output)


class MiniGPT(tf.keras.Model):
    def __init__(self, vocab_size, max_length, embed_dim, num_heads, ff_dim, num_layers):
        super().__init__()

        self.token_embedding = layers.Embedding(vocab_size, embed_dim)
        self.position_embedding = layers.Embedding(max_length, embed_dim)

        self.blocks = [
            TransformerBlock(embed_dim, num_heads, ff_dim)
            for _ in range(num_layers)
        ]

        self.output_layer = layers.Dense(vocab_size)

    def call(self, inputs):
        seq_len = tf.shape(inputs)[1]
        positions = tf.range(start=0, limit=seq_len, delta=1)

        x = self.token_embedding(inputs)
        x = x + self.position_embedding(positions)

        for block in self.blocks:
            x = block(x)

        return self.output_layer(x)


def build_model(vocab_size, max_length, embed_dim, num_heads, ff_dim, num_layers):
    return MiniGPT(vocab_size, max_length, embed_dim, num_heads, ff_dim, num_layers)
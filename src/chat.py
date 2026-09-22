try:
    from .inference import generate_text
except ImportError:
    from inference import generate_text


def main():
    while True:
        prompt = input("You: ")

        if prompt.lower() in ["exit", "quit"]:
            break

        response = generate_text(prompt)
        print("MiniGPT:", response)


if __name__ == "__main__":
    main()

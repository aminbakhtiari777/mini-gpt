from __future__ import annotations

from .orchestrator import MiniGPTAgent


def main() -> None:
    agent = MiniGPTAgent()
    session_id = "cli"
    print("Mini-GPT Agent — type /quit to exit, /offline to disable web, /online to enable it")
    allow_web = True
    while True:
        message = input("You: ").strip()
        if message in {"/quit", "/exit"}:
            break
        if message == "/offline":
            allow_web = False
            print("Mini-GPT: Offline mode enabled.")
            continue
        if message == "/online":
            allow_web = True
            print("Mini-GPT: Online mode enabled.")
            continue
        result = agent.chat(message, session_id, allow_web)
        print(f"Mini-GPT [{result.mode}, {result.confidence:.0%}]: {result.answer}")
        for index, source in enumerate(result.sources, start=1):
            print(f"  [{index}] {source.title}: {source.url}")


if __name__ == "__main__":
    main()

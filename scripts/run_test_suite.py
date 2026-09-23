"""Run the repository's assertion-based Python tests without pytest."""

from __future__ import annotations

import importlib.util
import inspect
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
TEST_FILE = ROOT / "tests" / "test_agent.py"
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_test_module():
    spec = importlib.util.spec_from_file_location("zamis_test_agent", TEST_FILE)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {TEST_FILE}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> int:
    module = load_test_module()
    tests = [
        (name, function)
        for name, function in inspect.getmembers(module, inspect.isfunction)
        if name.startswith("test_")
    ]
    failures: list[tuple[str, Exception]] = []

    with tempfile.TemporaryDirectory(prefix="zamis-tests-") as directory:
        base = Path(directory)
        for index, (name, function) in enumerate(tests):
            try:
                parameters = inspect.signature(function).parameters
                kwargs = {"tmp_path": base / str(index)} if "tmp_path" in parameters else {}
                if kwargs:
                    kwargs["tmp_path"].mkdir(parents=True, exist_ok=True)
                function(**kwargs)
                print(f"PASS {name}")
            except Exception as error:  # noqa: BLE001
                failures.append((name, error))
                print(f"FAIL {name}: {error}")

    print(f"\n{len(tests) - len(failures)}/{len(tests)} Python behavior tests passed")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

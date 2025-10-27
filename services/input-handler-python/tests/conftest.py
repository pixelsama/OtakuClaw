from __future__ import annotations

import sys
from pathlib import Path


def _ensure_repo_root() -> None:
    # Add project root and service directory so shared packages like `utils` resolve.
    tests_dir = Path(__file__).resolve().parent
    service_dir = tests_dir.parent
    repo_root = service_dir.parent.parent

    for path in (repo_root, service_dir):
        path_str = str(path)
        if path_str not in sys.path:
            sys.path.insert(0, path_str)


_ensure_repo_root()

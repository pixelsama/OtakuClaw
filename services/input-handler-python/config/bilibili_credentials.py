from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping, MutableMapping, Optional


class CredentialError(RuntimeError):
    """Raised when required Bilibili credentials are missing or malformed."""


@dataclass(slots=True)
class BilibiliCredentials:
    access_token: Optional[str]
    app_id: Optional[int]
    app_key: Optional[str]
    app_secret: Optional[str]
    anchor_code: Optional[str]

    @property
    def has_open_api(self) -> bool:
        return all([self.app_id, self.app_key, self.app_secret, self.anchor_code])

    def missing_open_api_fields(self) -> list[str]:
        fields = []
        if not self.app_id:
            fields.append("BILI_APP_ID")
        if not self.app_key:
            fields.append("BILI_APP_KEY")
        if not self.app_secret:
            fields.append("BILI_APP_SECRET")
        if not self.anchor_code:
            fields.append("BILI_ANCHOR_CODE")
        return fields


def _coerce_int(value: Optional[str]) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise CredentialError(f"Invalid integer credential value: {value}") from exc


def _load_from_file(path: Path) -> MutableMapping[str, str]:
    try:
        content = path.read_text(encoding="utf-8")
    except Exception as exc:
        raise CredentialError(f"Failed to read credential file {path}") from exc
    try:
        data = json.loads(content)
    except json.JSONDecodeError as exc:
        raise CredentialError(f"Credential file {path} is not valid JSON") from exc
    if not isinstance(data, Mapping):
        raise CredentialError(f"Credential file {path} must contain a JSON object")
    return {str(k): str(v) for k, v in data.items()}


def load_bilibili_credentials(
    env: Optional[Mapping[str, str]] = None,
    *,
    require_open_api: bool = False,
) -> BilibiliCredentials:
    """Load Bilibili credentials from environment or optional JSON file."""

    env_map = dict(env or os.environ)
    file_path = env_map.get("BILI_CREDENTIALS_PATH")
    file_values: MutableMapping[str, str] = {}
    if file_path:
        file_values = _load_from_file(Path(file_path))

    def _get(name: str) -> Optional[str]:
        if name in file_values:
            return file_values[name]
        return env_map.get(name)

    creds = BilibiliCredentials(
        access_token=_get("BILI_ACCESS_TOKEN"),
        app_id=_coerce_int(_get("BILI_APP_ID")),
        app_key=_get("BILI_APP_KEY"),
        app_secret=_get("BILI_APP_SECRET"),
        anchor_code=_get("BILI_ANCHOR_CODE"),
    )

    if require_open_api and not creds.has_open_api:
        missing = creds.missing_open_api_fields()
        raise CredentialError(
            "Missing required Bilibili open API credentials: " + ", ".join(missing)
        )

    return creds


__all__ = [
    "BilibiliCredentials",
    "CredentialError",
    "load_bilibili_credentials",
]


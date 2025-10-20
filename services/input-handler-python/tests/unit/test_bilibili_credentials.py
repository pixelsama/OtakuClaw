import json
from pathlib import Path

import pytest

from config.bilibili_credentials import (
    BilibiliCredentials,
    CredentialError,
    load_bilibili_credentials,
)


def test_load_credentials_from_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BILI_ACCESS_TOKEN", "token-abc")
    monkeypatch.setenv("BILI_APP_ID", "123")
    monkeypatch.setenv("BILI_APP_KEY", "key")
    monkeypatch.setenv("BILI_APP_SECRET", "secret")
    monkeypatch.setenv("BILI_ANCHOR_CODE", "anchor")

    creds = load_bilibili_credentials()

    assert isinstance(creds, BilibiliCredentials)
    assert creds.access_token == "token-abc"
    assert creds.app_id == 123
    assert creds.has_open_api


def test_load_credentials_from_file_override_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("BILI_APP_KEY", "env-key")
    file_data = {
        "BILI_ACCESS_TOKEN": "file-token",
        "BILI_APP_ID": 456,
        "BILI_APP_KEY": "file-key",
        "BILI_APP_SECRET": "file-secret",
        "BILI_ANCHOR_CODE": "file-anchor",
    }
    secret_file = tmp_path / "bili.json"
    secret_file.write_text(json.dumps(file_data), encoding="utf-8")
    monkeypatch.setenv("BILI_CREDENTIALS_PATH", str(secret_file))

    creds = load_bilibili_credentials()

    assert creds.access_token == "file-token"
    assert creds.app_id == 456
    assert creds.app_key == "file-key"
    assert creds.has_open_api


def test_missing_required_open_api_fields_raises(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("BILI_APP_ID", raising=False)
    monkeypatch.setenv("BILI_APP_KEY", "key-only")

    with pytest.raises(CredentialError):
        load_bilibili_credentials(require_open_api=True)


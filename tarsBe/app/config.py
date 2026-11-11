from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    switch: Literal["gemini", "openrouter"] = "gemini"
    openrouter_api: SecretStr = SecretStr("")
    openrouter_model: str = Field(default="google/gemini-2.5-flash", min_length=1, pattern=r"^\S+$")
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = Field(default="gemini-2.5-flash", pattern=r"^[\w.-]+$")
    database_path: str = "data/tutor.sqlite3"
    turn_timeout_seconds: float = Field(default=180, ge=1, le=180)
    model_timeout_seconds: float = Field(default=60, ge=1, le=90)
    max_concurrent_turns: int = Field(default=4, ge=1, le=32)
    backend_api_token: SecretStr = SecretStr("")
    cors_origins: list[str] = []
    # GNANI_API is the name used by the existing local configuration.
    # Both names are server-only; neither belongs in VITE_* variables.
    gnani_api_key: SecretStr = Field(default=SecretStr(""), validation_alias=AliasChoices("gnani_api_key", "GNANI_API_KEY", "GNANI_API"))
    gnani_tts_model: str = Field(default="timbre-v2.5", pattern=r"^timbre-v[\d.]+$")
    gnani_voice: str = Field(default="Kaveri", min_length=1, max_length=60)
    gnani_language: str = Field(default="en-IN", pattern=r"^[a-z]{2}-IN$")
    speech_timeout_seconds: float = Field(default=60, ge=1, le=120)

    @field_validator("switch", mode="before")
    @classmethod
    def normalize_switch(cls, value):
        return value.strip().lower() if isinstance(value, str) else value

    @property
    def llm_api_key(self) -> SecretStr:
        return self.openrouter_api if self.switch == "openrouter" else self.gemini_api_key

    @property
    def llm_model(self) -> str:
        return self.openrouter_model if self.switch == "openrouter" else self.gemini_model

    @property
    def missing_llm_key_message(self) -> str:
        key = "OPENROUTER_API" if self.switch == "openrouter" else "GEMINI_API_KEY"
        return f"Set {key} in tarsBe/.env and restart."

    @property
    def db_path(self) -> Path:
        path = Path(self.database_path)
        return path if path.is_absolute() else ROOT / path

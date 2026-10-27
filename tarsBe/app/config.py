from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")
    gemini_api_key: SecretStr = SecretStr("")
    gemini_model: str = Field(default="gemini-2.5-flash", pattern=r"^[\w.-]+$")
    database_path: str = "data/tutor.sqlite3"
    turn_timeout_seconds: float = Field(default=180, ge=1, le=180)
    model_timeout_seconds: float = Field(default=60, ge=1, le=90)
    max_concurrent_turns: int = Field(default=4, ge=1, le=32)
    backend_api_token: SecretStr = SecretStr("")
    cors_origins: list[str] = []

    @property
    def db_path(self) -> Path:
        path = Path(self.database_path)
        return path if path.is_absolute() else ROOT / path

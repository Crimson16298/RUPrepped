from __future__ import annotations

import os
from dataclasses import dataclass

from app.schemas import ProviderMode


@dataclass(frozen=True)
class Settings:
    provider_mode: ProviderMode
    gemini_api_key: str | None
    gemini_model: str
    gemini_timeout_ms: int


def get_settings() -> Settings:
    raw_mode = os.getenv("INTERVIEW_PROVIDER", "mock").lower()
    try:
        provider_mode = ProviderMode(raw_mode)
    except ValueError as exc:
        raise ValueError("INTERVIEW_PROVIDER must be either 'mock' or 'gemini'.") from exc
    timeout_ms = int(os.getenv("GEMINI_TIMEOUT_MS", "10000"))
    if timeout_ms < 1 or timeout_ms > 60000:
        raise ValueError("GEMINI_TIMEOUT_MS must be between 1 and 60000.")
    return Settings(
        provider_mode=provider_mode,
        gemini_api_key=os.getenv("GEMINI_API_KEY"),
        gemini_model=os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite"),
        gemini_timeout_ms=timeout_ms,
    )

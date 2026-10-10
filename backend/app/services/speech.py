"""ElevenLabs text-to-speech support for interviewer prompts.

This module deliberately has no FastAPI dependency.  A future API route can
call :func:`synthesize_speech` and return the resulting MP3 bytes directly.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from io import BytesIO
from typing import Iterable


DEFAULT_MODEL_ID = "eleven_flash_v2_5"
DEFAULT_OUTPUT_FORMAT = "mp3_44100_128"
DEFAULT_TRANSCRIPTION_MODEL_ID = "scribe_v2"


class SpeechConfigurationError(ValueError):
    """Raised when the required ElevenLabs configuration is unavailable."""


class SpeechSynthesisError(RuntimeError):
    """Raised when ElevenLabs cannot generate audio for a prompt."""


class SpeechTranscriptionError(RuntimeError):
    """Raised when ElevenLabs cannot transcribe recorded candidate audio."""


@dataclass(frozen=True)
class SpeechSettings:
    """Configuration needed to generate interviewer audio."""

    api_key: str
    voice_id: str
    model_id: str = DEFAULT_MODEL_ID

    @classmethod
    def from_environment(cls) -> "SpeechSettings":
        """Load settings without ever exposing secret values in error messages."""
        _load_dotenv_if_available()
        api_key = os.getenv("ELEVENLABS_API_KEY", "").strip()
        voice_id = os.getenv("ELEVENLABS_VOICE_ID", "").strip()
        model_id = os.getenv("ELEVENLABS_MODEL_ID", DEFAULT_MODEL_ID).strip()

        missing = []
        if not api_key:
            missing.append("ELEVENLABS_API_KEY")
        if not voice_id:
            missing.append("ELEVENLABS_VOICE_ID")
        if missing:
            raise SpeechConfigurationError(
                "Missing required ElevenLabs environment variable(s): "
                + ", ".join(missing)
            )

        return cls(api_key=api_key, voice_id=voice_id, model_id=model_id or DEFAULT_MODEL_ID)


def _load_dotenv_if_available() -> None:
    """Load a local .env when python-dotenv is installed with the backend."""
    try:
        from dotenv import load_dotenv
    except ImportError:
        return

    load_dotenv()


def _create_client(api_key: str):
    """Create the SDK client only when TTS is actually requested."""
    try:
        from elevenlabs.client import ElevenLabs
    except ImportError as error:
        raise SpeechConfigurationError(
            "The ElevenLabs SDK is not installed. Install the 'elevenlabs' package."
        ) from error

    return ElevenLabs(api_key=api_key)


def _audio_bytes(chunks: Iterable[bytes]) -> bytes:
    """Materialize the byte iterator returned by the ElevenLabs SDK."""
    return b"".join(chunks)


def _provider_error_message(error: Exception) -> str:
    """Turn known provider failures into safe, actionable application errors."""
    status_code = getattr(error, "status_code", None)
    body = getattr(error, "body", None)
    detail = body.get("detail", {}) if isinstance(body, dict) else {}

    if status_code == 402 and detail.get("code") == "paid_plan_required":
        return (
            "ElevenLabs rejected the selected voice. Free accounts cannot use "
            "Voice Library voices through the API. Set ELEVENLABS_VOICE_ID to "
            "an eligible voice on your account or upgrade your ElevenLabs plan."
        )

    return "ElevenLabs could not generate interviewer audio."


def synthesize_speech(text: str, *, settings: SpeechSettings | None = None) -> bytes:
    """Convert a non-empty interviewer prompt into MP3 audio bytes.

    ``settings`` is injectable to make the provider boundary straightforward
    to test.  Production callers should leave it unset and configure the
    ``ELEVENLABS_*`` environment variables.
    """
    if not isinstance(text, str) or not text.strip():
        raise ValueError("Speech text must be a non-empty string.")

    active_settings = settings or SpeechSettings.from_environment()

    try:
        client = _create_client(active_settings.api_key)
        audio = client.text_to_speech.convert(
            text=text.strip(),
            voice_id=active_settings.voice_id,
            model_id=active_settings.model_id,
            output_format=DEFAULT_OUTPUT_FORMAT,
        )
        return _audio_bytes(audio)
    except SpeechConfigurationError:
        raise
    except Exception as error:
        raise SpeechSynthesisError(_provider_error_message(error)) from error


def transcribe_audio(
    audio: bytes,
    *,
    filename: str = "answer.webm",
    settings: SpeechSettings | None = None,
) -> str:
    """Return a non-empty transcript for a browser-recorded audio file.

    The file is held in memory only for the request.  Callers are responsible
    for validating file type and size before invoking this provider boundary.
    """
    if not audio:
        raise ValueError("Recorded audio must not be empty.")

    active_settings = settings or SpeechSettings.from_environment()
    audio_file = BytesIO(audio)
    audio_file.name = filename

    try:
        client = _create_client(active_settings.api_key)
        transcription = client.speech_to_text.convert(
            file=audio_file,
            model_id=DEFAULT_TRANSCRIPTION_MODEL_ID,
        )
        transcript = getattr(transcription, "text", "")
        if not isinstance(transcript, str) or not transcript.strip():
            raise SpeechTranscriptionError("ElevenLabs returned an empty transcript. Please record your answer again.")
        return transcript.strip()
    except (SpeechConfigurationError, SpeechTranscriptionError):
        raise
    except Exception as error:
        raise SpeechTranscriptionError("ElevenLabs could not transcribe the recorded answer. Please try again.") from error

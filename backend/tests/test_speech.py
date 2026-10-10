"""Offline tests for the ElevenLabs speech provider boundary."""

import unittest
from unittest.mock import Mock, patch

from backend.app.services.speech import (
    SpeechConfigurationError,
    SpeechSynthesisError,
    SpeechSettings,
    synthesize_speech,
)


class SpeechServiceTests(unittest.TestCase):
    def test_synthesize_speech_returns_audio_and_uses_configured_voice(self) -> None:
        client = Mock()
        client.text_to_speech.convert.return_value = iter((b"mp3-", b"audio"))
        settings = SpeechSettings(
            api_key="test-key",
            voice_id="test-voice",
            model_id="test-model",
        )

        with patch("backend.app.services.speech._create_client", return_value=client):
            audio = synthesize_speech("  Please introduce yourself.  ", settings=settings)

        self.assertEqual(audio, b"mp3-audio")
        client.text_to_speech.convert.assert_called_once_with(
            text="Please introduce yourself.",
            voice_id="test-voice",
            model_id="test-model",
            output_format="mp3_44100_128",
        )

    def test_environment_settings_require_key_and_voice_id(self) -> None:
        with patch.dict("os.environ", {}, clear=True):
            with patch("backend.app.services.speech._load_dotenv_if_available"):
                with self.assertRaises(SpeechConfigurationError) as context:
                    SpeechSettings.from_environment()

        self.assertIn("ELEVENLABS_API_KEY", str(context.exception))
        self.assertIn("ELEVENLABS_VOICE_ID", str(context.exception))

    def test_synthesize_speech_rejects_blank_text(self) -> None:
        with self.assertRaisesRegex(ValueError, "non-empty"):
            synthesize_speech("   ", settings=SpeechSettings("key", "voice"))

    def test_synthesize_speech_explains_ineligible_library_voice(self) -> None:
        class PaidPlanRequiredError(Exception):
            status_code = 402
            body = {"detail": {"code": "paid_plan_required"}}

        client = Mock()
        client.text_to_speech.convert.return_value = iter(())
        settings = SpeechSettings("test-key", "library-voice")

        with patch("backend.app.services.speech._create_client", return_value=client):
            with patch(
                "backend.app.services.speech._audio_bytes",
                side_effect=PaidPlanRequiredError(),
            ):
                with self.assertRaisesRegex(
                    SpeechSynthesisError, "Free accounts cannot use Voice Library voices"
                ):
                    synthesize_speech("Please introduce yourself.", settings=settings)


if __name__ == "__main__":
    unittest.main()

"""Create a local MP3 from a fixed interviewer question.

Run from the repository root after configuring ElevenLabs environment
variables: ``python backend/scripts/voice_smoke_test.py``.
"""

from pathlib import Path
import sys


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.speech import synthesize_speech


QUESTION = "Tell me about a challenging project and how you approached it."
OUTPUT_PATH = PROJECT_ROOT / "backend" / ".local" / "voice-smoke-test.mp3"


def main() -> None:
    """Generate one fixed question and save it for a manual listening check."""
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_bytes(synthesize_speech(QUESTION))
    print(f"Generated interviewer audio: {OUTPUT_PATH}")


if __name__ == "__main__":
    main()

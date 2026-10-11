"""In-memory, conservative extraction of resume text from PDF and TXT uploads."""

from __future__ import annotations

from io import BytesIO

from pypdf import PdfReader


MAX_RESUME_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_RESUME_TEXT_CHARS = 20_000


class ResumeExtractionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _normalize_text(text: str) -> str:
    """Preserve useful resume layout while removing only transport whitespace."""
    lines = text.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    normalized: list[str] = []
    blank_run = 0
    for line in lines:
        line = line.rstrip()
        if not line.strip():
            blank_run += 1
            if blank_run <= 2:
                normalized.append("")
        else:
            blank_run = 0
            normalized.append(line)
    return "\n".join(normalized).strip()[:MAX_RESUME_TEXT_CHARS].strip()


def _extract_pdf(data: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(data))
        if reader.is_encrypted:
            raise ResumeExtractionError(
                "resume_unextractable",
                "The PDF is encrypted and cannot be read. Upload an unencrypted PDF or TXT file.",
            )
        text = "\n".join(page.extract_text() or "" for page in reader.pages)
    except ResumeExtractionError:
        raise
    except Exception as exc:
        raise ResumeExtractionError(
            "resume_unextractable",
            "The PDF is corrupt or unreadable. Upload a valid text-based PDF or TXT file.",
        ) from exc
    return _normalize_text(text)


def extract_resume_text(data: bytes, *, filename: str | None, content_type: str | None) -> str:
    """Return bounded text for a supported, non-empty resume upload.

    The caller is responsible for applying the streaming upload byte limit. PDF
    detection uses its content signature, while TXT input must decode strictly as
    UTF-8; a filename alone never determines a file's content type.
    """
    if not data:
        raise ResumeExtractionError("resume_empty", "The uploaded resume file is empty.")

    lowered_name = (filename or "").lower()
    media_type = (content_type or "").split(";", maxsplit=1)[0].strip().lower()
    is_pdf_signature = data.lstrip().startswith(b"%PDF-")

    if is_pdf_signature:
        extracted = _extract_pdf(data)
    else:
        if lowered_name.endswith(".pdf") or media_type == "application/pdf":
            raise ResumeExtractionError(
                "resume_unextractable",
                "The uploaded PDF is corrupt or unreadable. Upload a valid text-based PDF or TXT file.",
            )
        if not (lowered_name.endswith(".txt") or media_type == "text/plain"):
            raise ResumeExtractionError(
                "unsupported_resume_type",
                "Upload a PDF or UTF-8 TXT resume file.",
            )
        try:
            extracted = _normalize_text(data.decode("utf-8-sig"))
        except UnicodeDecodeError as exc:
            raise ResumeExtractionError(
                "invalid_resume_text_encoding",
                "TXT resumes must be encoded as UTF-8.",
            ) from exc

    if not extracted.strip():
        raise ResumeExtractionError(
            "resume_unextractable",
            "The resume contains no extractable text. Upload a text-based PDF or a non-empty TXT file.",
        )
    return extracted

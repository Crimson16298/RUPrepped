"""Illustrative FastAPI-side subprocess boundary; do not copy secrets into input."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path


async def request_calibration(payload: dict[str, object]) -> dict[str, object]:
    package_root = Path(__file__).resolve().parents[1]
    process = await asyncio.create_subprocess_exec(
        "node",
        str(package_root / "dist" / "src" / "cli.js"),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _stderr = await asyncio.wait_for(
            process.communicate(json.dumps(payload).encode("utf-8")), timeout=2.0
        )
    except TimeoutError:
        process.kill()
        await process.wait()
        return {"ok": False, "error": "calibration_unavailable"}
    if process.returncode != 0:
        return {"ok": False, "error": "calibration_unavailable"}
    return json.loads(stdout)

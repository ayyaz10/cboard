"""Local HTTP wrapper for PaddleOCR-VL nutrition-label document parsing."""
from __future__ import annotations

import logging
import os
import tempfile
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_PIXELS = 60_000_000
ALLOWED_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
PIPELINE_VERSION = "v1.6"
pipeline = None
pipeline_error: str | None = None
inference_lock = threading.Lock()
logger = logging.getLogger("cboard-nutrition-ocr")


def configured_origins() -> list[str]:
    raw = os.getenv("CBOARD_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


@asynccontextmanager
async def lifespan(_: FastAPI):
    global pipeline, pipeline_error
    try:
        from paddleocr import PaddleOCRVL

        pipeline = PaddleOCRVL(
            pipeline_version=PIPELINE_VERSION,
            device=os.getenv("PADDLEOCR_DEVICE", "cpu"),
            engine="transformers",
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            use_layout_detection=True,
        )
        pipeline_error = None
    except Exception as exc:  # Keep health endpoint available for diagnosis.
        pipeline = None
        pipeline_error = f"{type(exc).__name__}: {exc}"
        logger.exception("Unable to load PaddleOCR-VL pipeline")
    yield
    pipeline = None


app = FastAPI(title="CBoard Nutrition OCR", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=configured_origins(),
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.middleware("http")
async def limit_request_body(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_IMAGE_BYTES + 1024 * 1024:
        return JSONResponse(status_code=413, content={"detail": "Nutrition label images must be 15 MB or smaller."})
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, max-age=0"
    return response


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ready" if pipeline is not None else "unavailable",
        "provider": "paddleocr-vl",
        "model": "PaddleOCR-VL-1.6-0.9B",
        "pipelineVersion": PIPELINE_VERSION,
        "device": os.getenv("PADDLEOCR_DEVICE", "cpu"),
        "modelLoaded": pipeline is not None,
        "authRequired": os.getenv("NUTRITION_OCR_REQUIRE_AUTH", "false").lower() == "true",
        "error": pipeline_error.split(":", 1)[0] if pipeline_error else None,
    }


async def verify_cboard_session(authorization: str | None) -> None:
    if os.getenv("NUTRITION_OCR_REQUIRE_AUTH", "false").lower() != "true":
        return
    supabase_url = os.getenv("SUPABASE_URL", "").rstrip("/")
    anon_key = os.getenv("SUPABASE_ANON_KEY", "")
    if not supabase_url or not anon_key:
        raise HTTPException(status_code=503, detail="OCR service authentication is not configured.")
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sign in to use the advanced nutrition scanner.")
    try:
        import httpx

        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{supabase_url}/auth/v1/user",
                headers={"apikey": anon_key, "Authorization": authorization},
            )
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Your session is invalid or expired. Sign in again.")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Could not validate the CBoard session.") from exc


def validate_image(path: Path) -> None:
    try:
        with Image.open(path) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise HTTPException(status_code=415, detail="Choose a JPEG, PNG or WEBP nutrition label.")
            if not image.width or not image.height or image.width * image.height > MAX_PIXELS:
                raise HTTPException(status_code=413, detail="Nutrition label images must be 60 megapixels or smaller.")
            image.verify()
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=400, detail="The uploaded image could not be opened.") from exc


def run_pipeline(path: Path) -> dict[str, Any]:
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Advanced nutrition scanner is unavailable.")
    if not inference_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="The nutrition scanner is busy. Try again in a moment.")
    try:
        results = list(pipeline.predict(input=str(path)))
    finally:
        inference_lock.release()
    if not results:
        raise HTTPException(status_code=422, detail="No document result was produced for this image.")
    result = results[0].json
    # Remove local temporary paths before returning document evidence.
    inner = result.get("res") if isinstance(result, dict) else None
    if isinstance(inner, dict):
        inner.pop("input_path", None)
    result.pop("input_path", None)
    return result


@app.post("/api/nutrition-ocr")
async def nutrition_ocr(image: UploadFile = File(...), authorization: str | None = Header(default=None)) -> dict[str, Any]:
    await verify_cboard_session(authorization)
    suffix = ALLOWED_TYPES.get((image.content_type or "").lower())
    if not suffix:
        raise HTTPException(status_code=415, detail="Choose a JPEG, PNG or WEBP nutrition label.")
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Advanced nutrition scanner is unavailable.")

    data = await image.read(MAX_IMAGE_BYTES + 1)
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Nutrition label images must be 15 MB or smaller.")

    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="cboard-nutrition-", suffix=suffix, delete=False) as temp:
            temp.write(data)
            temp_path = Path(temp.name)
        validate_image(temp_path)
        document = await run_in_threadpool(run_pipeline, temp_path)
        return {
            "provider": {"name": "paddleocr-vl", "model": "PaddleOCR-VL-1.6-0.9B", "pipelineVersion": PIPELINE_VERSION},
            "document": document,
        }
    finally:
        data = b""
        await image.close()
        if temp_path is not None:
            try:
                temp_path.unlink(missing_ok=True)
            except OSError:
                pass

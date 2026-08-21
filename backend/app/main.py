from __future__ import annotations

import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import voices
from .config import (
    API_KEY,
    BATCH_SIZE,
    FRONTEND_DIST,
    LANGUAGE,
    MODEL_DIR,
    MODEL_ID,
    OUTPUT_DIR,
)
from .engine import engine
from .jobs import public_job, runner


def _check_key(authorization: Optional[str]) -> None:
    if not API_KEY:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        engine.load()
    except Exception as exc:
        print(f"[qwen-tts] model will load on first request: {exc}")
    yield


app = FastAPI(title="Qwen3-TTS Dubbing Studio", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SpeechRequest(BaseModel):
    model: str = "tts-1"
    input: str
    voice: Optional[str] = None
    response_format: str = "wav"
    speed: float = 1.0
    ref_audio: Optional[str] = None
    ref_text: Optional[str] = None
    language: str = LANGUAGE
    batch_size: int = BATCH_SIZE


class JobRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    ref_audio: Optional[str] = None
    ref_text: Optional[str] = None
    batch_size: int = Field(default=BATCH_SIZE, ge=1, le=8)
    language: str = LANGUAGE


def _resolve_clone(voice: Optional[str], ref_audio: Optional[str], ref_text: Optional[str]) -> tuple[str, str]:
    if voice and voice.startswith("clone:"):
        profile = voices.get_voice(voice.split(":", 1)[1])
        return profile["ref_audio"], profile["ref_text"]
    if voice:
        try:
            profile = voices.get_voice(voice)
            return profile["ref_audio"], profile["ref_text"]
        except KeyError:
            pass
    if ref_audio and ref_text:
        return ref_audio, ref_text
    raise HTTPException(
        status_code=400,
        detail="Voice cloning requires a saved voice or both ref_audio and ref_text",
    )


@app.get("/health")
def health():
    return {
        "ok": True,
        "model_id": MODEL_ID,
        "model_path": engine.model_path,
        "model_loaded": engine.loaded,
        "model_dir_ready": (MODEL_DIR / "config.json").exists(),
        "batch_size": BATCH_SIZE,
        "last_stats": engine.last_stats,
    }


@app.get("/v1/models")
def list_models():
    return {
        "object": "list",
        "data": [
            {
                "id": "tts-1",
                "object": "model",
                "owned_by": "qwen3-tts",
                "root": MODEL_ID,
            }
        ],
    }


@app.get("/api/voices")
def api_voices():
    return {"data": voices.list_voices()}


@app.post("/api/voices")
async def api_create_voice(
    name: str = Form(...),
    ref_text: str = Form(...),
    ref_audio: UploadFile = File(...),
):
    if not ref_text.strip():
        raise HTTPException(status_code=400, detail="ref_text is required")
    suffix = Path(ref_audio.filename or "ref.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await ref_audio.read())
        tmp_path = Path(tmp.name)
    try:
        item = voices.create_voice(name, tmp_path, ref_text)
    finally:
        tmp_path.unlink(missing_ok=True)
    return item


@app.delete("/api/voices/{voice_id}")
def api_delete_voice(voice_id: str):
    voices.delete_voice(voice_id)
    return {"ok": True}


@app.post("/api/jobs")
async def api_create_job(
    text: Optional[str] = Form(None),
    voice_id: Optional[str] = Form(None),
    ref_text: Optional[str] = Form(None),
    batch_size: int = Form(BATCH_SIZE),
    language: str = Form(LANGUAGE),
    ref_audio: Optional[UploadFile] = File(None),
):
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="text is required")

    temp_ref: Optional[Path] = None
    try:
        if ref_audio is not None and ref_audio.filename:
            suffix = Path(ref_audio.filename).suffix or ".wav"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(await ref_audio.read())
                temp_ref = Path(tmp.name)
            audio_path, transcript = str(temp_ref), (ref_text or "")
            if not transcript.strip():
                raise HTTPException(status_code=400, detail="ref_text is required with uploaded audio")
        else:
            audio_path, transcript = _resolve_clone(voice_id, None, None)
        job = runner.submit(
            text=text.strip(),
            ref_audio=audio_path,
            ref_text=transcript,
            batch_size=batch_size,
            language=language,
        )
        return public_job(job)
    except KeyError:
        raise HTTPException(status_code=404, detail="Voice not found")
    except HTTPException:
        if temp_ref:
            temp_ref.unlink(missing_ok=True)
        raise
    except Exception:
        if temp_ref:
            temp_ref.unlink(missing_ok=True)
        raise


@app.post("/api/jobs/json")
def api_create_job_json(payload: JobRequest):
    try:
        audio_path, transcript = _resolve_clone(payload.voice_id, payload.ref_audio, payload.ref_text)
    except KeyError:
        raise HTTPException(status_code=404, detail="Voice not found")
    job = runner.submit(
        text=payload.text.strip(),
        ref_audio=audio_path,
        ref_text=transcript,
        batch_size=payload.batch_size,
        language=payload.language,
    )
    return public_job(job)


@app.get("/api/jobs/{job_id}")
def api_get_job(job_id: str):
    try:
        return public_job(runner.get(job_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="Job not found")


@app.get("/api/jobs/{job_id}/audio")
def api_job_audio(job_id: str):
    try:
        job = runner.get(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "done" or not job.stats.get("output_path"):
        raise HTTPException(status_code=409, detail="Audio is not ready")
    path = Path(job.stats["output_path"])
    return FileResponse(path, media_type="audio/wav", filename=f"{job_id}.wav")


@app.post("/v1/audio/speech")
def openai_speech(payload: SpeechRequest, authorization: Optional[str] = Header(None)):
    _check_key(authorization)
    if not payload.input.strip():
        raise HTTPException(status_code=400, detail="input is required")
    try:
        ref_audio, ref_text = _resolve_clone(payload.voice, payload.ref_audio, payload.ref_text)
        stats = engine.synthesize(
            payload.input,
            ref_audio,
            ref_text,
            batch_size=payload.batch_size,
            language=payload.language,
        )
        from .audio_util import convert_format

        body, media_type = convert_format(Path(stats["output_path"]), payload.response_format)
        ext = "wav" if media_type == "audio/wav" else payload.response_format
        return Response(
            content=body,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="speech.{ext}"'},
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Voice not found")
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/v1/audio/clone")
async def openai_clone(
    input: str = Form(...),
    ref_text: str = Form(...),
    ref_audio: UploadFile = File(...),
    response_format: str = Form("wav"),
    language: str = Form(LANGUAGE),
    batch_size: int = Form(BATCH_SIZE),
    authorization: Optional[str] = Header(None),
):
    _check_key(authorization)
    suffix = Path(ref_audio.filename or "ref.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await ref_audio.read())
        tmp_path = Path(tmp.name)
    try:
        stats = engine.synthesize(
            input,
            str(tmp_path),
            ref_text,
            batch_size=batch_size,
            language=language,
        )
        from .audio_util import convert_format

        body, media_type = convert_format(Path(stats["output_path"]), response_format)
        ext = "wav" if media_type == "audio/wav" else response_format
        return Response(
            content=body,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="speech.{ext}"'},
        )
    finally:
        tmp_path.unlink(missing_ok=True)


if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="ui")
else:

    @app.get("/")
    def root():
        return JSONResponse(
            {
                "service": "Qwen3-TTS Dubbing Studio",
                "docs": "/docs",
                "health": "/health",
                "hint": "Build the React app with `npm run build` in frontend/",
            }
        )

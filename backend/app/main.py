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

from . import audio_util, scripts, voices
from .config import (
    API_KEY,
    ASR_MODEL_DIR,
    ASR_MODEL_ID,
    BATCH_SIZE,
    CUSTOM_MODEL_DIR,
    CUSTOM_MODEL_ID,
    DEFAULT_SPEAKER,
    DESIGN_MODEL_DIR,
    DESIGN_MODEL_ID,
    FRONTEND_DIST,
    LANGUAGE,
    LANGUAGES,
    LANGUAGE_BY_ID,
    MODEL_DIR,
    MODEL_ID,
    SPEAKER_BY_ID,
    SPEAKERS,
    TTS_TEMPERATURE,
)
from .asr import asr_engine, asr_runner, public_asr_job
from .chunking import preview_segments
from .engine import engine
from .job_assets import full_wav, segment_wav, track_wav, zip_bytes
from .job_repo import JobBusy, delete_job, get_public, item_list, list_public
from .jobs import public_job, runner
from .modes import parse_mode
from .paths import is_local_model_dir
from .script_import import import_spreadsheet
from .voice_assembly import assemble_job_voices


def _check_key(authorization: Optional[str]) -> None:
    if not API_KEY:
        return
    token = (authorization or "").removeprefix("Bearer ").strip()
    if token != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")


def _wav_response(path: Path, filename: str, download: bool) -> FileResponse:
    if not path.exists():
        raise HTTPException(status_code=404, detail="Audio is not ready")
    if download:
        return FileResponse(
            path,
            media_type="audio/wav",
            filename=filename,
            content_disposition_type="attachment",
        )
    return FileResponse(
        audio_util.browser_wav(path),
        media_type="audio/wav",
        filename=filename,
        content_disposition_type="inline",
    )


@asynccontextmanager
async def lifespan(_app: FastAPI):
    try:
        engine.load("preset")
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
    instruct: Optional[str] = None
    mode: str = "preset"
    speaker: Optional[str] = None


class SplitRequest(BaseModel):
    text: str
    language: str = LANGUAGE


class VoiceRenameRequest(BaseModel):
    name: str


class ScriptCreateRequest(BaseModel):
    name: str
    markdown: str
    language: str = LANGUAGE


class ScriptUpdateRequest(BaseModel):
    name: Optional[str] = None
    markdown: Optional[str] = None
    language: Optional[str] = None


def _normalize_mode(mode: str | None) -> str:
    try:
        return parse_mode(mode, strict=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _normalize_speaker(speaker: str | None) -> str:
    value = (speaker or DEFAULT_SPEAKER).strip()
    if value not in SPEAKER_BY_ID:
        raise HTTPException(status_code=400, detail=f"Unknown speaker: {speaker}")
    return value


def _assemble_job_voices(
    mode: str,
    *,
    speakers: Optional[str] = None,
    speaker: Optional[str] = None,
    voice_id: Optional[str] = None,
    voice_ids: Optional[str] = None,
    designs: Optional[str] = None,
    instruct: Optional[str] = None,
    style_instruct: Optional[str] = None,
    ref_audio: str = "",
    ref_text: str = "",
) -> tuple[str, list[dict], str, str, str, str]:
    try:
        return assemble_job_voices(
            mode,
            speakers=speakers,
            speaker=speaker,
            voice_id=voice_id,
            voice_ids=voice_ids,
            designs=designs,
            instruct=instruct,
            style_instruct=style_instruct,
            ref_audio=ref_audio,
            ref_text=ref_text,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _current_model_id() -> str:
    if engine.mode == "design":
        return DESIGN_MODEL_ID
    if engine.mode == "preset":
        return CUSTOM_MODEL_ID
    return MODEL_ID


def _normalize_language(language: str | None) -> str:
    value = (language or LANGUAGE).strip() or LANGUAGE
    if value not in LANGUAGE_BY_ID:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {value}")
    return value


def _form_flag(value: Optional[str], default: bool = True) -> bool:
    if value is None or str(value).strip() == "":
        return default
    return str(value).strip().lower() not in {"0", "false", "no", "off"}


def _form_float(value: Optional[str], default: float, lo: float = 0.05, hi: float = 1.5) -> float:
    if value is None or str(value).strip() == "":
        return default
    try:
        return max(lo, min(hi, float(value)))
    except ValueError:
        return default


class JobRequest(BaseModel):
    text: str
    voice_id: Optional[str] = None
    ref_audio: Optional[str] = None
    ref_text: Optional[str] = None
    batch_size: int = Field(default=BATCH_SIZE, ge=1, le=8)
    language: str = LANGUAGE
    mode: str = "preset"
    instruct: Optional[str] = None
    speaker: Optional[str] = None
    speakers: Optional[str] = None
    voice_ids: Optional[str] = None
    designs: Optional[str] = None
    style_instruct: Optional[str] = None
    stable: bool = True
    temperature: float = Field(default=TTS_TEMPERATURE, ge=0.05, le=1.5)
    script_name: Optional[str] = None
    verify_asr: bool = False


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
        "model_id": _current_model_id(),
        "model_path": engine.model_path,
        "model_loaded": engine.loaded,
        "model_dir_ready": is_local_model_dir(MODEL_DIR),
        "design_model_id": DESIGN_MODEL_ID,
        "design_model_ready": is_local_model_dir(DESIGN_MODEL_DIR),
        "custom_model_id": CUSTOM_MODEL_ID,
        "custom_model_ready": is_local_model_dir(CUSTOM_MODEL_DIR),
        "asr_model_id": ASR_MODEL_ID,
        "asr_model_path": asr_engine.model_path,
        "asr_model_ready": is_local_model_dir(ASR_MODEL_DIR),
        "asr_loaded": asr_engine.loaded,
        "current_mode": engine.mode,
        "default_speaker": DEFAULT_SPEAKER,
        "batch_size": BATCH_SIZE,
        "languages": LANGUAGES,
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
            },
            {
                "id": "whisper-1",
                "object": "model",
                "owned_by": "qwen3-asr",
                "root": ASR_MODEL_ID,
            }
        ],
    }


@app.get("/api/voices")
def api_voices():
    return {"data": voices.list_voices()}


@app.get("/api/speakers")
def api_speakers():
    return {"data": SPEAKERS, "default": DEFAULT_SPEAKER}


@app.get("/api/speakers/{speaker_id}/preview")
def api_speaker_preview(speaker_id: str):
    try:
        path = engine.preview_speaker(speaker_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Speaker not found")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        audio_util.browser_wav(path),
        media_type="audio/wav",
        filename=f"{speaker_id}.wav",
        content_disposition_type="inline",
    )


@app.get("/api/languages")
def api_languages():
    return {"data": LANGUAGES, "default": LANGUAGE}


@app.post("/api/split")
def api_split(payload: SplitRequest):
    language = _normalize_language(payload.language)
    segments = preview_segments(payload.text, language)
    return {"language": language, "count": len(segments), "segments": segments}


@app.post("/api/import-script")
async def api_import_script(file: UploadFile = File(...)):
    filename = file.filename or "script.xlsx"
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="空文件")
    try:
        return import_spreadsheet(data, filename)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"无法读取表格：{exc}") from exc


@app.get("/api/scripts")
def api_scripts():
    return {"data": scripts.list_scripts()}


@app.post("/api/scripts")
def api_create_script(payload: ScriptCreateRequest):
    try:
        return scripts.create_script(
            payload.name,
            payload.markdown,
            _normalize_language(payload.language),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/scripts/{script_id}")
def api_get_script(script_id: str):
    try:
        return scripts.get_script(script_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="找不到这份配音列表")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/api/scripts/{script_id}")
def api_update_script(script_id: str, payload: ScriptUpdateRequest):
    language = _normalize_language(payload.language) if payload.language is not None else None
    try:
        return scripts.update_script(
            script_id,
            name=payload.name,
            markdown=payload.markdown,
            language=language,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="找不到这份配音列表")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/scripts/{script_id}")
def api_delete_script(script_id: str):
    scripts.delete_script(script_id)
    return {"ok": True}


@app.post("/api/transcribe")
async def api_transcribe(
    audio: UploadFile = File(...),
    language: str = Form(LANGUAGE),
    context: Optional[str] = Form(None),
):
    suffix = Path(audio.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await audio.read())
        tmp_path = Path(tmp.name)
    job = asr_runner.submit(
        audio_path=str(tmp_path),
        language=_normalize_language(language),
        context=context or "",
    )
    return public_asr_job(job)


@app.get("/api/transcribe/{job_id}")
def api_get_transcribe(job_id: str):
    try:
        return public_asr_job(asr_runner.get(job_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="Transcription job not found")


@app.post("/api/transcribe/{job_id}/cancel")
def api_cancel_transcribe(job_id: str):
    try:
        return public_asr_job(asr_runner.cancel(job_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="Transcription job not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/v1/audio/transcriptions")
async def openai_transcriptions(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    prompt: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
):
    _check_key(authorization)
    lang = language if language in LANGUAGE_BY_ID else LANGUAGE
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = Path(tmp.name)
    try:
        result = asr_engine.transcribe(
            str(tmp_path),
            language=_normalize_language(lang),
            context=prompt or "",
        )
        return {"text": result["text"], **result}
    except FileNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        tmp_path.unlink(missing_ok=True)


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


@app.patch("/api/voices/{voice_id}")
def api_rename_voice(voice_id: str, payload: VoiceRenameRequest):
    try:
        return voices.rename_voice(voice_id, payload.name)
    except KeyError:
        raise HTTPException(status_code=404, detail="Voice not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.delete("/api/voices/{voice_id}")
def api_delete_voice(voice_id: str):
    voices.delete_voice(voice_id)
    return {"ok": True}


@app.get("/api/voices/{voice_id}/audio")
def api_voice_audio(voice_id: str):
    try:
        profile = voices.get_voice(voice_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Voice not found")
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        audio_util.browser_wav(Path(profile["ref_audio"])),
        media_type="audio/wav",
        filename=f"{voice_id}.wav",
        content_disposition_type="inline",
    )


@app.post("/api/jobs")
async def api_create_job(
    text: Optional[str] = Form(None),
    voice_id: Optional[str] = Form(None),
    ref_text: Optional[str] = Form(None),
    batch_size: int = Form(BATCH_SIZE),
    language: str = Form(LANGUAGE),
    mode: str = Form("preset"),
    instruct: Optional[str] = Form(None),
    speaker: Optional[str] = Form(None),
    speakers: Optional[str] = Form(None),
    voice_ids: Optional[str] = Form(None),
    designs: Optional[str] = Form(None),
    style_instruct: Optional[str] = Form(None),
    stable: Optional[str] = Form("true"),
    temperature: Optional[str] = Form(None),
    script_name: Optional[str] = Form(None),
    title: Optional[str] = Form(None),
    verify_asr: Optional[str] = Form("false"),
    ref_audio: Optional[UploadFile] = File(None),
):
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="text is required")

    requested_mode = _normalize_mode(mode)
    speaker_id = ""
    job_voices: list[dict] = []
    temp_ref: Optional[Path] = None
    audio_path, transcript = "", ""
    description = (instruct or "").strip()
    try:
        upload_path, upload_text = "", ""
        if ref_audio is not None and ref_audio.filename:
            suffix = Path(ref_audio.filename).suffix or ".wav"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(await ref_audio.read())
                temp_ref = Path(tmp.name)
            upload_path, upload_text = str(temp_ref), (ref_text or "")
            if not upload_text.strip():
                raise HTTPException(status_code=400, detail="ref_text is required with uploaded audio")
        job_mode, job_voices, speaker_id, audio_path, transcript, description = _assemble_job_voices(
            requested_mode,
            speakers=speakers,
            speaker=speaker,
            voice_id=voice_id,
            voice_ids=voice_ids,
            designs=designs,
            instruct=instruct,
            style_instruct=style_instruct,
            ref_audio=upload_path,
            ref_text=upload_text,
        )
        job = runner.submit(
            text=text.strip(),
            ref_audio=audio_path,
            ref_text=transcript,
            batch_size=batch_size,
            language=_normalize_language(language),
            mode=job_mode,
            instruct=description,
            speaker=speaker_id,
            voices=job_voices,
            stable=_form_flag(stable, True),
            temperature=_form_float(temperature, TTS_TEMPERATURE),
            script_name=(script_name or title or "").strip() or "文稿",
            verify_asr=_form_flag(verify_asr, False),
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
        job_mode, job_voices, speaker_id, audio_path, transcript, description = _assemble_job_voices(
            _normalize_mode(payload.mode),
            speakers=payload.speakers,
            speaker=payload.speaker,
            voice_id=payload.voice_id,
            voice_ids=payload.voice_ids,
            designs=payload.designs,
            instruct=payload.instruct,
            style_instruct=payload.style_instruct,
            ref_audio=payload.ref_audio or "",
            ref_text=payload.ref_text or "",
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Voice not found")
    job = runner.submit(
        text=payload.text.strip(),
        ref_audio=audio_path,
        ref_text=transcript,
        batch_size=payload.batch_size,
        language=_normalize_language(payload.language),
        mode=job_mode,
        instruct=description,
        speaker=speaker_id,
        voices=job_voices,
        stable=payload.stable,
        temperature=payload.temperature,
        script_name=(payload.script_name or "").strip() or "文稿",
        verify_asr=payload.verify_asr,
    )
    return public_job(job)


@app.get("/api/jobs")
def api_list_jobs():
    return {"data": list_public()}


@app.get("/api/jobs/{job_id}")
def api_get_job(job_id: str):
    try:
        return get_public(job_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Job not found")


@app.post("/api/jobs/{job_id}/cancel")
def api_cancel_job(job_id: str):
    try:
        return public_job(runner.cancel(job_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="Job not found")
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.delete("/api/jobs/{job_id}")
def api_delete_job(job_id: str):
    try:
        delete_job(job_id)
    except JobBusy as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"ok": True}


@app.get("/api/jobs/{job_id}/audio")
def api_job_audio(job_id: str, download: bool = False):
    try:
        path = full_wav(job_id, item_list(job_id, "segments"))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")
    tracks = item_list(job_id, "tracks")
    filename = str((tracks[0] or {}).get("filename") or "") if tracks else ""
    if not filename:
        try:
            filename = str(get_public(job_id).get("download_name") or f"{job_id}.wav")
        except KeyError:
            filename = f"{job_id}.wav"
    return _wav_response(path, filename, download)


@app.get("/api/jobs/{job_id}/segments/{index}/audio")
def api_job_segment_audio(job_id: str, index: int, download: bool = False):
    try:
        path, filename = segment_wav(job_id, index, item_list(job_id, "segments"))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Segment not found")
    return _wav_response(path, filename, download)


@app.get("/api/jobs/{job_id}/tracks/{index}/audio")
def api_job_track_audio(job_id: str, index: int, download: bool = False):
    try:
        path, filename = track_wav(job_id, index, item_list(job_id, "tracks"))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Track not found")
    return _wav_response(path, filename, download)


@app.get("/api/jobs/{job_id}/zip")
def api_job_zip(job_id: str):
    try:
        body = zip_bytes(job_id, item_list(job_id, "segments"))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="No clip files to pack")
    try:
        zip_name = str(get_public(job_id).get("zip_name") or f"{job_id}.zip")
    except KeyError:
        zip_name = f"{job_id}.zip"
    return Response(
        body,
        media_type="application/zip",
        headers={
            "Content-Disposition": audio_util.content_disposition_attachment(zip_name),
            "Content-Length": str(len(body)),
        },
    )


@app.post("/v1/audio/speech")
def openai_speech(payload: SpeechRequest, authorization: Optional[str] = Header(None)):
    _check_key(authorization)
    if not payload.input.strip():
        raise HTTPException(status_code=400, detail="input is required")
    try:
        job_mode = _normalize_mode(payload.mode)
        description = (payload.instruct or "").strip()
        named = payload.speaker or payload.voice
        if named in SPEAKER_BY_ID and job_mode == "clone" and not payload.ref_audio:
            job_mode = "preset"
        speaker_id = ""
        if job_mode == "preset":
            speaker_id = _normalize_speaker(named)
            ref_audio, ref_text = "", ""
        elif job_mode == "design" or (description and not payload.ref_audio and not payload.voice):
            job_mode = "design"
            if not description:
                raise HTTPException(status_code=400, detail="instruct is required for described voices")
            ref_audio, ref_text = "", ""
        else:
            ref_audio, ref_text = _resolve_clone(payload.voice, payload.ref_audio, payload.ref_text)
        stats = engine.synthesize(
            payload.input,
            ref_audio,
            ref_text,
            batch_size=payload.batch_size,
            language=_normalize_language(payload.language),
            mode=job_mode,
            instruct=description,
            speaker=speaker_id,
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
            language=_normalize_language(language),
            mode="clone",
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

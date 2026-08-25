from __future__ import annotations

import io
import tempfile
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import audio_util, voices
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
    OUTPUT_DIR,
    LANGUAGE_BY_ID,
    MODEL_DIR,
    MODEL_ID,
    SPEAKER_BY_ID,
    SPEAKERS,
)
from .asr import asr_engine, asr_runner, public_asr_job
from .chunking import preview_segments
from .engine import engine
from .history import delete_record, list_disk_jobs, load_record, public_from_record
from .jobs import public_job, runner
from .script_import import import_spreadsheet


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


def _job_full_wav(job_id: str) -> Path:
    try:
        job = runner.get(job_id)
        if job.status == "done" and job.stats.get("output_path"):
            path = Path(job.stats["output_path"])
            if path.exists():
                return path
    except KeyError:
        pass
    path = OUTPUT_DIR / job_id / "full.wav"
    if path.exists():
        return path
    raise HTTPException(status_code=404, detail="Job not found")


def _job_item_list(job_id: str, key: str) -> list[dict]:
    try:
        job = runner.get(job_id)
        if job.status == "done":
            return list(job.stats.get(key) or [])
    except KeyError:
        pass
    try:
        return list(load_record(job_id).get(key) or [])
    except KeyError:
        return []


def _job_segment_wav(job_id: str, index: int) -> tuple[Path, str]:
    for item in _job_item_list(job_id, "segments"):
        if int(item.get("index") or 0) != index:
            continue
        path = Path(item.get("path") or "")
        if path.exists():
            return path, str(item.get("filename") or path.name)
    path = OUTPUT_DIR / job_id / f"seg_{index:03d}.wav"
    if path.exists():
        return path, path.name
    raise HTTPException(status_code=404, detail="Segment not found")


def _job_track_wav(job_id: str, index: int) -> tuple[Path, str]:
    for item in _job_item_list(job_id, "tracks"):
        if int(item.get("index") or 0) != index:
            continue
        path = Path(item.get("path") or "")
        if path.exists():
            return path, str(item.get("filename") or path.name)
    raise HTTPException(status_code=404, detail="Track not found")


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


def _normalize_mode(mode: str | None) -> str:
    value = (mode or "preset").strip().lower()
    if value in {"design", "voice_design", "describe", "description"}:
        return "design"
    if value in {"preset", "custom", "custom_voice"}:
        return "preset"
    if value in {"clone", "base", "icl"}:
        return "clone"
    raise HTTPException(status_code=400, detail=f"Unsupported mode: {mode}")


def _normalize_speaker(speaker: str | None) -> str:
    value = (speaker or DEFAULT_SPEAKER).strip()
    if value not in SPEAKER_BY_ID:
        raise HTTPException(status_code=400, detail=f"Unknown speaker: {speaker}")
    return value


def _parse_id_list(*values: Optional[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        if not value:
            continue
        for item in str(value).replace(";", ",").split(","):
            token = item.strip()
            if token and token not in seen:
                seen.append(token)
    return seen


def _preset_voices(ids: list[str]) -> list[dict]:
    if not ids:
        ids = [DEFAULT_SPEAKER]
    voices = []
    for speaker_id in ids:
        if speaker_id not in SPEAKER_BY_ID:
            raise HTTPException(status_code=400, detail=f"Unknown speaker: {speaker_id}")
        voices.append({"id": speaker_id, "name": SPEAKER_BY_ID[speaker_id]["label"], "kind": "preset"})
    return voices


def _clone_voices(ids: list[str], ref_audio: str = "", ref_text: str = "") -> list[dict]:
    if ids:
        result = []
        for voice_id in ids:
            profile = voices.get_voice(voice_id)
            result.append(
                {
                    "id": profile["id"],
                    "name": profile.get("name") or profile["id"],
                    "kind": "clone",
                    "ref_audio": profile["ref_audio"],
                    "ref_text": profile["ref_text"],
                }
            )
        return result
    if ref_audio and ref_text:
        return [{"id": "clone", "name": "克隆", "kind": "clone", "ref_audio": ref_audio, "ref_text": ref_text}]
    raise HTTPException(
        status_code=400,
        detail="Select a saved clone voice or upload reference audio",
    )


def _current_model_id() -> str:
    if engine.mode == "design":
        return DESIGN_MODEL_ID
    if engine.mode == "preset":
        return CUSTOM_MODEL_ID
    return MODEL_ID


def _looks_like_model(path: Path) -> bool:
    return path.is_dir() and (path / "config.json").exists() and any(path.glob("*.safetensors"))


def _normalize_language(language: str | None) -> str:
    value = (language or LANGUAGE).strip() or LANGUAGE
    if value not in LANGUAGE_BY_ID:
        raise HTTPException(status_code=400, detail=f"Unsupported language: {value}")
    return value


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
        "model_dir_ready": _looks_like_model(MODEL_DIR),
        "design_model_id": DESIGN_MODEL_ID,
        "design_model_ready": _looks_like_model(DESIGN_MODEL_DIR),
        "custom_model_id": CUSTOM_MODEL_ID,
        "custom_model_ready": _looks_like_model(CUSTOM_MODEL_DIR),
        "asr_model_id": ASR_MODEL_ID,
        "asr_model_path": asr_engine.model_path,
        "asr_model_ready": _looks_like_model(ASR_MODEL_DIR),
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
    ref_audio: Optional[UploadFile] = File(None),
):
    if not (text or "").strip():
        raise HTTPException(status_code=400, detail="text is required")

    job_mode = _normalize_mode(mode)
    description = (instruct or "").strip()
    speaker_id = ""
    job_voices: list[dict] = []
    temp_ref: Optional[Path] = None
    try:
        if job_mode == "preset":
            job_voices = _preset_voices(_parse_id_list(speakers, speaker, voice_id))
            speaker_id = str(job_voices[0]["id"])
            audio_path, transcript = "", ""
        elif job_mode == "design":
            if not description:
                raise HTTPException(status_code=400, detail="instruct is required for described voices")
            job_voices = [{"id": "design", "name": "描述音色", "kind": "design"}]
            audio_path, transcript = "", ""
        elif ref_audio is not None and ref_audio.filename:
            suffix = Path(ref_audio.filename).suffix or ".wav"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
                tmp.write(await ref_audio.read())
                temp_ref = Path(tmp.name)
            audio_path, transcript = str(temp_ref), (ref_text or "")
            if not transcript.strip():
                raise HTTPException(status_code=400, detail="ref_text is required with uploaded audio")
            job_voices = _clone_voices(_parse_id_list(voice_ids, voice_id), audio_path, transcript)
        else:
            job_voices = _clone_voices(_parse_id_list(voice_ids, voice_id))
            audio_path, transcript = str(job_voices[0]["ref_audio"]), str(job_voices[0]["ref_text"])
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
    job_mode = _normalize_mode(payload.mode)
    description = (payload.instruct or "").strip()
    speaker_id = ""
    try:
        if job_mode == "preset":
            job_voices = _preset_voices(_parse_id_list(payload.speakers, payload.speaker, payload.voice_id))
            speaker_id = str(job_voices[0]["id"])
            audio_path, transcript = "", ""
        elif job_mode == "design":
            if not description:
                raise HTTPException(status_code=400, detail="instruct is required for described voices")
            job_voices = [{"id": "design", "name": "描述音色", "kind": "design"}]
            audio_path, transcript = "", ""
        else:
            job_voices = _clone_voices(
                _parse_id_list(payload.voice_ids, payload.voice_id),
                payload.ref_audio or "",
                payload.ref_text or "",
            )
            audio_path, transcript = str(job_voices[0]["ref_audio"]), str(job_voices[0]["ref_text"])
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
    )
    return public_job(job)


@app.get("/api/jobs")
def api_list_jobs():
    seen: set[str] = set()
    items = []
    for job in list(runner.jobs.values()):
        items.append(public_job(job))
        seen.add(job.id)
    for item in list_disk_jobs():
        if item["id"] in seen:
            continue
        items.append(item)
        seen.add(item["id"])
    items.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return {"data": items}


@app.get("/api/jobs/{job_id}")
def api_get_job(job_id: str):
    try:
        return public_job(runner.get(job_id))
    except KeyError:
        pass
    try:
        return public_from_record(load_record(job_id))
    except KeyError:
        raise HTTPException(status_code=404, detail="Job not found")


@app.delete("/api/jobs/{job_id}")
def api_delete_job(job_id: str):
    try:
        job = runner.get(job_id)
        if job.status in {"queued", "running"}:
            raise HTTPException(status_code=409, detail="任务还在生成，不能删除")
        runner.forget(job_id)
    except KeyError:
        pass
    delete_record(job_id)
    return {"ok": True}


@app.get("/api/jobs/{job_id}/audio")
def api_job_audio(job_id: str, download: bool = False):
    return _wav_response(_job_full_wav(job_id), f"{job_id}.wav", download)


@app.get("/api/jobs/{job_id}/segments/{index}/audio")
def api_job_segment_audio(job_id: str, index: int, download: bool = False):
    path, filename = _job_segment_wav(job_id, index)
    return _wav_response(path, filename, download)


@app.get("/api/jobs/{job_id}/tracks/{index}/audio")
def api_job_track_audio(job_id: str, index: int, download: bool = False):
    path, filename = _job_track_wav(job_id, index)
    return _wav_response(path, filename, download)


@app.get("/api/jobs/{job_id}/zip")
def api_job_zip(job_id: str):
    full = _job_full_wav(job_id)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        added: set[str] = set()
        for item in _job_item_list(job_id, "segments"):
            path = Path(item.get("path") or "")
            name = str(item.get("filename") or path.name)
            if path.exists() and name not in added:
                archive.write(path, name)
                added.add(name)
        for item in _job_item_list(job_id, "tracks"):
            path = Path(item.get("path") or "")
            name = str(item.get("filename") or path.name)
            if path.exists() and name not in added:
                archive.write(path, name)
                added.add(name)
        if full.exists() and full.name not in added and not _job_item_list(job_id, "tracks"):
            archive.write(full, full.name)
        if not added:
            for path in sorted(full.parent.glob("*.wav")):
                if ".browser." in path.name or path.name.startswith("."):
                    continue
                archive.write(path, path.name)
    body = buffer.getvalue()
    return Response(
        body,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{job_id}.zip"',
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

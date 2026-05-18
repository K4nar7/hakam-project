"""
Hakam — FastAPI backend for video Q&A using a true Vision-Language Pipeline
Matches the exact training structure of train_student.py

Windows Fix: bypasses torchvision's broken video reader entirely.
Frames are extracted via OpenCV + PIL and injected as image lists directly
into the message payload, sidestepping the aspect-ratio crash caused by
torchvision misreading the RGB channel count (3) as a spatial dimension.
"""
from __future__ import annotations

# ==============================================================================
# CRITICAL: Override MAX_RATIO before qwen_vl_utils is used anywhere.
# Must come before all other project imports that touch qwen_vl_utils.
# ==============================================================================
import qwen_vl_utils.vision_process as _vp
_vp.MAX_RATIO = 999_999
# ==============================================================================

import os
import uuid
import tempfile
from pathlib import Path
from typing import Dict, List, Optional

import cv2
import torch
from PIL import Image

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Multimodal & VL imports matching train_student.py
from transformers import AutoModelForImageTextToText, AutoProcessor
from qwen_vl_utils import process_vision_info
from peft import PeftModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_MODEL  = "Qwen/Qwen3.5-0.8B"
LORA_REPO   = "ananas0/qwen3.5-0.8b-sportsqa-distill-lora"
MAX_FILE_MB = 200
MAX_FRAMES  = 8       # uniform sample fed to the VLM per request
UPLOAD_DIR  = Path(tempfile.gettempdir()) / "hakam_uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------
app = FastAPI(title="Hakam Multimodal Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# OpenCV frame extractor
# ---------------------------------------------------------------------------

def extract_frames_opencv(video_path: str, max_frames: int = MAX_FRAMES) -> List[Image.Image]:
    """
    Extract a uniform sample of up to `max_frames` frames from a local video
    file using OpenCV and return them as a list of RGB PIL Images.

    This completely bypasses torchvision.io.read_video, which on Windows
    confuses the 3-channel RGB axis with spatial dimensions and produces an
    illegal aspect ratio (e.g. 1280/3 ≈ 426.7) that crashes process_vision_info.

    Args:
        video_path: Absolute path to the video file.
        max_frames:  Maximum number of frames to sample (evenly spaced).

    Returns:
        A non-empty list of PIL.Image objects in RGB mode.

    Raises:
        ValueError: If the video cannot be opened or contains no readable frames.
    """
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise ValueError(f"OpenCV could not open video: {video_path}")

    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0:
        # Some containers don't report frame count; read all and subsample later.
        raw: List[Image.Image] = []
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            raw.append(Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)))
        cap.release()
        if not raw:
            raise ValueError(f"No frames decoded from: {video_path}")
        # Uniform subsample from the full list
        indices = _uniform_indices(len(raw), max_frames)
        return [raw[i] for i in indices]

    # Fast-path: seek directly to evenly-spaced frame positions.
    indices = _uniform_indices(total_frames, max_frames)
    pil_frames: List[Image.Image] = []
    for idx in indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if ret:
            pil_frames.append(
                Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            )
    cap.release()

    if not pil_frames:
        raise ValueError(f"All frame reads failed for: {video_path}")

    return pil_frames


def _uniform_indices(total: int, n: int) -> List[int]:
    """Return at most `n` evenly-spaced integer indices in [0, total)."""
    n = min(n, total)
    if n == 1:
        return [total // 2]
    step = total / n
    return [int(i * step) for i in range(n)]


# ---------------------------------------------------------------------------
# Message pre-processor — swap video paths → PIL image lists
# ---------------------------------------------------------------------------

def preprocess_messages_for_windows(messages: list) -> list:
    """
    Walk the message list and replace any ``{"type": "video", "video": "<path>"}``
    block with an ``{"type": "video", "video": [<PIL.Image>, ...]}`` block.

    All other content blocks and message keys are preserved unchanged.
    Converting local paths to PIL image lists before process_vision_info is
    called is the authoritative fix for the Windows aspect-ratio crash:
    process_vision_info handles image-list video payloads on a clean code path
    that never invokes torchvision's broken THWC reader.
    """
    processed = []
    for msg in messages:
        new_msg = {k: v for k, v in msg.items() if k != "content"}
        new_content = []
        for block in msg.get("content", []):
            if (
                isinstance(block, dict)
                and block.get("type") == "video"
                and isinstance(block.get("video"), str)
                and Path(block["video"]).exists()
            ):
                frames = extract_frames_opencv(block["video"])
                # Build a new block that forwards all original keys except
                # the path string; replace "video" with the PIL frame list.
                new_block = {k: v for k, v in block.items() if k != "video"}
                new_block["video"] = frames
                new_content.append(new_block)
            else:
                new_content.append(block)
        new_msg["content"] = new_content
        processed.append(new_msg)
    return processed


# ---------------------------------------------------------------------------
# Lazy model loader
# ---------------------------------------------------------------------------
_model:     Optional[PeftModel]       = None
_processor: Optional[AutoProcessor]  = None


def get_model():
    global _model, _processor
    if _model is not None:
        return _model, _processor

    print(f"[hakam] Loading multimodal base model: {BASE_MODEL}")
    processor = AutoProcessor.from_pretrained(BASE_MODEL, trust_remote_code=True)
    base = AutoModelForImageTextToText.from_pretrained(
        BASE_MODEL,
        dtype=torch.bfloat16,
        device_map="cuda",
        trust_remote_code=True,
    )
    print(f"[hakam] Attaching sports-distilled LoRA adapter: {LORA_REPO}")
    model = PeftModel.from_pretrained(base, LORA_REPO)
    model.eval()

    _model, _processor = model, processor
    return model, processor


# ---------------------------------------------------------------------------
# Session store
# ---------------------------------------------------------------------------
SESSIONS: Dict[str, Dict] = {}

SYSTEM_PROMPT = (
    "You are an elite sports video analyst with deep expertise across basketball, football, "
    "volleyball, and gymnastics (including aerobic gymnastics, vault, uneven bars, balance beam, "
    "and floor exercise). You watch short game or performance clips and parse them the way a "
    "coach or color commentator would: identifying the sport, naming specific techniques and "
    "skills (e.g. 2-point shot, spike, push-up, split, round-off, flic-flac, giant circle), "
    "counting discrete events and the number of athletes involved, tracking temporal order "
    "(what comes before / after what), and reasoning about cause and effect (why an action "
    "succeeded or failed, what a counterfactual outcome would have been).\n\n"
    "When given a question, think it through step by step — describe what you see in the clip, "
    "locate the moment the question refers to, and then give a precise, expert answer. Be "
    "decisive: sports are concrete, so give committed answers rather than hedged ones. "
    "If the question is a yes / no, still justify briefly. If it asks 'how many', count carefully. "
    "If it asks for the name of an action, use the technical term.\n\n"
    "**Outcome questions must be answered from the action itself, not from interface elements.** "
    "When a question asks whether an action *succeeded* (did the shot go in, did the team score, "
    "did the spike land, did the dismount stick), your verdict must come from observing the action's "
    "physical result: ball relative to rim/net, body relative to landing surface, ball crossing the "
    "goal line. **Do not use scoreboards, scorelines, point counters, or referee gestures as evidence "
    "of success or failure.** Scoreboards are graphical UI, lag the action by 1-3 seconds, and may not "
    "update within the clip's duration. If the play is cut off before the result is visually resolved, "
    "say so explicitly and answer from what was visible — do not infer success or failure from a static "
    "score.\n\n"
    "**Be concise.** Aim for around 300-500 tokens total. Identify the moment, state the evidence, "
    "commit to a verdict. Do not re-examine the same evidence twice or hedge between interpretations. "
    "Brevity over rumination."
)


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    session_id: str
    query: str


class ChatResponse(BaseModel):
    response: str


class UploadResponse(BaseModel):
    session_id: str


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
def health():
    return {
        "status": "ok",
        "model": BASE_MODEL,
        "adapter": LORA_REPO,
        "type": "Multimodal VLM",
    }


@app.post("/api/upload-video", response_model=UploadResponse)
async def upload_video(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("video/"):
        raise HTTPException(400, "File must be a video")

    session_id = uuid.uuid4().hex
    dest = UPLOAD_DIR / f"{session_id}_{file.filename}"
    size = 0

    with dest.open("wb") as out:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_FILE_MB * 1024 * 1024:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"File exceeds {MAX_FILE_MB} MB")
            out.write(chunk)

    SESSIONS[session_id] = {"path": str(dest), "history": []}
    return UploadResponse(session_id=session_id)


@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    sess = SESSIONS.get(req.session_id)
    if not sess:
        raise HTTPException(404, "Unknown session")

    model, processor = get_model()
    video_path = sess["path"]

    # Build messages with the raw file path first (readable, auditable).
    messages = [
        {"role": "system", "content": [{"type": "text", "text": SYSTEM_PROMPT}]},
        {
            "role": "user",
            "content": [
                {
                    "type": "video",
                    "video": video_path,
                    # fps / max_frames are hints for path-based loading;
                    # after preprocess_messages_for_windows they become
                    # irrelevant (PIL list path ignores them), but keeping
                    # them here documents the intended sampling rate.
                    "fps": 2.0,
                    "max_frames": MAX_FRAMES,
                    "max_pixels": 256 * 28 * 28,
                },
                {"type": "text", "text": req.query},
            ],
        },
    ]

    # -----------------------------------------------------------------------
    # Windows fix: replace the local video path with extracted PIL frames
    # BEFORE process_vision_info ever sees the messages.  This prevents
    # torchvision from being invoked and avoids the aspect-ratio crash.
    # -----------------------------------------------------------------------
    try:
        messages = preprocess_messages_for_windows(messages)
    except ValueError as exc:
        raise HTTPException(422, f"Frame extraction failed: {exc}")

    text_prompt = processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    image_inputs, video_inputs = process_vision_info(messages)

    inputs = processor(
        text=[text_prompt],
        images=image_inputs,
        videos=video_inputs,
        padding=True,
        return_tensors="pt",
    ).to(model.device)

    try:
        with torch.no_grad():
            out = model.generate(
                **inputs,
                max_new_tokens=256,
                do_sample=True,
                temperature=0.5,
                top_p=0.9,
                repetition_penalty=1.1,
            )

        prompt_len = inputs["input_ids"].shape[1]
        new_tokens = out[0, prompt_len:].cpu()
        response_text = processor.batch_decode(
            [new_tokens],
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0].strip()

    except Exception as exc:
        raise HTTPException(500, f"Inference engine failed: {exc}")

    sess["history"].append({"q": req.query, "a": response_text})
    return ChatResponse(response=response_text)


@app.delete("/api/session/{session_id}")
def drop_session(session_id: str):
    sess = SESSIONS.pop(session_id, None)
    if sess:
        Path(sess["path"]).unlink(missing_ok=True)
    return {"ok": True}
"""
Hakam — FastAPI backend for video Q&A using a true Vision-Language Pipeline
Matches the exact training structure of train_student.py

Includes a custom OpenCV patch fixed to return standard THWC layouts 
to prevent visual token explosions on Windows.
"""
from __future__ import annotations

# ==============================================================================
# CRITICAL WINDOWS TORCHVISION PATCH (Must be applied before other imports)
# ==============================================================================
import cv2
import torch
import torchvision.io as tv_io

def open_cv_video_reader_fallback(video_path, **kwargs):
    """Safely reads raw video frames using OpenCV in the standard THWC format expected by torchvision."""
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frames = []
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        # OpenCV imports as BGR; convert to RGB for the vision model
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        # Keep as [H, W, C] numpy array and convert to a torch tensor (uint8)
        t_frame = torch.from_numpy(frame)
        frames.append(t_frame)
        
    cap.release()
    
    # Pack frames into a unified [T, H, W, C] tensor format matching torchvision.io.read_video
    if not frames:
        video_tensor = torch.zeros((0, 224, 224, 3), dtype=torch.uint8)
    else:
        video_tensor = torch.stack(frames, dim=0)
        
    return video_tensor, None, {"video_fps": fps}

# Injecting our custom reader to replace the missing torchvision component natively
tv_io.read_video = open_cv_video_reader_fallback
# ==============================================================================

import os
import uuid
import tempfile
from pathlib import Path
from typing import Dict, List

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Multimodal & VL imports matching train_student.py
from transformers import AutoModelForImageTextToText, AutoProcessor
from qwen_vl_utils import process_vision_info
from peft import PeftModel

BASE_MODEL = "Qwen/Qwen3.5-0.8B"  
LORA_REPO = "ananas0/qwen3.5-0.8b-sportsqa-distill-lora"
MAX_FILE_MB = 200
UPLOAD_DIR = Path(tempfile.gettempdir()) / "hakam_uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

app = FastAPI(title="Hakam Multimodal Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Lazy model load ---------------------------------------------------------
_model = None
_processor = None

def get_model():
    global _model, _processor
    if _model is not None:
        return _model, _processor
        
    print(f"[hakam] Loading Multimodal base model: {BASE_MODEL}")
    processor = AutoProcessor.from_pretrained(BASE_MODEL, trust_remote_code=True)
    base = AutoModelForImageTextToText.from_pretrained(
        BASE_MODEL,
        dtype=torch.bfloat16, 
        device_map="cuda", # Pushes execution directly onto your Nvidia GPU
        trust_remote_code=True,
    )
    print(f"[hakam] Attaching sports-distilled LoRA adapter: {LORA_REPO}")
    model = PeftModel.from_pretrained(base, LORA_REPO)
    model.eval()
    
    _model, _processor = model, processor
    return model, processor

# ---- Session store -----------------------------------------------------------
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

# ---- Schemas -----------------------------------------------------------------
class ChatRequest(BaseModel):
    session_id: str
    query: str

class ChatResponse(BaseModel):
    response: str

class UploadResponse(BaseModel):
    session_id: str

# ---- Routes ------------------------------------------------------------------
@app.get("/")
def health():
    return {"status": "ok", "model": BASE_MODEL, "adapter": LORA_REPO, "type": "Multimodal VLM"}

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
                raise HTTPException(413, f"File exceeds {MAX_FILE_MB}MB")
            out.write(chunk)

    SESSIONS[session_id] = {
        "path": str(dest),
        "history": [],
    }
    return UploadResponse(session_id=session_id)

@app.post("/api/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    sess = SESSIONS.get(req.session_id)
    if not sess:
        raise HTTPException(404, "Unknown session")

    model, processor = get_model()
    video_path = sess["path"]

    messages = [
        {"role": "system", "content": [{"type": "text", "text": SYSTEM_PROMPT}]},
        {"role": "user", "content": [
            {
                "type": "video", 
                "video": video_path, 
                "fps": 2.0, 
                "max_frames": 32, 
                "max_pixels": 256 * 28 * 28
            },
            {"type": "text", "text": req.query},
        ]},
    ]

    text_prompt = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
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
        
    except Exception as e:
        raise HTTPException(500, f"Inference engine failed: {e}")

    sess["history"].append({"q": req.query, "a": response_text})
    return ChatResponse(response=response_text)

@app.delete("/api/session/{session_id}")
def drop_session(session_id: str):
    sess = SESSIONS.pop(session_id, None)
    if sess:
        Path(sess["path"]).unlink(missing_ok=True)
    return {"ok": True}
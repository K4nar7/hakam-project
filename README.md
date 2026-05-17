# Hakam Backend — Deploy Guide

Two files ship with this app:

- `hakam_backend.py` — FastAPI server (CORS open, two endpoints)
- `requirements.txt` — Python deps

## Endpoints

- `POST /api/upload-video` — multipart `file` → `{ session_id }`
- `POST /api/chat` — JSON `{ session_id, query }` → `{ response }`

## Run locally

```bash
pip install -r requirements.txt
uvicorn hakam_backend:app --host 0.0.0.0 --port 8000
```

Then in the Lovable project, set:

```
VITE_HAKAM_API_URL=http://localhost:8000
```

## Deploy free on Hugging Face Spaces (GPU optional)

1. Create a new Space → **SDK: Docker**.
2. Add both files to the repo, plus this `Dockerfile`:

```dockerfile
FROM python:3.11-slim
RUN apt-get update && apt-get install -y libgl1 libglib2.0-0 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 7860
CMD ["uvicorn", "hakam_backend:app", "--host", "0.0.0.0", "--port", "7860"]
```

3. After the Space is running, copy its public URL (e.g. `https://your-name-hakam.hf.space`) into `VITE_HAKAM_API_URL` in this Lovable project.

## Notes

- The base model in the script is set to `Qwen/Qwen2.5-0.5B-Instruct` because Qwen3.5-0.8B-Instruct isn't a public HF id at the time of writing. Change `BASE_MODEL` at the top of `hakam_backend.py` to the exact id you have access to.
- Qwen3.5 is text-only — true video understanding needs a VLM (e.g. Qwen2.5-VL). The script ships a deterministic frame-metadata summary that is fed as context to the LoRA-adapted model. Swap `extract_frame_summary` for a real VLM call when you have one available.

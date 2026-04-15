# Real-Time Speech Enhancement and Refinement System

A production-style, hackathon-ready system for near real-time speech denoising and transcript refinement.

## Features

- Real-time microphone streaming with low-latency chunking
- Noise reduction using DeepFilterNet / DeepFilter2 pretrained model
- Near real-time transcription using Whisper
- Text refinement pipeline:
  - Filler word removal
  - Grammar cleanup
  - Sentence polishing to a professional tone
- Custom blacklist filtering (remove/replace words)
- Live UI with:
  - Original transcript
  - Refined transcript
  - Real-time cleaned audio playback
- Download outputs:
  - Cleaned audio (`.wav`)
  - Refined transcript (`.txt`)
- File upload flow (batch processing with same pipeline)

---

## Project Structure

```text
speech-enhancement-system/
├── backend/
│   ├── main.py
│   ├── config.py
│   ├── denoiser.py
│   ├── transcriber.py
│   ├── text_processor.py
│   ├── audio_processor.py
│   ├── utils.py
│   ├── requirements.txt
│   ├── .env.example
│   └── outputs/
├── frontend/
│   ├── package.json
│   ├── vite.config.js
│   ├── index.html
│   └── src/
│       ├── App.jsx
│       ├── main.jsx
│       ├── styles.css
│       ├── components/
│       │   ├── ControlPanel.jsx
│       │   └── TranscriptPanel.jsx
│       └── services/
│           ├── audioStreamer.js
│           └── websocketService.js
└── README.md
```

---

## Architecture

1. Audio Input (Mic/Upload)
2. Chunking Buffer (100ms chunks at 16kHz)
3. DeepFilterNet Denoiser
4. Clean Audio Stream
5. Whisper STT (streaming buffer)
6. Text Refinement Pipeline
7. Real-time UI + Downloadable outputs

---

## Setup Instructions

## 1. Backend Setup (Python)

```bash
cd backend
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
```

Notes:
- If DeepFilter package naming differs on your machine, install:
  - `pip install deepfilterlib deepfilternet`
- The backend uses local DeepFilter weights from `backend/models` by default.
  - Override folder with `DEEPFILTER_MODEL_BASE_DIR`
  - Override checkpoint with `DEEPFILTER_MODEL_EPOCH` (e.g. `best` or `96`)
- The transcription backend uses `faster-whisper`; FFmpeg may still be required for some audio formats.

## 2. Frontend Setup (React)

```bash
cd frontend
npm install
```

---

## Run Commands

## Start Backend

```bash
cd backend
.venv\Scripts\python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

If you run from the repository root instead of `backend/`, use:

```bash
backend\.venv\Scripts\python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000 --reload
```

## Start Frontend

```bash
cd frontend
npm run dev
```

Frontend URL: `http://localhost:5173`
Backend URL: `http://localhost:8000`

---

## API Endpoints

- `GET /` - health ping
- `GET /health` - model/session health
- `WS /ws/audio` - real-time audio streaming
- `POST /upload` - process audio file upload
- `GET /download/audio/{session_id}` - download cleaned `.wav`
- `GET /download/transcript/{session_id}` - download refined `.txt`

---

## Sample Demo Flow

1. Open frontend in browser.
2. Click **Start Live Processing**.
3. Speak into the microphone with background noise.
4. Watch two transcript panes update:
   - Original transcript
   - Refined transcript
5. Add custom filters (example: `bro` with empty replacement to remove).
6. Click **Stop Live Processing**.
7. Download:
   - Cleaned audio (`.wav`)
   - Refined transcript (`.txt`)

Upload demo:
1. Click **Upload Audio File**.
2. Select `.wav`, `.mp3`, `.flac`, or `.m4a`.
3. Wait for processing.
4. View transcripts and download outputs.

---

## Latency Notes

- Chunk size: 100ms
- Streaming transcription window: 3s with overlap
- End-to-end latency depends on hardware/model size:
  - CPU + Whisper `base`: typically near real-time for demo usage
  - GPU + Whisper `small/base`: lower latency and better throughput

For lower latency:
- Use Whisper `tiny` or `base`
- Use GPU (`WHISPER_DEVICE=cuda`)
- Keep chunk size between 80-120ms

---

## Customization

- Filler words list: `backend/config.py`
- Professional tone mapping: `backend/text_processor.py`
- Audio chunking parameters: `backend/config.py`
- Whisper model/device: `backend/config.py`
- Custom word filters can be set live from UI.

---

## Production Tips

- Add authentication on API/WebSocket for multi-user deployment
- Add persistent DB for session metadata
- Add queue/worker model for horizontal scaling
- Add better VAD and punctuation restoration models
- Use HTTPS + WSS in production

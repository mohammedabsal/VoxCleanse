"""DeepFilterNet2 denoising utilities for file and live audio flows."""

from __future__ import annotations
import sys
import argparse
import os
import time
import shutil
import queue
from pathlib import Path
from typing import Optional

import numpy as np
import soundfile as sf
import sounddevice as sd
import torch


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "outputs"
DEFAULT_SAMPLE_RATE = 16000
DEFAULT_CHUNK_SIZE = 1600


def _get_model_sample_rate(df_state) -> int:
    """Read sample rate from DF state (DeepFilter model config)."""
    try:
        sr_attr = getattr(df_state, "sr", None)
        return int(sr_attr() if callable(sr_attr) else sr_attr)
    except Exception:
        return DEFAULT_SAMPLE_RATE


def _resolve_device(device: str) -> str:
    requested = (device or "cpu").strip().lower()
    cuda_available = torch.cuda.is_available()

    if requested == "auto":
        resolved = "cuda" if cuda_available else "cpu"
        print(f"Using device: {resolved}")
        return resolved

    if requested == "cuda" and not cuda_available:
        print("CUDA requested but not available. Falling back to CPU.")
        return "cpu"

    return "cuda" if requested == "cuda" else "cpu"


class DF2Denoiser:
    """Reusable DeepFilterNet2 denoiser for both API and CLI use."""

    def __init__(
        self,
        model_dir: Optional[str] = None,
        device: str = "auto",
        epoch: str = "best",
    ):
        from df.enhance import init_df

        self.model_base_dir = _find_model_dir(model_dir)
        self.device = _resolve_device(device)
        self.epoch = epoch

        self.model, self.df_state, _ = init_df(
            model_base_dir=str(self.model_base_dir),
            default_model="DeepFilterNet2",
            epoch=epoch,
        )
        self.model.to(self.device)
        self.model.eval()
        self.model_sr = _get_model_sample_rate(self.df_state)

    def denoise_audio(self, audio: np.ndarray, sample_rate: int) -> np.ndarray:
        """Denoise full mono audio and return at original sample rate."""
        from df.enhance import enhance

        audio = np.asarray(audio, dtype=np.float32)
        if audio.ndim > 1:
            audio = np.mean(audio, axis=1)

        model_audio = _resample_if_needed(audio, sample_rate, self.model_sr)
        with torch.no_grad():
            audio_tensor = torch.from_numpy(model_audio).float().unsqueeze(0)
            denoised = enhance(self.model, self.df_state, audio_tensor)

        if isinstance(denoised, torch.Tensor):
            denoised_np = denoised.detach().cpu().numpy()
        else:
            denoised_np = np.asarray(denoised, dtype=np.float32)

        denoised_np = np.squeeze(denoised_np).astype(np.float32)
        denoised_np = np.clip(denoised_np, -0.99, 0.99)
        return _resample_if_needed(denoised_np, self.model_sr, sample_rate)

    def denoise_chunk(self, audio_chunk: np.ndarray, sample_rate: int) -> np.ndarray:
        """Denoise one chunk at caller sample rate."""
        return self.denoise_audio(audio_chunk, sample_rate)


def _find_model_dir(user_model_dir: Optional[str]) -> Path:
    """Resolve a model directory that contains config.ini for init_df(model_base_dir=...)."""
    candidates = []

    if user_model_dir:
        candidates.append(Path(user_model_dir))

    env_dir = Path(__import__("os").environ.get("DEEPFILTER_MODEL_BASE_DIR", ""))
    if str(env_dir):
        candidates.append(env_dir)

    candidates.extend(
        [
            SCRIPT_DIR / "models",
            SCRIPT_DIR / "models" / "DeepFilterNet2" / "DeepFilterNet2",
            SCRIPT_DIR.parent.parent / "denoised" / "DeepFilterNet2" / "models" / "DeepFilterNet2" / "DeepFilterNet2",
        ]
    )

    for candidate in candidates:
        if candidate.exists() and (candidate / "config.ini").exists():
            _ensure_checkpoint_layout(candidate)
            return candidate

    raise FileNotFoundError(
        "Could not find DeepFilterNet2 model directory with config.ini. "
        "Pass --model-dir pointing to the folder that contains config.ini."
    )


def _ensure_checkpoint_layout(model_dir: Path) -> None:
    """Ensure checkpoints/model_96.ckpt.best exists (DeepFilter expects this layout)."""
    root_ckpt = model_dir / "model_96.ckpt.best"
    checkpoints_dir = model_dir / "checkpoints"
    target_ckpt = checkpoints_dir / "model_96.ckpt.best"

    if root_ckpt.exists() and not target_ckpt.exists():
        checkpoints_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root_ckpt, target_ckpt)


def _resample_if_needed(audio: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if src_sr == dst_sr:
        return audio.astype(np.float32)

    try:
        import librosa

        return librosa.resample(audio, orig_sr=src_sr, target_sr=dst_sr).astype(np.float32)
    except Exception as exc:
        raise RuntimeError(
            "Resampling required but librosa is unavailable. Install librosa or use 16kHz input."
        ) from exc


def denoise_file(
    input_path: Path,
    output_path: Path,
    model_dir: Optional[str] = None,
    device: str = "auto",
    epoch: str = "best",
) -> Path:
    input_path = input_path.resolve()
    output_path = output_path.resolve()

    if not input_path.exists():
        raise FileNotFoundError(f"Input audio not found: {input_path}")

    denoiser = DF2Denoiser(model_dir=model_dir, device=device, epoch=epoch)

    audio, sample_rate = sf.read(str(input_path), dtype="float32")

    if audio.ndim > 1:
        audio = np.mean(audio, axis=1)

    output_audio = denoiser.denoise_audio(audio, sample_rate)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), output_audio, sample_rate)
    return output_path


def denoise_microphone(
    output_path: Path,
    model_dir: Optional[str] = None,
    device: str = "auto",
    epoch: str = "best",
    duration: float = 15.0,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
) -> Path:
    """Capture live microphone audio, denoise it chunk-by-chunk, and save the result."""
    denoiser = DF2Denoiser(model_dir=model_dir, device=device, epoch=epoch)

    mic_queue: "queue.Queue[np.ndarray]" = queue.Queue(maxsize=32)

    def input_callback(indata, frames, time_info, status):
        if status:
            print(f"Input status: {status}")
        mono = indata[:, 0].copy().astype(np.float32)
        try:
            mic_queue.put_nowait(mono)
        except queue.Full:
            pass

    cleaned_chunks = []
    started_at = time.time()
    try:
        with sd.InputStream(
            samplerate=sample_rate,
            channels=1,
            blocksize=chunk_size,
            dtype=np.float32,
            callback=input_callback,
        ):
            while True:
                if duration > 0 and (time.time() - started_at) >= duration:
                    break

                try:
                    chunk = mic_queue.get(timeout=1.0)
                except queue.Empty:
                    continue

                if chunk is None or len(chunk) == 0:
                    continue

                out_chunk = denoiser.denoise_chunk(chunk, sample_rate)
                cleaned_chunks.append(out_chunk)

    finally:
        pass

    if cleaned_chunks:
        cleaned_audio = np.concatenate(cleaned_chunks)
    else:
        cleaned_audio = np.array([], dtype=np.float32)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(output_path), cleaned_audio, sample_rate)
    return output_path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Denoise an audio file or live microphone audio with local DeepFilterNet2.")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--input", help="Path to input audio file")
    mode.add_argument("--mic", action="store_true", help="Capture live microphone audio")
    parser.add_argument(
        "--output",
        default="",
        help="Path to output denoised file (default: backend/outputs/denoised_<input>.wav or live_denoised.wav)",
    )
    parser.add_argument(
        "--model-dir",
        default="",
        help="Model directory containing config.ini and checkpoints (optional)",
    )
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"], help="Torch device")
    parser.add_argument("--epoch", default="best", help="Checkpoint epoch (default: best)")
    parser.add_argument("--duration", type=float, default=15.0, help="Mic capture duration in seconds (mic mode only)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.mic:
        output_path = Path(args.output) if args.output else DEFAULT_OUTPUT_DIR / "live_denoised.wav"
        out = denoise_microphone(
            output_path=output_path,
            model_dir=args.model_dir or None,
            device=args.device,
            epoch=args.epoch,
            duration=args.duration,
        )
    else:
        input_path = Path(args.input)
        if args.output:
            output_path = Path(args.output)
        else:
            output_path = DEFAULT_OUTPUT_DIR / f"denoised_{input_path.stem}.wav"

        out = denoise_file(
            input_path=input_path,
            output_path=output_path,
            model_dir=args.model_dir or None,
            device=args.device,
            epoch=args.epoch,
        )
    print(f"Denoised audio saved to: {out}")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback

        traceback.print_exc()
        sys.exit(1)
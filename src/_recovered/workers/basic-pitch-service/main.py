"""
MURMUR Pitch Worker — Python PYIN 音高识别服务
算法：librosa.pyin（概率 YIN，对哼唱人声识别准确率最高）
运行：uvicorn main:app --reload --port 8001
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import tempfile, os, io, logging, math
import numpy as np
import soundfile as sf
import librosa

logger = logging.getLogger(__name__)

app = FastAPI(title="MURMUR PYIN Worker", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── PYIN 参数 ──────────────────────────────────────────────────────────────
SR        = 22050    # 重采样率，PYIN 推荐值
FMIN      = 75       # Hz 最低频率（男声低限）
FMAX      = 1050     # Hz 最高频率
FRAME_LEN = 2048     # 分析帧长
HOP_LEN   = 512      # 帧间隔

# 最短音符时长（秒），过滤噪声短音
MIN_NOTE_DUR = 0.08

# PYIN 置信度阈值
MIN_CONF = 0.4

def decode_audio(data: bytes, filename: str) -> np.ndarray:
    """
    把任意格式音频（webm/opus/mp4/wav/m4a）解码为 22050Hz 单声道 float32。
    先用 soundfile 尝试，失败则用 pydub 转码。
    """
    # 先尝试 soundfile 直接读
    try:
        buf = io.BytesIO(data)
        y, sr = sf.read(buf, dtype="float32", always_2d=False)
        if y.ndim > 1:
            y = y.mean(axis=1)
        if sr != SR:
            y = librosa.resample(y, orig_sr=sr, target_sr=SR)
        return y.astype(np.float32)
    except Exception:
        pass

    # soundfile 不支持该格式（webm/opus 常见），用 pydub 转码
    try:
        from pydub import AudioSegment
        # 写临时文件
        ext = os.path.splitext(filename)[-1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        seg = AudioSegment.from_file(tmp_path)
        os.unlink(tmp_path)

        # 转 raw PCM
        seg = seg.set_frame_rate(SR).set_channels(1).set_sample_width(2)
        samples = np.frombuffer(seg.raw_data, dtype=np.int16).astype(np.float32) / 32768.0
        return samples
    except Exception as e:
        raise ValueError(f"Audio decode failed: {e}")


def pyin_to_notes(f0: np.ndarray, voiced: np.ndarray, confidence: np.ndarray) -> list[dict]:
    """
    把 PYIN 的逐帧 f0 序列转换成音符列表。
    
    f0[i]: 第 i 帧的基频 Hz（非浊音帧为 NaN）
    voiced[i]: 该帧是否有音高
    confidence[i]: 置信度 0–1
    """
    notes = []
    note_start = None
    note_midi  = None
    note_confs: list[float] = []

    n_frames = len(f0)
    for i in range(n_frames):
        t = i * HOP_LEN / SR
        v = voiced[i] and not math.isnan(f0[i]) and confidence[i] >= MIN_CONF

        if v:
            midi = round(12 * math.log2(f0[i] / 440) + 69)
            # 限制到人声范围 C2(36)–C6(84)
            if not (36 <= midi <= 84):
                v = False

        if v:
            if note_start is None:
                note_start = t
                note_midi  = midi
                note_confs = [float(confidence[i])]
            elif midi != note_midi:
                # 音高变化 → 结束当前音符，开始新音符
                dur = t - note_start
                if dur >= MIN_NOTE_DUR:
                    avg_conf = sum(note_confs) / len(note_confs)
                    notes.append({
                        "pitch":      note_midi,
                        "start":      round(note_start, 3),
                        "duration":   round(dur, 3),
                        "velocity":   round(min(1.0, avg_conf) * 0.85, 3),
                        "confidence": round(avg_conf, 3),
                    })
                note_start = t
                note_midi  = midi
                note_confs = [float(confidence[i])]
            else:
                note_confs.append(float(confidence[i]))
        else:
            if note_start is not None:
                dur = t - note_start
                if dur >= MIN_NOTE_DUR:
                    avg_conf = sum(note_confs) / len(note_confs)
                    notes.append({
                        "pitch":      note_midi,
                        "start":      round(note_start, 3),
                        "duration":   round(dur, 3),
                        "velocity":   round(min(1.0, avg_conf) * 0.85, 3),
                        "confidence": round(avg_conf, 3),
                    })
                note_start = None
                note_midi  = None
                note_confs = []

    # 收尾
    if note_start is not None and note_midi is not None:
        dur = (n_frames * HOP_LEN / SR) - note_start
        if dur >= MIN_NOTE_DUR:
            avg_conf = sum(note_confs) / len(note_confs) if note_confs else 0.7
            notes.append({
                "pitch":      note_midi,
                "start":      round(note_start, 3),
                "duration":   round(dur, 3),
                "velocity":   round(min(1.0, avg_conf) * 0.85, 3),
                "confidence": round(avg_conf, 3),
            })

    return notes


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    """
    接收任意音频文件，用 PYIN 算法提取音高序列，返回 note 列表。
    
    输入格式：webm / opus / mp4 / wav / m4a
    输出：{ notes: [{pitch, start, duration, velocity, confidence}], source: "pyin" }
    """
    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="Empty audio file")

        # 解码
        y = decode_audio(data, audio.filename or "hum.webm")

        # PYIN 分析
        f0, voiced_flag, voiced_probs = librosa.pyin(
            y,
            fmin=FMIN,
            fmax=FMAX,
            sr=SR,
            frame_length=FRAME_LEN,
            hop_length=HOP_LEN,
            fill_na=float("nan"),
        )

        # voiced_probs 即置信度
        notes = pyin_to_notes(f0, voiced_flag, voiced_probs)
        
        logger.info(f"PYIN: {len(notes)} notes detected from {len(f0)} frames")
        return {"notes": notes, "source": "pyin", "frameCount": len(f0)}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Transcription error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
def health():
    return {"status": "ok", "service": "murmur-pyin-worker", "backend": "librosa-pyin"}


@app.get("/")
def root():
    return {"service": "MURMUR PYIN Worker", "endpoints": ["/transcribe", "/health"]}

import importlib.util
import io
import math
import struct
import unittest
import wave


def has_worker_deps() -> bool:
    return all(
        importlib.util.find_spec(module) is not None
        for module in ("fastapi", "librosa", "numpy", "soundfile")
    )


@unittest.skipUnless(has_worker_deps(), "audio worker runtime deps are not installed")
class WorkerPipelineTests(unittest.TestCase):
    def test_decode_wav_to_mono_22050_float32(self):
        from main import SR, decode_audio

        wav = synth_wav(
            sample_rate=44100,
            channels=2,
            segments=[
                (0.2, 0.0),
                (0.8, 261.63),
                (0.2, 0.0),
            ],
        )

        decoded = decode_audio(wav, "hum.wav")

        self.assertEqual(decoded.ndim, 1)
        self.assertGreater(len(decoded), SR)
        self.assertLess(abs(float(decoded.max()) - 0.35), 0.08)

    def test_trim_silence_reduces_head_and_tail_padding(self):
        from main import SR, trim_silence

        import numpy as np

        silence = np.zeros(int(SR * 0.5), dtype=np.float32)
        tone = 0.25 * np.sin(2 * np.pi * 261.63 * np.arange(int(SR * 0.8)) / SR)
        audio = np.concatenate([silence, tone.astype(np.float32), silence])

        trimmed = trim_silence(audio)

        self.assertLess(len(trimmed), len(audio))
        self.assertGreater(len(trimmed), int(SR * 0.7))

    def test_synthetic_hum_produces_swiftf0_notes_in_auto_mode(self):
        from audio_engine.detectors import DetectorConfig, detect_pitch
        from main import (
            FRAME_LEN,
            FMAX,
            FMIN,
            HOP_LEN,
            SR,
            decode_audio,
            pyin_to_notes,
            trim_silence,
        )

        wav = synth_wav(
            sample_rate=SR,
            channels=1,
            segments=[
                (0.2, 0.0),
                (0.45, 261.63),
                (0.45, 293.66),
                (0.45, 329.63),
                (0.2, 0.0),
            ],
        )
        decoded = trim_silence(decode_audio(wav, "hum.wav"))
        detection = detect_pitch(
            decoded,
            DetectorConfig(
                provider="auto",
                sample_rate=SR,
                fmin=FMIN,
                fmax=FMAX,
                frame_length=FRAME_LEN,
                hop_length=HOP_LEN,
            ),
        )
        notes = pyin_to_notes(
            detection.f0,
            detection.voiced,
            detection.confidence,
            hop_length=detection.hop_length,
            sample_rate=detection.sample_rate,
        )

        self.assertEqual(detection.provider, "swiftf0")
        self.assertGreaterEqual(len(notes), 2)
        self.assertTrue(any(59 <= note["pitch"] <= 61 for note in notes))
        self.assertTrue(any(61 <= note["pitch"] <= 63 for note in notes))


def synth_wav(
    *,
    sample_rate: int,
    channels: int,
    segments: list[tuple[float, float]],
    amplitude: float = 0.35,
) -> bytes:
    frames = bytearray()
    phase = 0.0

    for duration, frequency in segments:
        sample_count = int(duration * sample_rate)
        for _ in range(sample_count):
            sample = 0.0
            if frequency > 0:
                sample = amplitude * math.sin(phase)
                phase += 2 * math.pi * frequency / sample_rate
            int_sample = max(-32768, min(32767, round(sample * 32767)))
            packed = struct.pack("<h", int_sample)
            for _channel in range(channels):
                frames.extend(packed)

    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(bytes(frames))
    return output.getvalue()


if __name__ == "__main__":
    unittest.main()

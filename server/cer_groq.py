"""Groq(whisper-large-v3 호스팅) CER 측정. 같은 영상·같은 정답으로 잰다.

모델은 원본 프로젝트(digestube/server/pipeline/ingest.py:245)와 동일하게 whisper-large-v3.
로컬 mlx-whisper는 whisper-large-v3-turbo를 쓰므로 둘은 서로 다른 모델이다.
"""
import os
import pathlib
import time

from dotenv import load_dotenv

from cer_test import cer, vtt_to_text

load_dotenv()

AUDIO = "work/fGNGKCz60NE.m4a"
REF = "work/fGNGKCz60NE.ko.vtt"
DUR = 821  # 영상 길이(초)

if __name__ == "__main__":
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise SystemExit("GROQ_API_KEY 없음 — server/.env 확인")

    from groq import Groq

    audio = pathlib.Path(AUDIO)
    t0 = time.time()
    r = Groq(api_key=key).audio.transcriptions.create(
        file=(audio.name, audio.read_bytes()),
        model="whisper-large-v3",
        language=None,
        response_format="verbose_json",
    )
    elapsed = time.time() - t0

    segments = r.segments if hasattr(r, "segments") else r["segments"]
    hyp_text = " ".join(
        (s["text"] if isinstance(s, dict) else s.text).strip() for s in segments
    )

    ref_text = vtt_to_text(REF)
    score = cer(ref_text, hyp_text)

    print("=== Groq (whisper-large-v3) ===")
    print(f"CER: {score*100:.2f}%")
    print(f"걸린 시간: {elapsed:.1f}초 (영상 길이 대비 {DUR/elapsed:.1f}배속)")
    print(f"\n인식 앞부분: {hyp_text[:200]}")

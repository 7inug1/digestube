"""STT 후보 CER 실측 스크립트. 우리 콘텐츠(세바시)로 직접 잰다.
정답은 사람이 올린 자막(fGNGKCz60NE.ko.vtt), 후보는 mlx-whisper부터 시작."""
import re
import sys
import time

import jiwer

NORM = re.compile(r"[^가-힣a-zA-Z0-9]")


def norm(s: str) -> str:
    return NORM.sub("", s).lower()


def vtt_to_text(path: str) -> str:
    lines = open(path, encoding="utf-8").read().splitlines()
    out = []
    for line in lines:
        if "-->" in line or line.strip() in ("WEBVTT", "") or line.startswith("Kind:") or line.startswith("Language:"):
            continue
        out.append(line.strip())
    return " ".join(out)


def cer(ref: str, hyp: str) -> float:
    r, h = norm(ref), norm(hyp)
    return jiwer.cer(r, h)


if __name__ == "__main__":
    ref_text = vtt_to_text("work/fGNGKCz60NE.ko.vtt")
    print(f"정답 글자 수(정규화 전): {len(ref_text)}")

    import mlx_whisper
    t0 = time.time()
    r = mlx_whisper.transcribe(
        "work/fGNGKCz60NE.m4a",
        path_or_hf_repo="mlx-community/whisper-large-v3-turbo",  # 원래 프로젝트(ingest.py:46)와 동일 모델
        language=None,
        condition_on_previous_text=False,
        hallucination_silence_threshold=2.0,
    )
    elapsed = time.time() - t0
    hyp_text = " ".join(s["text"].strip() for s in r["segments"])

    score = cer(ref_text, hyp_text)
    print(f"\n=== mlx-whisper (whisper-large-v3-turbo) ===")
    print(f"CER: {score*100:.2f}%")
    print(f"걸린 시간: {elapsed:.1f}초 (영상 길이 대비 {821/elapsed:.1f}배속)")
    print(f"\n정답 앞부분: {ref_text[:200]}")
    print(f"\n인식 앞부분: {hyp_text[:200]}")

    # 유튜브 자동자막도 같은 영상·같은 정답으로 재측정한다. 예전 10.10%는 다른
    # 영상("컴공")에서 잰 숫자라 이번 라운드 후보들과 같은 조건이 아니었다.
    auto_text = vtt_to_text("work/fGNGKCz60NE.auto.ko.vtt")
    auto_score = cer(ref_text, auto_text)
    print(f"\n=== 유튜브 자동자막(같은 영상 재측정) ===")
    print(f"CER: {auto_score*100:.2f}%")

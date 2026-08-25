"""소거를 통과한 STT 후보들을 검수된 정답으로 채점한다.

정답은 build_truth.py가 만든 truth_*.txt(사람이 영상과 대조해 확정한 것)를 쓴다.
후보는 notes/02-stt.md의 소거를 통과한 것들 — 로컬 mlx-whisper, Groq,
그리고 비교 대상인 유튜브 자동자막.
"""
import os
import pathlib
import re
import time

import jiwer
from dotenv import load_dotenv

load_dotenv()

WORK = pathlib.Path(__file__).resolve().parent / "work"
NORM = re.compile(r"[^가-힣a-zA-Z0-9]")

# 원본 프로젝트(ingest.py:209)와 같은 환각 필터. Whisper는 무음·음악 구간에서
# 같은 말을 반복해서 뱉는 일이 있는데, 원본은 로컬·Groq 양쪽 결과에 이 필터를
# 건다. 측정도 같은 조건이어야 공정하다.
_REPEAT_RE = re.compile(r"(\S+)(\s+\1){3,}")


def is_hallucinated(text: str) -> bool:
    return bool(_REPEAT_RE.search(text))


def join_segments(texts):
    return " ".join(x.strip() for x in texts if x.strip() and not is_hallucinated(x))

# 원본 프로젝트(digestube/server/pipeline/ingest.py)와 같은 모델을 쓴다.
MLX_MODEL = "mlx-community/whisper-large-v3-turbo"
GROQ_MODEL = "whisper-large-v3"

TARGETS = [
    {"name": "고려대(한국어)", "vid": "ljnw_JyvJEQ", "truth": "truth_고려대.txt",
     "auto": "ljnw_JyvJEQ.auto.ko.vtt", "dur": 559},
    {"name": "PBS(영어)", "vid": "EzG8dcpdMH4", "truth": "truth_PBS.txt",
     "auto": "EzG8dcpdMH4.auto.en.vtt", "dur": 150},
]


def norm(s):
    return NORM.sub("", s).lower()


def cer(ref, hyp):
    return jiwer.cer(norm(ref), norm(hyp))


def read_truth(name):
    lines = (WORK / name).read_text(encoding="utf-8").splitlines()
    return " ".join(l for l in lines if not l.startswith("#"))


def read_vtt(name):
    f = WORK / name
    if not f.exists():
        return None
    out = []
    for line in f.read_text(encoding="utf-8").splitlines():
        if "-->" in line or not line.strip():
            continue
        if line.strip() in ("WEBVTT",) or line.startswith(("Kind:", "Language:")):
            continue
        out.append(line.strip())
    return " ".join(out)


def run_mlx(audio):
    import mlx_whisper
    t0 = time.time()
    r = mlx_whisper.transcribe(str(audio), path_or_hf_repo=MLX_MODEL, language=None,
                               condition_on_previous_text=False,
                               hallucination_silence_threshold=2.0)
    return join_segments(s["text"] for s in r["segments"]), time.time() - t0


def run_groq(audio):
    from groq import Groq
    key = os.getenv("GROQ_API_KEY")
    if not key:
        return None, None
    t0 = time.time()
    r = Groq(api_key=key).audio.transcriptions.create(
        file=(audio.name, audio.read_bytes()), model=GROQ_MODEL,
        language=None, response_format="verbose_json")
    segs = r.segments if hasattr(r, "segments") else r["segments"]
    text = join_segments((s["text"] if isinstance(s, dict) else s.text) for s in segs)
    return text, time.time() - t0


RUNS = 3


def report(label, runs, dur):
    """같은 오디오를 여러 번 돌린다. Whisper는 실행마다 결과가 달라질 수 있어서
    한 번 잰 값으로는 후보를 비교할 수 없다(Groq에서 2.36~8.73%까지 흔들렸다)."""
    cers = [c for c, _ in runs]
    speeds = [dur / s for _, s in runs]
    spread = f"{min(cers)*100:.2f}~{max(cers)*100:.2f}" if max(cers) - min(cers) > 0.0005 else "일정"
    avg = sum(cers) / len(cers) * 100
    print(f"{label:22}{avg:7.2f}%{spread:>14}{sum(speeds)/len(speeds):8.0f}배속")


if __name__ == "__main__":
    for tg in TARGETS:
        audio = WORK / f"{tg['vid']}.m4a"
        truth = read_truth(tg["truth"])
        print(f"\n{'=' * 68}")
        print(f"{tg['name']}  ({tg['dur']}초, 정답 {len(norm(truth)):,}자, {RUNS}회 반복)")
        print(f"{'=' * 68}")
        print(f"{'후보':22}{'평균 CER':>8}{'편차':>14}{'속도':>12}")

        runs = []
        for _ in range(RUNS):
            text, sec = run_mlx(audio)
            runs.append((cer(truth, text), sec))
        report("mlx-whisper(로컬)", runs, tg["dur"])

        runs = []
        for _ in range(RUNS):
            text, sec = run_groq(audio)
            if not text:
                break
            runs.append((cer(truth, text), sec))
        if runs:
            report("Groq(클라우드)", runs, tg["dur"])
        else:
            print(f"{'Groq(클라우드)':22}{'GROQ_API_KEY 없음':>26}")

        auto = read_vtt(tg["auto"])
        if auto:
            print(f"{'유튜브 자동자막':22}{cer(truth, auto)*100:7.2f}%{'고정':>14}{'즉시':>12}")
        else:
            print(f"{'유튜브 자동자막':22}{'자동자막 없음':>26}")

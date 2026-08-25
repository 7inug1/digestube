"""Digestube v2 — 파이프라인을 한 단계씩 다시 만드는 서버.
노트(notes/)와 실제 기능을 같은 화면에서 보여준다."""
import json
import os
import pathlib
import re
import subprocess
import sys

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()

ROOT = pathlib.Path(__file__).resolve().parent.parent
NOTES = ROOT / "notes"
WORK = pathlib.Path(__file__).resolve().parent / "work"
WORK.mkdir(exist_ok=True)

YT_DLP = str(pathlib.Path(sys.executable).parent / "yt-dlp")
YT_DLP_ARGS = [
    "--extractor-args",
    "youtube:player_client=android;player_skip=webpage,configs;"
    "innertube_host=youtubei.googleapis.com;lang=ko",
]

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/")
def index():
    return FileResponse(pathlib.Path(__file__).resolve().parent / "static" / "index.html")


@app.get("/api/notes")
def list_notes():
    """notes/ 폴더 파일 목록. 화면 왼쪽 패널이 이걸로 탭을 만든다."""
    files = sorted(NOTES.glob("*.md"))
    return [{"id": f.stem, "title": f.stem} for f in files]


@app.get("/api/notes/{note_id}")
def get_note(note_id: str):
    f = NOTES / f"{note_id}.md"
    if not f.exists():
        raise HTTPException(404, "그런 노트 없음")
    return {"id": note_id, "content": f.read_text(encoding="utf-8")}


class ExtractIn(BaseModel):
    url: str


@app.post("/api/extract")
def extract(inp: ExtractIn):
    """yt-dlp로 오디오만 뽑는다. notes/01-yt-dlp.md에서 정한 그 도구, 그 옵션 그대로."""
    out_tmpl = str(WORK / "%(id)s.%(ext)s")
    r = subprocess.run(
        [YT_DLP, *YT_DLP_ARGS,
         "-f", "bestaudio[ext=m4a]/bestaudio/best",
         "--extract-audio", "--audio-format", "m4a",
         "--print", "before_dl:%(.{id,title,duration,channel})j",
         "-o", out_tmpl, inp.url],
        capture_output=True, text=True, timeout=300,
    )
    if r.returncode != 0:
        raise HTTPException(400, r.stderr.strip()[-500:] or "다운로드 실패")

    # --print는 제목에 든 글자(구분자로 쓸 만한 것 전부 포함)와 절대 안 겹치는
    # JSON 한 줄을 뱉어준다 — 예전엔 "|"로 자체 구분했는데, 제목에 "|"가 실제로
    #들어있는 영상(예: "... | 백영재 박사...")을 만나 파싱이 깨졌었다.
    meta = json.loads(r.stdout.strip().splitlines()[-1])
    vid = meta["id"]
    audio_path = WORK / f"{vid}.m4a"
    size_kb = round(audio_path.stat().st_size / 1024, 1) if audio_path.exists() else None

    return {
        "id": vid, "title": meta["title"], "channel": meta.get("channel"),
        "duration_sec": meta.get("duration"),
        "audio_file": audio_path.name, "size_kb": size_kb,
    }


_VID_RE = re.compile(r"^[\w-]{1,32}$")


@app.get("/api/audio/{vid}")
def get_audio(vid: str):
    """방금 뽑은 오디오를 화면에서 바로 재생·다운로드할 수 있게 내려준다.
    vid를 파일명으로 그대로 쓰므로 영숫자·-·_ 외 문자는 막는다(경로 탈출 방지)."""
    if not _VID_RE.match(vid):
        raise HTTPException(400, "잘못된 id")
    f = WORK / f"{vid}.m4a"
    if not f.exists():
        raise HTTPException(404, "그 오디오 없음 — 먼저 추출해야 함")
    return FileResponse(f, media_type="audio/mp4", filename=f.name)


# ── 정답 검수 ────────────────────────────────────────────────────
# STT 정확도(CER)를 재려면 "사람이 만든 자막"을 정답으로 써야 하는데, 자막이
# 있다고 다 맞는 건 아니다(빠진 구간, 화면 그래픽 글자 등). 사람이 영상을 보며
# 한 줄씩 대조해야 정답으로 확정된다 — notes/03-cer-videos.md의 3단계.
REVIEW_TARGETS = {
    "korea-univ": {
        "video_id": "ljnw_JyvJEQ",
        "title": "고려대 — 내 알고리즘은 정말 내 취향일까?",
        "vtt": "ljnw_JyvJEQ.ko.vtt",
        "duration": 559,
        "note": "자막 코드 ko(채널 자체 제작) · 0~559초 전 구간 커버 · 대괄호로 표시된 화면 그래픽 글자는 제거함",
        "strip_brackets": True,
    },
    "sebasi": {
        "video_id": "fGNGKCz60NE",
        "title": "세바시 — 완벽주의 아니고 그냥 게으른 걸까?",
        "vtt": "fGNGKCz60NE.ko.vtt",
        "duration": 821,
        "note": "알려진 결함: 앞 30초(티저 구간)에 자막이 없음",
        "strip_brackets": False,
    },
    "pbs": {
        "video_id": "EzG8dcpdMH4",
        "title": "PBS NewsHour — Graham and Norman in South Carolina",
        "vtt": "EzG8dcpdMH4.en.vtt",
        "duration": 150,
        "note": "자막이 0.4~149.3초로 영상 전체를 덮음",
        "strip_brackets": False,
    },
}
MARKS = WORK / "review_marks.json"


def _vtt_lines(path: pathlib.Path, strip_brackets: bool):
    def sec(x):
        h, m, s = x.split(":")
        return round(int(h) * 3600 + int(m) * 60 + float(s), 2)

    out, start = [], None
    for line in path.read_text(encoding="utf-8").splitlines():
        if "-->" in line:
            start = sec(line.split(" --> ")[0].strip())
            continue
        line = line.strip()
        if not line or line == "WEBVTT" or line.startswith(("Kind:", "Language:")):
            continue
        if strip_brackets:
            line = " ".join(re.sub(r"\[[^\]]*\]", " ", line).split())
            if not line:
                continue
        if start is not None:
            out.append({"t": start, "text": line})
    return out


@app.get("/api/review")
def list_review():
    return [{"id": k, **{f: v[f] for f in ("video_id", "title", "duration", "note")}}
            for k, v in REVIEW_TARGETS.items()]


@app.get("/api/review/{rid}")
def get_review(rid: str):
    cfg = REVIEW_TARGETS.get(rid)
    if not cfg:
        raise HTTPException(404, "그런 검수 대상 없음")
    f = WORK / cfg["vtt"]
    if not f.exists():
        raise HTTPException(404, f"자막 파일이 없습니다: {cfg['vtt']}")
    marks = json.loads(MARKS.read_text(encoding="utf-8")) if MARKS.exists() else {}
    return {"id": rid, **cfg, "lines": _vtt_lines(f, cfg["strip_brackets"]),
            "marks": marks.get(rid, {})}


class MarkIn(BaseModel):
    index: int
    verdict: str  # ok · bad · "" (해제)
    memo: str = ""


@app.post("/api/review/{rid}/mark")
def set_mark(rid: str, inp: MarkIn):
    if rid not in REVIEW_TARGETS:
        raise HTTPException(404, "그런 검수 대상 없음")
    marks = json.loads(MARKS.read_text(encoding="utf-8")) if MARKS.exists() else {}
    cur = marks.setdefault(rid, {})
    if inp.verdict:
        cur[str(inp.index)] = {"verdict": inp.verdict, "memo": inp.memo}
    else:
        cur.pop(str(inp.index), None)
    MARKS.write_text(json.dumps(marks, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"saved": True, "count": len(cur)}


# ── 오차 대조 ────────────────────────────────────────────────────
# CER은 "몇 퍼센트 틀렸다"는 숫자 하나로 요약되는데, 그것만 봐서는 어디가 왜
# 틀렸는지 알 수 없다. 정답과 STT 결과를 낱말 단위로 맞춰서 다른 부분을
# 표시해주면, 오차가 특정 구간에 몰렸는지 전체에 흩어졌는지 눈으로 보인다.
DIFF_CANDIDATES = {"mlx": "mlx-whisper(로컬)", "groq": "Groq(클라우드)", "auto": "유튜브 자동자막"}


def _hyp_text(target: str, cand: str, refresh: bool) -> str:
    import measure

    tg = next((x for x in measure.TARGETS if x["truth"] == f"truth_{target}.txt"), None)
    if tg is None:
        raise HTTPException(404, "그런 대조 대상 없음")

    if cand == "auto":
        text = measure.read_vtt(tg["auto"])
        if text is None:
            raise HTTPException(404, "이 영상에는 유튜브 자동자막이 없습니다")
        return text

    cache = WORK / f"hyp_{target}_{cand}.txt"
    if cache.exists() and not refresh:
        return cache.read_text(encoding="utf-8")

    audio = WORK / f"{tg['vid']}.m4a"
    if not audio.exists():
        raise HTTPException(404, f"오디오가 없습니다: {audio.name}")
    text, _ = measure.run_mlx(audio) if cand == "mlx" else measure.run_groq(audio)
    if not text:
        raise HTTPException(400, "전사 실패 — API 키를 확인하세요")
    cache.write_text(text, encoding="utf-8")
    return text


def _word_ops(a, b):
    """낱말 단위 정렬. 마침표·띄어쓰기만 다른 건 CER 정규화로 지워지므로
    점수에 영향이 없다 — 진짜 오차와 섞이지 않게 cosmetic으로 따로 표시한다."""
    import difflib

    import measure

    out = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        ta, hb = " ".join(a[i1:i2]), " ".join(b[j1:j2])
        out.append({"op": tag, "truth": ta, "hyp": hb,
                    "cosmetic": tag != "equal" and measure.norm(ta) == measure.norm(hb)})
    return out


@app.get("/api/diff/{target}/{cand}")
def get_diff(target: str, cand: str, refresh: bool = False):
    import difflib

    import measure

    if cand not in DIFF_CANDIDATES:
        raise HTTPException(404, "그런 후보 없음")

    lines = [l for l in (WORK / f"truth_{target}.txt").read_text(encoding="utf-8").splitlines()
             if l.strip() and not l.startswith("#")]
    truth = " ".join(lines)
    hyp = _hyp_text(target, cand, refresh)

    # 정답 낱말마다 "몇 번째 줄에 속하는지"를 기억해두고, 정렬 결과를 그 줄에
    # 다시 나눠 담는다. 그래야 줄 단위로 나란히 놓고 볼 수 있다.
    tw, line_of = [], []
    for idx, line in enumerate(lines):
        for w in line.split():
            tw.append(w)
            line_of.append(idx)
    hw = hyp.split()

    buckets = [[] for _ in lines]
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, tw, hw, autojunk=False).get_opcodes():
        if tag == "insert":
            at = line_of[i1] if i1 < len(line_of) else len(lines) - 1
            buckets[at].extend(hw[j1:j2])
            continue
        # equal·replace·delete 는 정답 낱말 구간이 있으므로, 줄이 바뀌는 지점을
        # 기준으로 대응하는 STT 낱말을 비율대로 쪼개 넣는다.
        span = i2 - i1
        for k in range(i1, i2):
            at = line_of[k]
            s = j1 + round((k - i1) * (j2 - j1) / span) if span else j1
            e = j1 + round((k - i1 + 1) * (j2 - j1) / span) if span else j2
            buckets[at].extend(hw[s:e])

    rows, real = [], 0
    for idx, line in enumerate(lines):
        ops = _word_ops(line.split(), buckets[idx])
        n = sum(1 for o in ops if o["op"] != "equal" and not o["cosmetic"])
        real += n
        rows.append({"truth": line, "hyp": " ".join(buckets[idx]), "ops": ops, "diffs": n})

    return {"target": target, "cand": cand, "label": DIFF_CANDIDATES[cand],
            "cer": round(measure.cer(truth, hyp) * 100, 2),
            "truth_chars": len(measure.norm(truth)),
            "real_diffs": real, "rows": rows}


# ── 의미 오류 판정 ────────────────────────────────────────────────
# CER은 "표기가 얼마나 일치하는가"를 잰다. 콘텐츠/컨텐츠처럼 같은 말을 다르게
# 적은 것과, 체류시간/치료시간처럼 다른 말이 된 것을 똑같이 한 글자 오차로 센다.
# 검색·요약이 목적인 이 제품에서는 뒤엣것만 실제로 문제가 되므로 따로 센다.
LLM_MODEL = os.getenv("DIGESTUBE_LLM", "claude-haiku-4-5-20251001")
SEM_PROMPT = """아래는 영상 자막(정답)과 음성인식(STT) 결과가 서로 다른 부분들이다.
각 항목에 대해 "이 차이 때문에 문장의 뜻이 바뀌는가"만 판정하라.

뜻이 바뀌지 않는 예: 같은 낱말의 표기 차이(콘텐츠/컨텐츠), 축약형(조금/좀),
띄어쓰기, 숫자 표기(3/third), 간투사가 있고 없고(그, 좀, 이제).
뜻이 바뀌는 예: 다른 낱말이 됨(체류시간/치료시간, 편견/평균), 부정이 뒤집힘,
문장의 핵심 정보가 사라짐.

JSON 배열로만 답하라. 다른 말은 붙이지 마라.
[{"i": 0, "changed": true, "why": "짧은 이유"}]
"""


def _sem_path(target, cand):
    return WORK / f"semantic_{target}_{cand}.json"


@app.get("/api/semantic/{target}/{cand}")
def get_semantic(target: str, cand: str, refresh: bool = False):
    cache = _sem_path(target, cand)
    if cache.exists() and not refresh:
        return json.loads(cache.read_text(encoding="utf-8"))

    diff = get_diff(target, cand)
    pairs = []
    for r in diff["rows"]:
        for o in r["ops"]:
            if o["op"] != "equal" and not o["cosmetic"]:
                pairs.append({"i": len(pairs), "line": r["truth"],
                              "truth": o["truth"], "hyp": o["hyp"]})
    if not pairs:
        out = {"target": target, "cand": cand, "cer": diff["cer"], "pairs": [], "changed": 0}
        cache.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        return out

    key = os.getenv("ANTHROPIC_API_KEY")
    if not key:
        raise HTTPException(400, "ANTHROPIC_API_KEY 없음 — server/.env 확인")

    from anthropic import Anthropic

    body = "\n".join(
        f'{p["i"]}. 문장: {p["line"]}\n   정답: {p["truth"] or "(없음)"}\n   STT: {p["hyp"] or "(없음)"}'
        for p in pairs)
    r = Anthropic(api_key=key).messages.create(
        model=LLM_MODEL, max_tokens=4000,
        messages=[{"role": "user", "content": f"{SEM_PROMPT}\n{body}"}])
    text = re.sub(r"^```(json)?|```$", "", r.content[0].text.strip(), flags=re.M).strip()
    try:
        verdicts = {v["i"]: v for v in json.loads(text)}
    except Exception:
        raise HTTPException(502, "판정 결과를 읽지 못했습니다 — 다시 시도해 주세요")

    for p in pairs:
        v = verdicts.get(p["i"], {})
        p["changed"] = bool(v.get("changed"))
        p["why"] = v.get("why", "")
        p["fixed"] = False   # 사람이 판정을 고쳤는지

    out = {"target": target, "cand": cand, "cer": diff["cer"], "pairs": pairs,
           "changed": sum(1 for p in pairs if p["changed"])}
    cache.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    return out


class SemOverride(BaseModel):
    index: int
    changed: bool


@app.post("/api/semantic/{target}/{cand}/override")
def override_semantic(target: str, cand: str, inp: SemOverride):
    """LLM 판정을 사람이 고친다. 정답 자막을 검수했던 것과 같은 구조 —
    자동으로 뽑되 사람이 최종 확인해야 근거로 쓸 수 있다."""
    cache = _sem_path(target, cand)
    if not cache.exists():
        raise HTTPException(404, "먼저 판정을 실행해야 합니다")
    d = json.loads(cache.read_text(encoding="utf-8"))
    for p in d["pairs"]:
        if p["i"] == inp.index:
            p["changed"] = inp.changed
            p["fixed"] = True
            break
    d["changed"] = sum(1 for p in d["pairs"] if p["changed"])
    cache.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"saved": True, "changed": d["changed"]}


app.mount("/static", StaticFiles(directory=pathlib.Path(__file__).resolve().parent / "static"), name="static")

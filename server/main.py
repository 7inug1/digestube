"""Digestube v2 — 파이프라인을 한 단계씩 다시 만드는 서버.
노트(notes/)와 실제 기능을 같은 화면에서 보여준다."""
import json
import pathlib
import subprocess
import sys

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

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


app.mount("/static", StaticFiles(directory=pathlib.Path(__file__).resolve().parent / "static"), name="static")

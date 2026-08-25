"""검수 결과를 반영해 최종 정답(ground truth) 파일을 만든다.

유튜브에서 받은 자막을 그대로 정답으로 쓰지 않는다. 사람이 올린 자막에도
오류가 있기 때문이다(실제로 PBS 자막에서 빠진 단어를 찾았다). 검수 화면에서
✕로 표시하고 실제 발화를 적어둔 줄은 그 내용으로 교체한 뒤 정답으로 확정한다.

출력 파일 맨 위에 출처와 수정 내역을 남겨서, 이 정답이 어떻게 만들어졌는지
나중에 추적할 수 있게 한다.
"""
import datetime
import json
import pathlib
import re

WORK = pathlib.Path(__file__).resolve().parent / "work"
MARKS = WORK / "review_marks.json"

TARGETS = {
    "korea-univ": {
        "vtt": "ljnw_JyvJEQ.ko.vtt", "out": "truth_고려대.txt",
        "title": "고려대 — 내 알고리즘은 정말 내 취향일까?",
        "video": "ljnw_JyvJEQ", "lang": "ko", "strip_brackets": True,
    },
    "pbs": {
        "vtt": "EzG8dcpdMH4.en.vtt", "out": "truth_PBS.txt",
        "title": "PBS NewsHour — Graham and Norman in South Carolina",
        "video": "EzG8dcpdMH4", "lang": "en", "strip_brackets": False,
    },
    "sebasi": {
        "vtt": "fGNGKCz60NE.ko.vtt", "out": "truth_세바시.txt",
        "title": "세바시 — 완벽주의 아니고 그냥 게으른 걸까?",
        "video": "fGNGKCz60NE", "lang": "ko", "strip_brackets": False,
    },
}


def vtt_lines(path: pathlib.Path, strip_brackets: bool):
    out, start = [], None
    for line in path.read_text(encoding="utf-8").splitlines():
        if "-->" in line:
            h, m, s = line.split(" --> ")[0].strip().split(":")
            start = round(int(h) * 3600 + int(m) * 60 + float(s), 2)
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


def build(rid: str) -> tuple[int, int] | None:
    cfg = TARGETS[rid]
    src = WORK / cfg["vtt"]
    if not src.exists():
        print(f"  {rid}: 자막 파일 없음 ({cfg['vtt']}) — 건너뜀")
        return None

    marks = json.loads(MARKS.read_text(encoding="utf-8")) if MARKS.exists() else {}
    mine = marks.get(rid, {})
    lines = vtt_lines(src, cfg["strip_brackets"])

    fixed = []
    for i, ln in enumerate(lines):
        m = mine.get(str(i))
        if m and m["verdict"] == "bad" and m["memo"]:
            fixed.append((i, ln["text"], m["memo"]))
            ln = {**ln, "text": m["memo"]}
        lines[i] = ln

    checked = len(mine)
    with open(WORK / cfg["out"], "w", encoding="utf-8") as f:
        f.write(f"# {cfg['title']}\n")
        f.write(f"# https://www.youtube.com/watch?v={cfg['video']}\n")
        f.write(f"# 언어: {cfg['lang']} · 자막 출처: 채널이 올린 사람 자막({cfg['vtt']})\n")
        f.write(f"# 검수: 사람이 영상과 대조함 · 수정한 줄 {len(fixed)}개 / 표시한 줄 {checked}개\n")
        if cfg["strip_brackets"]:
            f.write("# 대괄호로 표시된 화면 그래픽 글자는 음성이 아니므로 제외함\n")
        for i, before, after in fixed:
            f.write(f"#   [{i}줄] 자막: {before}\n")
            f.write(f"#          실제: {after}\n")
        f.write(f"# 생성: {datetime.date.today()}\n")
        f.write("#" + "=" * 60 + "\n")
        for ln in lines:
            f.write(f"{ln['text']}\n")

    return len(lines), len(fixed)


if __name__ == "__main__":
    for rid in TARGETS:
        r = build(rid)
        if r:
            n, fx = r
            print(f"  {WORK.name}/{TARGETS[rid]['out']}: {n}줄, 수정 {fx}개")

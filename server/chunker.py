"""문단 나누기(청킹) 방법 비교.

전사된 글은 말이 쭉 이어진 덩어리라 그대로는 못 쓴다. 나눠놓은 문단이
검색 결과 단위이자 읽는 단위가 되므로, 어떻게 나누느냐가 검색 품질을 좌우한다.

판정 기준 세 가지(notes/04-chunking.md):
  ① 문장 중간에서 끊기지 않는다 — 끊기면 검색에 걸려도 말이 안 통한다
  ② 길이가 고르다 — 너무 짧으면 뜻이 없고, 너무 길면 여러 얘기가 섞인다
  ③ 한 문단에 한 얘기만 있다 — 섞이면 벡터가 흐려져 검색이 어중간해진다

①②는 여기서 기계로 센다. ③은 판정이 필요해서 따로 다룬다.
"""
import re
import statistics

TARGET = 340                       # 목표 글자 수
ENDS = ("。", ".", "?", "!", "？", "！")


def to_sentences(text: str) -> list[str]:
    """문장부호를 기준으로 문장을 끊는다. 부호를 문장 끝에 붙여서 남긴다."""
    out, buf = [], ""
    for ch in text:
        buf += ch
        if ch in ENDS:
            out.append(buf.strip())
            buf = ""
    if buf.strip():
        out.append(buf.strip())
    return out


def method_a(text: str, target: int = TARGET) -> list[str]:
    """A — 글자 수만 세서 자른다. 문장 경계를 보지 않는다."""
    return [text[i:i + target] for i in range(0, len(text), target)]


def method_b(text: str, **_) -> list[str]:
    """B — 문장 하나가 문단 하나. 마침표마다 자른다."""
    return to_sentences(text)


def method_c(text: str, target: int = TARGET) -> list[str]:
    """C — 문장 끝에서만 자르되, 목표 길이를 넘길 때까지 문장을 모은다."""
    out, buf = [], ""
    for s in to_sentences(text):
        if buf and len(buf) + len(s) + 1 > target:
            out.append(buf.strip())
            buf = s
        else:
            buf = f"{buf} {s}".strip()
    if buf.strip():
        out.append(buf.strip())
    return out


METHODS = {
    "A": ("글자 수로 자르기", method_a),
    "B": ("마침표마다 자르기", method_b),
    "C": ("문장 끝 + 길이 맞추기", method_c),
}


def score(chunks: list[str], target: int = TARGET) -> dict:
    """①② 를 기계로 센다. ③(한 얘기만)은 판정이 필요해 여기 없다."""
    lens = [len(c) for c in chunks]
    broken = [c for c in chunks if c.strip() and not c.strip().endswith(ENDS)]
    # 마지막 문단은 글이 거기서 끝나 부호가 없을 수 있으므로 세지 않는다
    if chunks and chunks[-1] in broken:
        broken = broken[:-1]
    return {
        "count": len(chunks),
        "broken": len(broken),
        "broken_pct": round(len(broken) / len(chunks) * 100, 1) if chunks else 0,
        "min": min(lens) if lens else 0,
        "max": max(lens) if lens else 0,
        "avg": round(statistics.mean(lens)) if lens else 0,
        "stdev": round(statistics.pstdev(lens)) if len(lens) > 1 else 0,
    }


def run_all(text: str, target: int = TARGET) -> dict:
    out = {}
    for key, (label, fn) in METHODS.items():
        chunks = fn(text, target=target)
        out[key] = {"label": label, "chunks": chunks, "score": score(chunks, target)}
    return out


if __name__ == "__main__":
    import pathlib

    src = pathlib.Path(__file__).resolve().parent / "work" / "hyp_고려대_mlx.txt"
    text = re.sub(r"\s+", " ", src.read_text(encoding="utf-8")).strip()
    print(f"원문 {len(text):,}자\n")
    print(f"{'':4}{'방법':22}{'문단수':>6}{'중간끊김':>10}{'평균':>7}{'최소~최대':>14}{'편차':>7}")
    for key, r in run_all(text).items():
        s = r["score"]
        print(f"{key:4}{r['label']:22}{s['count']:6d}{s['broken']:>6d}건"
              f"{s['broken_pct']:>4.0f}%{s['avg']:7d}{s['min']:>7d}~{s['max']:<6d}{s['stdev']:7d}")

"""검수용 스크립트 뽑기. vtt 자막을 "시각 + 문장" 형태로 읽기 좋게 편다.

사람이 영상을 보면서 이 파일과 대조해 "자막이 실제 말과 맞는가"를 확인하는 용도다
(notes/03-cer-videos.md의 3단계). 이 검수를 통과해야 정답으로 쓸 수 있다.
"""
import sys


def sec(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def mmss(x):
    return f"{int(x)//60:02d}:{int(x)%60:02d}"


def to_script(vtt_path, out_path, title):
    lines = open(vtt_path, encoding="utf-8").read().splitlines()
    rows, cur_start = [], None
    for line in lines:
        if "-->" in line:
            cur_start = sec(line.split(" --> ")[0].strip())
            continue
        line = line.strip()
        if not line or line in ("WEBVTT",) or line.startswith(("Kind:", "Language:")):
            continue
        if cur_start is not None:
            rows.append((cur_start, line))

    # 같은 초에 여러 조각으로 쪼개진 자막을 한 줄로 합쳐 읽기 편하게 만든다
    merged, buf, buf_t = [], [], None
    for t, text in rows:
        if buf_t is None:
            buf_t = t
        buf.append(text)
        if len(" ".join(buf)) > 60:
            merged.append((buf_t, " ".join(buf)))
            buf, buf_t = [], None
    if buf:
        merged.append((buf_t, " ".join(buf)))

    with open(out_path, "w", encoding="utf-8") as f:
        f.write(f"{title}\n")
        f.write(f"자막 파일: {vtt_path}\n")
        f.write(f"총 {len(merged)}줄\n")
        f.write("=" * 60 + "\n\n")
        for t, text in merged:
            f.write(f"[{mmss(t)}] {text}\n")
    return len(merged)


if __name__ == "__main__":
    n1 = to_script(
        "work/fGNGKCz60NE.ko.vtt",
        "work/script_세바시.txt",
        "세바시 — 완벽주의 아니고 그냥 게으른 걸까? (13분 41초)\n"
        "https://www.youtube.com/watch?v=fGNGKCz60NE\n"
        "※ 알려진 결함: 앞 30초(티저 구간)는 자막이 아예 없음",
    )
    n2 = to_script(
        "work/EzG8dcpdMH4.en.vtt",
        "work/script_PBS.txt",
        "PBS NewsHour — Graham and Norman make final push in South Carolina (2분 30초)\n"
        "https://www.youtube.com/watch?v=EzG8dcpdMH4\n"
        "※ 자막이 0.4초~149.3초로 영상 전체를 덮음",
    )
    print(f"세바시 스크립트: work/script_세바시.txt ({n1}줄)")
    print(f"PBS 스크립트   : work/script_PBS.txt ({n2}줄)")

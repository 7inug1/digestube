"""검수용 스크립트 뽑기. vtt 자막을 "시각 + 문장" 형태로 읽기 좋게 편다.

사람이 영상을 보면서 이 파일과 대조해 "자막이 실제 말과 맞는가"를 확인하는 용도다
(notes/03-cer-videos.md의 3단계). 이 검수를 통과해야 정답으로 쓸 수 있다.
"""
import re
import sys


def sec(t):
    h, m, s = t.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def mmss(x):
    return f"{int(x)//60:02d}:{int(x)%60:02d}"


def to_script(vtt_path, out_path, title, strip_brackets=False):
    lines = open(vtt_path, encoding="utf-8").read().splitlines()
    rows, cur_start = [], None
    for line in lines:
        if "-->" in line:
            cur_start = sec(line.split(" --> ")[0].strip())
            continue
        line = line.strip()
        if not line or line in ("WEBVTT",) or line.startswith(("Kind:", "Language:")):
            continue
        if strip_brackets:
            # 대괄호 안은 화면에 뜨는 그래픽 글자(제목·이름·자막 카드)를 옮긴 것이라
            # 음성이 아니다. STT가 받아쓸 수 없으므로 정답에서 뺀다.
            line = re.sub(r"\[[^\]]*\]", " ", line)
            line = " ".join(line.split())
            if not line:
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
    targets = [
        ("work/ljnw_JyvJEQ.ko.vtt", "work/script_고려대.txt",
         "고려대 — 내 알고리즘은 정말 내 취향일까? (9분 19초)\n"
         "https://www.youtube.com/watch?v=ljnw_JyvJEQ\n"
         "※ 자막 코드 ko(채널 자체 제작), 0.0~559.0초로 전 구간 커버\n"
         "※ 대괄호로 표시된 화면 그래픽 글자(전체의 21%)는 음성이 아니라 제거함", True),
        ("work/EzG8dcpdMH4.en.vtt", "work/script_PBS.txt",
         "PBS NewsHour — Graham and Norman make final push in South Carolina (2분 30초)\n"
         "https://www.youtube.com/watch?v=EzG8dcpdMH4\n"
         "※ 자막이 0.4~149.3초로 영상 전체를 덮음"),
        ("work/fGNGKCz60NE.ko.vtt", "work/script_세바시.txt",
         "세바시 — 완벽주의 아니고 그냥 게으른 걸까? (13분 41초)\n"
         "https://www.youtube.com/watch?v=fGNGKCz60NE\n"
         "※ 알려진 결함: 앞 30초(티저 구간)는 자막이 아예 없음"),
    ]
    for item in targets:
        vtt, out, title = item[0], item[1], item[2]
        strip = item[3] if len(item) > 3 else False
        n = to_script(vtt, out, title, strip)
        print(f"{out} ({n}줄)")

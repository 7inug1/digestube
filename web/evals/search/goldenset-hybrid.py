"""A+C 합치기: 리랭커 1위 점수가 확실히 높으면 결과, 확실히 낮으면 찾지 못함, 애매한 구간만 AI 판정(C).

    python3 evals/search/goldenset-hybrid.py <runs/...-judge.json>

구간 경계는 지금까지 본 모든 개발 질문(09-19 12개 + 오늘 dev 15개)에서 정했다.
- 위 경계 -2: 지금까지 답 없는 질문 1위 점수의 최댓값은 -3.67. 그보다 넉넉히 위.
- 아래 경계 -8: 지금까지 정답 근거를 찾은 답 있는 질문의 1위 점수는 Q01(-9.02)을 빼면 모두 -7.2 이상.
"""
import json, sys
HI, LO = -2.0, -8.0
d = json.load(open(sys.argv[1]))
res, calls = [], 0
for r in d['rows']:
    t = r['top']
    if t >= HI: say, how = True, 'A 확실(높음)'
    elif t < LO: say, how = False, 'A 확실(낮음)'
    else:
        say, how = r['c']['answerable'], 'C 판정'; calls += 1
    ok = say == r['answerable']
    res.append((r['id'], r['kind'], t, how, say, ok))
    print(f"{r['id']:4} {r['kind']:9} 1위 {t:6.2f} · {how:10} → {'결과' if say else '찾지 못함'} · {'맞음' if ok else '틀림'}")
n = len(res)
print(f"\n합계 {sum(x[5] for x in res)}/{n} · AI 판정 호출 {calls}/{n}회 ({calls/n:.0%})")

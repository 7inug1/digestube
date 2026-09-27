"""저장한 골든셋 검색 결과로 판단 방식만 바꿔 다시 채점한다(새로 검색하지 않음).

    python3 evals/search/goldenset-rescore.py <runs/...-goldenset-dev.json>

A: 리랭커 1위 점수 · B: 상위 3개 리랭커 점수 평균. 각각 기준값을 -10~+5 에서 0.1 간격으로 옮겨
개발용에서 가장 많이 맞는 구간을 찾는다. 같은 정답 수면 가운데 값을 고른다(경계에 딱 붙지 않게).
"""
import json, sys
d = json.load(open(sys.argv[1]))
rows = d['rows']
feats = {
    'A 1위 점수': lambda r: max(h['rerank_score'] for h in r['hits']),
    'B 상위 3개 평균': lambda r: sum(h['rerank_score'] for h in r['hits'][:3]) / len(r['hits'][:3]),
}
for name, f in feats.items():
    vals = [(r['id'], r['answerable'], round(f(r), 2)) for r in rows]
    best, grid = -1, []
    for i in range(-100, 51):
        t = i / 10
        ok = sum(1 for _, a, v in vals if (v >= t) == a)
        grid.append((t, ok)); best = max(best, ok)
    ts = [t for t, ok in grid if ok == best]
    # 가장 긴 연속 구간의 가운데
    runs, cur = [], [ts[0]]
    for t in ts[1:]:
        if abs(t - cur[-1] - 0.1) < 1e-9: cur.append(t)
        else: runs.append(cur); cur = [t]
    runs.append(cur); run = max(runs, key=len); mid = round(run[len(run)//2], 1)
    at4 = sum(1 for _, a, v in vals if (v >= -4) == a)
    wrong = [i for i, a, v in vals if (v >= mid) != a]
    print(f"{name}: -4 기준 {at4}/{len(vals)} · 최적 {best}/{len(vals)} (구간 {run[0]}~{run[-1]}, 가운데 {mid}) · 틀린 문항 {wrong}")
    print('   ', sorted(vals, key=lambda x: x[2]))

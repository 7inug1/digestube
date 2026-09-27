"""검색 개선 방식별로 합친 판단(A+C)까지 돌려 최종 정답 수를 비교한다.

    python3 evals/search/variants-hybrid.py <runs/...-retrieval-variants-dev.json>

경계는 2-4 에서 정한 값(-2 · -8) 그대로. 애매한 구간만 goldenset-judge.py 와 같은 프롬프트로 AI 판정.
"""
import json, sys, importlib.util
spec = importlib.util.spec_from_file_location('j', 'evals/search/goldenset-judge.py')
src = open('evals/search/goldenset-judge.py').read().split("path = sys.argv[1]")[0]
ns = {}; exec(src, ns)
HI, LO = -2.0, -8.0
rep = json.load(open(sys.argv[1]))
out = {}
for var in ['base', 'T', 'TC']:
    rows = rep[var]['rows']; ok = calls = 0; detail = []
    for r in rows:
        t = r['top']
        if t >= HI: say = True
        elif t < LO: say = False
        else:
            v, u, ms = ns['judge'](r['question'], r['hits']); say = v['answerable']; calls += 1
        good = say == r['answerable']; ok += good
        detail.append(f"{r['id']}{'' if good else '✗'}")
    out[var] = {'correct': f'{ok}/{len(rows)}', 'ai_calls': calls, 'found': rep[var]['found']}
    print(f"{var:3} 근거 {rep[var]['found']} · 합친 판단 {ok}/{len(rows)} · AI 호출 {calls} · {' '.join(detail)}")
json.dump(out, open(sys.argv[1].replace('.json', '-hybrid.json'), 'w'), ensure_ascii=False, indent=1)

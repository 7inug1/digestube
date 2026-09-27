"""물어보기 채점 — 골든셋 질문으로 검색 → (답이 있다고 판단되면) 답 생성까지 돌려 채점한다.

    DIGESTUBE_BASE=http://localhost:3191 python3 evals/search/ask-eval.py dev

채점(Claude 가 한다 — 답을 쓴 Gemini 와 다른 모델):
- 답 있는 질문: 답이 기대 답의 핵심과 맞는가(맞음/부분/틀림), 근거가 아닌 함정 문단을 인용했는가
- 답 없는 질문: "찾지 못했어요" 또는 답하지 않음(거절)이면 맞음, 답을 썼으면 틀림
"""
import json, os, sys, time, urllib.request, urllib.parse
split = sys.argv[1]
BASE = os.environ.get('DIGESTUBE_BASE', 'https://digestube.vercel.app')
env = {}
for l in open('.env.local'):
    if '=' in l and not l.startswith('#'):
        k, v = l.strip().split('=', 1); env[k] = v.strip('"')
AK = env['ANTHROPIC_API_KEY'].strip()
gold = json.load(open('data/evals/search/questions.v3.json'))
snap = json.load(open(gold['corpus_snapshot']['path']))
IDS = ','.join(v['video']['id'] for v in snap['corpus'])

def search(q):
    for _ in range(3):
        d = json.load(urllib.request.urlopen(f"{BASE}/api/search?" + urllib.parse.urlencode({'q': q, 'k': 3, 'rerank': 1, 'ids': IDS}), timeout=90))
        if d.get('rerank', {}).get('weak') is not None: return d
    raise RuntimeError('판단 못 받음')

def ask(q, hits):
    req = urllib.request.Request(f"{BASE}/api/ask", data=json.dumps({'q': q, 'hits': [{'video_id': h['video_id'], 'seq': h['seq']} for h in hits[:3]]}).encode(),
                                 headers={'content-type': 'application/json'})
    t0 = time.time(); last = None
    for line in urllib.request.urlopen(req, timeout=90):
        m = json.loads(line)
        if m['t'] in ('done', 'error'): last = m
    return last, int((time.time() - t0) * 1000)

def grade(q, expected, answer):
    prompt = f"""질문, 기대 답(정답지), 시스템이 쓴 답이 있다. 시스템 답이 기대 답의 핵심을 담았는지 판정한다.
- 맞음: 기대 답의 핵심을 모두 담음(표현이 달라도 됨)
- 부분: 핵심 일부만 담음
- 틀림: 핵심이 없거나 기대 답과 어긋남
JSON 하나만: {{"grade":"맞음|부분|틀림","why":"한 문장"}}

질문: {q}
기대 답: {expected}
시스템 답: {answer}"""
    req = urllib.request.Request('https://api.anthropic.com/v1/messages', data=json.dumps({'model': 'claude-sonnet-5', 'max_tokens': 300,
        'messages': [{'role': 'user', 'content': prompt}]}).encode(), headers={'x-api-key': AK, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'})
    txt = json.load(urllib.request.urlopen(req, timeout=60))['content'][0]['text']
    return json.loads(txt[txt.index('{'):txt.rindex('}') + 1])

rows = []
urllib.request.urlopen(urllib.request.Request(f"{BASE}/api/rerank/warm", method='POST'), timeout=60).read()
for q in [x for x in gold['questions'] if x['split'] == split]:
    d = search(q['question']); hits = d['hits']; weak = d['rerank']['weak']
    row = {'id': q['id'], 'kind': q['kind'], 'answerable': q['category'] == 'answerable', 'weak': weak}
    if not weak:
        a, ms = ask(q['question'], hits)
        row.update({'answer': a.get('text'), 'declined': a.get('declined'), 'cites': a.get('cites'), 'ask_ms': ms})
        traps = [e for e in q['evidence'] if e['role'] == 'trap']
        row['trap_cited'] = any(hits[c-1]['video_id'] == e['video_id'] and hits[c-1]['seq'] in e['seqs'] for c in (a.get('cites') or []) if c <= len(hits) for e in traps)
    if row['answerable']:
        if weak or row.get('declined'): row['grade'] = '답 안 함'
        else:
            g = grade(q['question'], q['expected_answer'], row['answer']); row['grade'] = g['grade']; row['why'] = g['why']
    else:
        row['grade'] = '맞게 거절' if (weak or row.get('declined')) else '답을 지어냄'
    rows.append(row)
    print(f"{q['id']:4} {q['kind']:9} {row['grade']}{' · 함정 인용' if row.get('trap_cited') else ''} · {(row.get('answer') or '')[:70]}")
from collections import Counter
c = Counter(r['grade'] for r in rows)
summary = {'split': split, 'base': BASE, 'grades': dict(c), 'trap_cited': sum(1 for r in rows if r.get('trap_cited')),
           'median_ask_ms': sorted(r['ask_ms'] for r in rows if 'ask_ms' in r)[len([r for r in rows if 'ask_ms' in r]) // 2] if any('ask_ms' in r for r in rows) else None}
print(json.dumps(summary, ensure_ascii=False))
out = f"evals/search/runs/{time.strftime('%Y-%m-%dT%H-%M-%S')}-ask-{split}.json"
json.dump({'summary': summary, 'rows': rows}, open(out, 'w'), ensure_ascii=False, indent=1); print('저장:', out)

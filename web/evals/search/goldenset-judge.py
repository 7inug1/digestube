"""C 방식: 검색된 상위 3개 문단을 Gemini 에게 보여 주고 "질문에 답이 되나"를 판정하게 한다.

    python3 evals/search/goldenset-judge.py <runs/...-goldenset-dev.json>

저장한 검색 결과를 그대로 쓴다(새로 검색하지 않음). 프롬프트는 실행 전에 고정했다.
모델은 전사에 쓰는 gemini-3.8-flash, 생각 단계 low(판정에 깊은 추론이 필요 없고 검색 지연을 줄이려고).
"""
import json, sys, time, urllib.request

env = {}
for l in open('.env.local'):
    if '=' in l and not l.startswith('#'):
        k, v = l.strip().split('=', 1); env[k] = v.strip('"')
KEY = env['GEMINI_API_KEY'].strip()
MODEL = 'gemini-3.8-flash'

PROMPT = """아래는 사용자의 질문과, 사용자가 저장한 영상들의 전사문에서 찾은 문단 3개다.
이 문단들만 근거로 질문에 답할 수 있는지 판단한다.

규칙
- 문단에 질문이 묻는 내용이 직접 들어 있거나, 여러 문단을 합치면 답이 될 때만 answerable 을 true 로 한다.
- 주제만 비슷하고 질문이 묻는 내용이 없으면 false 다. 그럴듯하게 이어 붙여 답을 지어내지 않는다.
- "어느 영상이었지", "누구였지"처럼 찾는 대상을 묻는 질문은, 설명에 맞는 대목이 문단에 있으면 true 다.
- used 에는 답에 실제로 쓰이는 문단 번호만 적는다. 관련만 있고 답이 아닌 문단은 넣지 않는다.
- JSON 하나만 출력한다.

{"answerable": true, "used": [1], "why": "판단 이유 한 문장"}

질문: {q}

{passages}"""

snap = json.load(open(json.load(open('data/evals/search/questions.v3.json'))['corpus_snapshot']['path']))
TITLE = {v['video']['id']: v['video']['title'] for v in snap['corpus']}

def judge(q, hits):
    passages = '\n\n'.join(f"[{i+1}] 영상: {TITLE.get(h['video_id'], h['video_id'])}\n{h['text']}" for i, h in enumerate(hits[:3]))
    body = {"contents": [{"parts": [{"text": PROMPT.replace('{q}', q).replace('{passages}', passages)}]}],
            "generationConfig": {"responseMimeType": "application/json", "temperature": 0, "maxOutputTokens": 2048,
                                 "thinkingConfig": {"thinkingLevel": "low"}}}
    t0 = time.time()
    req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
    r = json.load(urllib.request.urlopen(req, timeout=60))
    ms = int((time.time() - t0) * 1000)
    txt = ''.join(p.get('text', '') for p in r['candidates'][0]['content']['parts'])
    return json.loads(txt), r['usageMetadata'], ms

path = sys.argv[1]
d = json.load(open(path))
gold = {q['id']: q for q in json.load(open('data/evals/search/questions.v3.json'))['questions']}
out, cost = [], 0.0
for r in d['rows']:
    v, u, ms = judge(r['question'], r['hits'])
    inp = u['promptTokenCount']; outp = u['totalTokenCount'] - inp
    cost += inp * 0.75 / 1e6 + outp * 3.75 / 1e6
    ok = v['answerable'] == r['answerable']
    # 함정 문단(관련은 있지만 근거 아님)을 답에 쓰겠다고 했는지
    traps = [e for e in gold[r['id']]['evidence'] if e['role'] == 'trap']
    used_trap = any(r['hits'][i-1]['video_id'] == e['video_id'] and r['hits'][i-1]['seq'] in e['seqs']
                    for i in v.get('used', []) if 0 < i <= len(r['hits']) for e in traps)
    out.append({**{k: r[k] for k in ('id', 'kind', 'answerable', 'found', 'required', 'top')}, 'c': v, 'c_correct': ok,
                'used_trap': used_trap, 'ms': ms, 'tokens': [inp, outp]})
    print(f"{r['id']:4} {r['kind']:9} 정답 {'있음' if r['answerable'] else '없음'} · 근거 {r['found']}/{r['required']} · C {'답됨' if v['answerable'] else '안 됨'} {'맞음' if ok else '틀림'} · {ms}ms · {v.get('why','')[:60]}")
n = len(out)
summary = {'method_C': {'model': MODEL, 'thinking': 'low', 'correct': f"{sum(o['c_correct'] for o in out)}/{n}",
           'answerable_kept': f"{sum(o['c_correct'] for o in out if o['answerable'])}/{sum(o['answerable'] for o in out)}",
           'no_answer_rejected': f"{sum(o['c_correct'] for o in out if not o['answerable'])}/{sum(not o['answerable'] for o in out)}",
           'trap_used': sum(o['used_trap'] for o in out),
           'median_ms': sorted(o['ms'] for o in out)[n // 2], 'cost_usd_total': round(cost, 4)}}
print(json.dumps(summary, ensure_ascii=False, indent=2))
json.dump({'source': path, 'prompt': PROMPT, **summary, 'rows': out}, open(path.replace('.json', '-judge.json'), 'w'), ensure_ascii=False, indent=2)

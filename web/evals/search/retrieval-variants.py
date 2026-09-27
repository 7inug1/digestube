"""검색 개선 실험 — 운영과 같은 모델(KURE-v1 → ko-reranker)로, 문단 글만 바꿔 네 가지를 비교한다.

    python3 evals/search/retrieval-variants.py dev

  base : 지금과 같은 원문
  T    : 영어 영상 문단은 한국어 번역문으로 검색·리랭킹 (화면에는 원문을 보여 준다는 전제)
  C    : 문단 앞에 문맥 한 줄 — "영상 제목 · 채널 · 영상 요지 · 이 대목의 목차 제목" (Anthropic Contextual Retrieval 의 간소판,
         LLM 으로 문맥을 새로 쓰지 않고 이미 있는 제목·요약·목차를 쓴다)
  TC   : T + C
  TC/T : 찾기(임베딩)는 TC, 순서 매기기(리랭커)는 T — 문맥 줄은 후보를 찾는 데만 쓰고,
         리랭커 점수(= 커트라인 판단)에는 섞지 않는다. C·TC 에서 문맥 줄이 답 없는 질문의 점수까지 올린 것을 보고 추가

운영 DB 는 읽기만 한다. 번역·메타데이터는 runs/ 아래에 캐시해 같은 입력으로 다시 돌릴 수 있게 한다.
"""
import json, os, sys, time, urllib.request, math

split = sys.argv[1]
env = {}
for l in open('.env.local'):
    if '=' in l and not l.startswith('#'):
        k, v = l.strip().split('=', 1); env[k] = v.strip('"')
HF = env['HF_TOKEN'].strip(); GK = env['GEMINI_API_KEY'].strip()
SB = {'apikey': env['SUPABASE_SERVICE_ROLE_KEY'], 'Authorization': 'Bearer ' + env['SUPABASE_SERVICE_ROLE_KEY']}
gold = json.load(open('data/evals/search/questions.v3.json'))
snap = json.load(open(gold['corpus_snapshot']['path']))
EN = {'-Z11mZaJU0w', '3KtrlNyd1ec'}
CACHE = 'evals/search/runs/retrieval-variants-cache.json'
cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}

def post(url, body, headers, timeout=120):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **headers})
    for i in range(4):
        try:
            return json.load(urllib.request.urlopen(req, timeout=timeout))
        except Exception as e:
            if i == 3: raise
            time.sleep(5 * (i + 1))

# 메타데이터(채널·요지·목차) — 읽기만
if 'meta' not in cache:
    cache['meta'] = {}
    for v in snap['corpus']:
        vid = v['video']['id']
        row = json.load(urllib.request.urlopen(urllib.request.Request(env['SUPABASE_URL'] + f"/rest/v1/video?select=channel,tldr&id=eq.{vid}", headers=SB)))[0]
        ol = json.load(urllib.request.urlopen(urllib.request.Request(env['SUPABASE_URL'] + f"/rest/v1/outline?select=seq,label&video_id=eq.{vid}&order=seq", headers=SB)))
        cache['meta'][vid] = {'title': v['video']['title'], 'channel': row['channel'], 'tldr': row['tldr'] or [], 'outline': ol}

# 영어 문단 번역 — 영상마다 한 번, 문단 수를 지키게 한다
if 'tr' not in cache:
    cache['tr'] = {}
    for v in snap['corpus']:
        vid = v['video']['id']
        if vid not in EN: continue
        paras = [c['text'] for c in v['chunks']]
        prompt = ('아래 영어 전사 문단들을 자연스러운 한국어로 옮긴다. 요약하거나 빼지 않는다. 문단 수와 순서를 그대로 지킨다.\n'
                  'JSON 하나만 출력한다: {"ko": ["문단1 번역", ...]}\n\n' + json.dumps(paras, ensure_ascii=False))
        r = post('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
                 {'contents': [{'parts': [{'text': prompt}]}], 'generationConfig': {'responseMimeType': 'application/json', 'temperature': 0, 'maxOutputTokens': 16384}},
                 {'x-goog-api-key': GK})
        ko = json.loads(''.join(p.get('text', '') for p in r['candidates'][0]['content']['parts']))['ko']
        assert len(ko) == len(paras), (vid, len(ko), len(paras))
        cache['tr'][vid] = ko
json.dump(cache, open(CACHE, 'w'), ensure_ascii=False, indent=1)

def context(vid, seq):
    m = cache['meta'][vid]
    sec = [o['label'] for o in m['outline'] if o['seq'] <= seq]
    parts = [f"영상: {m['title']}", f"채널: {m['channel']}"]
    if m['tldr']: parts.append(f"요지: {m['tldr'][0]}")
    if sec: parts.append(f"이 대목: {sec[-1]}")
    return ' · '.join(parts)

P = []  # (vid, seq, base, T)
for v in snap['corpus']:
    vid = v['video']['id']
    for i, c in enumerate(v['chunks']):
        P.append({'vid': vid, 'seq': c['seq'], 'base': c['text'], 'T': cache['tr'][vid][i] if vid in EN else c['text']})
for p in P:
    p['C'] = context(p['vid'], p['seq']) + '\n' + p['base']
    p['TC'] = context(p['vid'], p['seq']) + '\n' + p['T']

def embed(texts):
    out = []
    for i in range(0, len(texts), 16):
        out += post('https://router.huggingface.co/hf-inference/models/nlpai-lab/KURE-v1/pipeline/feature-extraction',
                    {'inputs': texts[i:i+16], 'normalize': True}, {'Authorization': f'Bearer {HF}'})
    return out

def rerank(q, texts):
    r = post('https://router.huggingface.co/hf-inference/models/Dongjin-kr/ko-reranker',
             {'inputs': [{'text': q, 'text_pair': t} for t in texts], 'parameters': {'function_to_apply': 'none', 'top_k': None, 'truncation': True}},
             {'Authorization': f'Bearer {HF}'})
    return [x[0]['score'] if isinstance(x, list) else x['score'] for x in r]

qs = [q for q in gold['questions'] if q['split'] == split]
qv = embed([q['question'] for q in qs])
report = {}
for var in ['base', 'T', 'C', 'TC', 'TC/T']:
    ev, rv = (var.split('/') + [var])[:2] if '/' in var else (var, var)
    pv = embed([p[ev] for p in P])
    rows = []
    for q, v in zip(qs, qv):
        sims = sorted(((sum(a * b for a, b in zip(v, e)), i) for i, e in enumerate(pv)), reverse=True)[:10]
        pool = [P[i] for _, i in sims]
        sc = rerank(q['question'], [p[rv] for p in pool])
        top = sorted(zip(sc, range(len(pool))), reverse=True)[:3]
        hits = [{'video_id': pool[i]['vid'], 'seq': pool[i]['seq'], 'rerank_score': round(s, 3), 'text': pool[i][rv]} for s, i in top]
        req = [e for e in q['evidence'] if e['role'] == 'required']
        found = sum(1 for e in req if any(h['video_id'] == e['video_id'] and h['seq'] in e['seqs'] for h in hits))
        rows.append({'id': q['id'], 'kind': q['kind'], 'answerable': q['category'] == 'answerable', 'question': q['question'],
                     'required': len(req), 'found': found, 'top': hits[0]['rerank_score'], 'hits': hits})
    ans = [r for r in rows if r['answerable']]
    en_req = [(r, e) for r in ans for e in next(q for q in qs if q['id'] == r['id'])['evidence'] if e['role'] == 'required' and e['video_id'] in EN]
    en_found = sum(1 for r, e in en_req if any(h['video_id'] == e['video_id'] and h['seq'] in e['seqs'] for h in r['hits']))
    report[var] = {'found': f"{sum(r['found'] for r in ans)}/{sum(r['required'] for r in ans)}", 'english_found': f"{en_found}/{len(en_req)}",
                   'tops': {r['id']: r['top'] for r in rows}, 'rows': rows}
    print(f"{var:4} 근거 {report[var]['found']} · 영어 영상 근거 {report[var]['english_found']} · 1위 점수 " +
          ' '.join(f"{r['id']}:{r['top']:.1f}{'' if r['answerable'] else '(없음)'}" for r in rows))
out = f"evals/search/runs/{time.strftime('%Y-%m-%dT%H-%M-%S')}-retrieval-variants-{split}.json"
json.dump(report, open(out, 'w'), ensure_ascii=False, indent=1)
print('저장:', out)

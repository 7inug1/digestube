/** 문장을 숫자로 바꾼다 — KURE-v1.
 *
 *  넣을 때(문단)와 찾을 때(질문)가 같은 모델이어야 비교가 된다. 그래서 이 파일
 *  하나만 쓰고, 모델을 바꿀 일이 생기면 여기만 고친 뒤 저장된 벡터를 다시 만든다.
 *
 *  고른 근거
 *    한국어 검색 성능(MTEB-KR)으로 골랐다. 원래 BGE-M3 였는데 부르던 곳이
 *    모델을 내려(410) 못 쓰게 됐고, BGE-M3 를 한국어로 더 학습시킨 KURE-v1 이
 *    HuggingFace 에 있는 것을 확인해 갈아탔다. 차원이 1024 로 같아 저장 구조는
 *    그대로였다.
 *
 *  ⚠️ 이 자리는 우리 데이터로 재지 않았다. 순위표로 고른 유일한 자리다.
 *     골든셋이 생기면 여기부터 다시 잰다.
 *
 *  속도
 *    뜸하면 모델이 잠든다. 첫 호출 약 4.5초, 이후 0.3~0.5초.
 */
export const MODEL = "nlpai-lab/KURE-v1";
export const DIM = 1024;

const URL = `https://router.huggingface.co/hf-inference/models/${MODEL}/pipeline/feature-extraction`;
const BATCH = 32;   // 한 번에 보낼 문장 수. 너무 크면 요청이 오래 걸린다

function token(): string {
  const t = process.env.HF_TOKEN;
  if (!t) throw new Error("HF_TOKEN 이 없다");
  return t.trim();
}

async function call(texts: string[], retry = 2): Promise<number[][]> {
  const tok = token();
  for (let i = 0; i <= retry; i++) {
    const r = await fetch(URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "content-type": "application/json" },
      body: JSON.stringify({ inputs: texts, normalize: true }),
    });

    if (r.ok) {
      const d = await r.json();
      // 한 문장만 보내도 목록의 목록으로 오게 맞춘다
      const out: number[][] = Array.isArray(d[0]) ? d : [d];
      // 차원이 다르면 조용히 넘어가면 안 된다 — 검색이 이유 없이 0건이 된다
      if (out.some((v) => v.length !== DIM)) {
        throw new Error(`임베딩 차원이 ${out[0]?.length} 다 (${DIM} 이어야 함)`);
      }
      return out;
    }

    // 503 은 모델을 깨우는 중이라는 뜻이다. 기다렸다 다시 부른다.
    const body = (await r.text()).slice(0, 200).replaceAll(tok, "***");
    if ([429, 500, 503].includes(r.status) && i < retry) {
      await new Promise((s) => setTimeout(s, 6000 * (i + 1)));
      continue;
    }
    throw new Error(`임베딩 ${r.status}: ${body}`);
  }
  throw new Error("도달 불가");
}

/** 여러 문장을 한 번에. 묶어 보내는 편이 개당 시간이 짧다. */
export async function embed(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    out.push(...(await call(texts.slice(i, i + BATCH))));
  }
  return out;
}

export const embedOne = async (text: string) => (await embed([text]))[0];

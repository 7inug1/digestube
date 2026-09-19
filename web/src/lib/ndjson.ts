import { saySorry } from "./errors";

/** 한 줄에 JSON 하나씩(NDJSON) 흘려보내는 응답.
 *  SSE 는 형식이 더 있지만 서버 → 화면 한쪽으로만 보내면 되니 줄바꿈이면 충분하다.
 *  등록(받아쓰는 문장)과 검색(먼저 결과, 다듬은 순서)이 같이 쓴다. */
export function ndjson(context: string, run: (send: (o: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(JSON.stringify(o) + "\n"));
      try { await run(send); }
      catch (e) { send({ t: "error", error: saySorry(e, context) }); }
      finally { controller.close(); }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      // 중간 서버가 모아서 한 번에 보내면 흘려보내는 의미가 없어진다
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

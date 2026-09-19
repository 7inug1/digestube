/** 영상 등록이 실패했을 때 남기는 한 줄.
 *
 *  예전에는 status 가 '실패'로만 바뀌었다. 비공개 영상인지, 모델이 붐볐는지, 서버가
 *  시간을 넘겼는지 구분이 안 돼서 고칠 곳도, 사용자에게 할 말도 정할 수 없었다.
 *  성공할 때는 아무것도 남기지 않는다 — 실패한 순간에만 영상 행 옆에 한 칸을 채운다. */

export type FailureStage = "transcribe" | "save" | "save_slice" | "spend_quota" | "supadata_start" | "supadata_poll";
export type FailureKind = "timeout" | "overloaded" | "quota" | "http" | "network" | "error";
export type Failure = { stage: FailureStage; kind: FailureKind; status: number | null; message: string; at: string };

/** 오류 문장에 섞여 들어올 수 있는 키·토큰을 가린다. 원문을 그대로 DB 에 넣지 않는다. */
export function redact(s: string): string {
  return s
    .replace(/([?&](?:key|api_key|token)=)[^&\s"']+/gi, "$1***")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/g, "Bearer ***")
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, "***")
    .replace(/\b(?:hf|sk|sb)_[A-Za-z0-9_\-]{10,}/g, "***")
    .replace(/eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]*/g, "***");
}

export function describe(e: unknown, stage: FailureStage, now = new Date()): Failure {
  const err = e as {name?: string; message?: string};
  const message = redact(String(err?.message ?? e ?? "")).slice(0, 200);
  const status = Number(/\b([45]\d\d)\b/.exec(message)?.[1] ?? NaN);
  const kind: FailureKind =
    err?.name === "TimeoutError" || err?.name === "OutOfTime" || /timeout|시간.*(초과|부족)/i.test(message) ? "timeout"
    : status === 503 || status === 429 || /붐벼|overload|high demand/i.test(message) ? "overloaded"
    : /quota|한도/i.test(message) ? "quota"
    : Number.isFinite(status) ? "http"
    : /fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network/i.test(message) ? "network"
    : "error";
  return { stage, kind, status: Number.isFinite(status) ? status : null, message, at: now.toISOString() };
}

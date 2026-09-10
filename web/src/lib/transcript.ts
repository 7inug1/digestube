import { chunk } from "./chunker";
import type { Result } from "./supadata";

/** Refuse unusable input before any transcript replacement. */
export function prepareTranscript(result: Result, requestedLang: string | null) {
  if (requestedLang && result.lang?.toLowerCase() !== requestedLang.toLowerCase()) {
    throw new Error(`요청한 ${requestedLang} 자막을 받지 못했습니다. 받은 언어: ${result.lang ?? "미확인"}`);
  }
  if (!Array.isArray(result.content) || !result.content.length) {
    throw new Error("시간 정보가 있는 자막을 가져오지 못했습니다. 기존 내용은 유지됩니다.");
  }
  if (result.content.some(p => typeof p.text !== "string" || !Number.isFinite(p.offset) ||
      !Number.isFinite(p.duration) || p.offset < 0 || p.duration < 0)) {
    throw new Error("자막 형식이나 시간 정보가 올바르지 않습니다.");
  }
  const pieces = result.content.filter(p => p.text.trim());
  if (pieces.some((p, i) => i > 0 && p.offset < pieces[i-1].offset)) throw new Error("자막의 시간 순서가 올바르지 않습니다.");
  const chunks = chunk(pieces);
  if (!chunks.length) throw new Error("자막이 비어 있습니다. 기존 내용은 유지됩니다.");
  return {chunks, pieces:pieces.length, chars:pieces.map(p=>p.text.trim()).join(" ").length};
}

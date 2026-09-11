import {db} from "./supabase";
import type {Result} from "./supadata";

/** Keep the provider's original caption timing for future repairs.
 * This private bucket must exist before deployment (web/README.md).
 */
export async function saveTranscriptSource(vid:string,revision:string,result:Result,requestedLang:string|null) {
  const {error}=await db().storage.from("transcript-sources").upload(`${vid}/${revision}.json`,
    JSON.stringify({video_id:vid,revision,requested_lang:requestedLang,captured_at:new Date().toISOString(),result}),
    {contentType:"application/json",upsert:false});
  if(error)throw new Error("원본 자막 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.");
}

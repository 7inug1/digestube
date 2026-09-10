import { createClient } from "@supabase/supabase-js";

/** 서버에서만 쓴다. service_role 키는 행 수준 보안을 통과하므로
    브라우저로 절대 내보내지 않는다. */
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없다 (.env.local)");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

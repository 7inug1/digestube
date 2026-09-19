-- 영상 등록이 실패했을 때 무엇이 어디서 실패했는지 남긴다.
-- 예전에는 status='실패' 만 남아 원인을 알 수 없었다(uxoCnxlxpIk, 2026-09-17).
-- {stage, kind, status, message, at}. message 는 앱이 키·토큰을 가린 뒤 200자로 자른다.
-- 성공하면 앱이 null 로 되돌린다. 성공한 등록에는 아무것도 남기지 않는다.
alter table public.video add column if not exists last_failure jsonb;
notify pgrst, 'reload schema';

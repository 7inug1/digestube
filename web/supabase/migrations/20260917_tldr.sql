-- 세 줄 요약. 목차와 같은 모델 호출에서 받으므로 따로 값이 들지 않는다.
alter table public.video add column if not exists tldr jsonb;

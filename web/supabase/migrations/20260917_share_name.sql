-- 공유 화면에 띄울 이름. 선택이다.
-- 이메일을 대신 쓰지 않는다 — 본인이 정한 적 없는 정보를 공개 페이지에 올리는 셈이 된다.
alter table public.library_share add column if not exists name text;

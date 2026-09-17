-- 라이브러리 공유. 행이 있으면 공유 중, 지우면 꺼진다.
-- 사용자 아이디를 주소에 쓰지 않는다 — 주소가 곧 계정 식별자가 되면 끄고 켤 수가 없다.
-- share_id 를 새로 뽑으면 예전 링크는 죽는다.
create table if not exists public.library_share (
  user_id uuid primary key,
  share_id text unique not null,
  created_at timestamptz not null default now()
);
alter table public.library_share enable row level security;

-- 익명 사용 상한. IP 와 날짜(한국 기준)로 그날 넣은 영상 길이(초)를 합산한다.
-- 편수가 아니라 초로 센다 — 비용은 길이에 비례한다.
create table if not exists public.quota (
  key text not null,
  day date not null,
  n int not null default 0,
  primary key (key, day)
);
alter table public.quota enable row level security;

-- 이 영상 길이만큼 썼다고 적는다. 행이 없으면 만든다.
create or replace function public.quota_use(p_key text, p_day date, p_seconds int)
returns void language sql security definer as $$
  insert into public.quota (key, day, n) values (p_key, p_day, p_seconds)
  on conflict (key, day) do update set n = quota.n + p_seconds;
$$;

-- Digestube 저장소 스키마
-- Supabase SQL Editor 에 그대로 붙여넣어 실행한다.
--
-- 벡터 전용 DB 대신 Postgres + pgvector 를 쓰는 이유:
-- 문단 텍스트·시각과 벡터가 같은 행에 있어야 검색 결과에 내용을 붙이는
-- 조회가 한 번에 끝난다. 저장소가 둘로 나뉘면 앱이 두 번 물어봐야 한다.

create extension if not exists vector;

create table if not exists video (
  id          text primary key,          -- 유튜브 영상 번호(11자)
  title       text,
  channel     text,
  lang        text,
  status      text not null default '전사중',   -- 전사중 · 문단완료 · 완료 · 실패
  job         text,                      -- Supadata 작업 번호(전사 중일 때만)
  pieces      int,                       -- 전사 조각 수
  chars       int,                       -- 전사 글자 수
  -- 전사 원본 조각 [{text, offset, duration}]. 문단 나누는 방식을 바꿔도
  -- 다시 전사하지 않고 나눌 수 있어야 한다 — 전사는 크레딧이 드는 일이다.
  raw         jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists chunk (
  id          text primary key,          -- "{video_id}:{seq}"
  video_id    text not null references video(id) on delete cascade,
  seq         int  not null,
  t           real not null,             -- 시작 시각(초)
  t_end       real not null,
  text        text not null,
  -- KURE-v1 · 1024차원. 모델을 바꿔도 차원이 같으면 이 자리는 그대로다.
  embedding   vector(1024),
  unique (video_id, seq)
);

create table if not exists outline (
  id          bigserial primary key,
  video_id    text not null references video(id) on delete cascade,
  seq         int  not null,             -- 근거가 된 문단
  t           real not null,
  label       text not null,             -- 목차 제목
  quote       text not null,             -- 그 제목이 기댄 원문 문장
  unique (video_id, seq)
);

create table if not exists bookmark (
  id          bigserial primary key,
  user_id     uuid not null,
  chunk_id    text not null references chunk(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (user_id, chunk_id)
);

create index if not exists chunk_video_idx on chunk (video_id, seq);

-- 색인은 아직 만들지 않는다. 문단이 몇 개부터 필요한지 재지 않았고,
-- 지금 규모에서는 전수 비교가 더 빠르다. 갈리는 지점을 잰 뒤에 만든다.
--   create index on chunk using hnsw (embedding vector_cosine_ops);

-- 질문 벡터와 가까운 문단을 찾는다. 앱이 SQL 을 조립하지 않도록 함수로 둔다.
create or replace function search_chunks(
  q vector(1024),
  k int default 5,
  only_video text default null,
  only_videos text[] default null
)
returns table (
  video_id text, seq int, t real, t_end real, text text, score real
)
language sql stable as $$
  select c.video_id, c.seq, c.t, c.t_end, c.text,
         (1 - (c.embedding <=> q))::real as score
  from chunk c
  where c.embedding is not null
    and (only_video is null or c.video_id = only_video)
    and (only_videos is null or c.video_id = any(only_videos))
  order by c.embedding <=> q
  limit k
$$;

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

-- 라이브러리는 "누가 담았나"다. 영상 자체와 분리한다 —
-- 한 영상을 여러 사람이 담아도 변환은 한 번이면 되고, 내가 목록에서 빼도
-- 다른 사람 목록에서 사라지면 안 된다.
create table if not exists public.library (
  user_id uuid not null,
  video_id text not null references public.video(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);
create index if not exists library_user_idx on public.library (user_id, created_at desc);
alter table public.library enable row level security;

-- 라이브러리 공유. 행이 있으면 공유 중, 지우면 꺼진다.
-- 사용자 아이디를 주소에 쓰지 않는다 — 주소가 곧 계정 식별자가 되면 끄고 켤 수가 없다.
-- share_id 를 새로 뽑으면 예전 링크는 죽는다.
create table if not exists public.library_share (
  user_id uuid primary key,
  share_id text unique not null,
  created_at timestamptz not null default now()
);
alter table public.library_share enable row level security;

-- 세 줄 요약. 목차와 같은 모델 호출에서 받으므로 따로 값이 들지 않는다.
alter table public.video add column if not exists tldr jsonb;

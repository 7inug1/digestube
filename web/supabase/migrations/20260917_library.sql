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

-- 검색을 내 라이브러리 안으로 좁힌다. 기존 only_video(한 편) 는 그대로 두고
-- 목록(only_videos) 을 더한다 — 읽기 화면의 "이 영상에서 찾기"가 전자를 쓴다.
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

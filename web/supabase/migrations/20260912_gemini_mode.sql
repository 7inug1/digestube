-- 2번 자리(전사) 를 Gemini 로 바꾸면서 mode 값이 하나 늘어난다.
-- 기존 행의 'native'/'generate' 는 그대로 둔다.
alter table public.video drop constraint if exists video_mode_check;
alter table public.video add constraint video_mode_check
  check (mode is null or mode in ('native', 'generate', 'gemini'));

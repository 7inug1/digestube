-- 전사 원본 조각을 남긴다.
--
-- 문단 나누는 방식을 바꿀 때마다 다시 전사하면 크레딧이 든다. 원본에는
-- 조각별 시각(offset·duration)이 있어야 한다 — 구두점이 없는 전사에서는
-- 조각 사이의 침묵이 유일한 문장 경계 신호다.

alter table public.video add column if not exists raw jsonb;

-- finish_ingest 가 원본도 같이 저장하게 한다. 나머지는 그대로.
create or replace function public.finish_ingest(p_vid text, p_token text, p_meta jsonb, p_chunks jsonb)
returns boolean language plpgsql set search_path = public, extensions as $$
declare v public.video%rowtype;
begin
  select * into v from video where id=p_vid for update;
  if not found or v.ingest_token is distinct from p_token then return false; end if;
  if jsonb_array_length(p_chunks)=0 then raise exception 'Empty transcript'; end if;
  delete from outline where video_id=p_vid;
  delete from chunk where video_id=p_vid;
  insert into chunk(id,video_id,seq,t,t_end,text)
    select p_vid||':'||(ord-1),p_vid,(ord-1)::int,(c->>'t')::real,(c->>'t_end')::real,c->>'text'
    from jsonb_array_elements(p_chunks) with ordinality as x(c,ord);
  update video set title=p_meta->>'title', channel=p_meta->>'channel', lang=p_meta->>'lang',
    pieces=(p_meta->>'pieces')::int, chars=(p_meta->>'chars')::int,
    raw=coalesce(p_meta->'raw', v.raw),
    mode=v.pending_mode, requested_lang=v.pending_lang, transcribed_at=now(), revision=p_token,
    status='문단완료', job=null, ingest_token=null, ingest_started_at=null, pending_mode=null, pending_lang=null
    where id=p_vid;
  return true;
end $$;

-- 저장된 원본으로 문단만 다시 나눈다. 전사를 다시 하지 않으므로 크레딧이 안 든다.
-- 문단이 바뀌면 목차·벡터는 무효라 같이 지우고 revision 을 새로 준다.
create or replace function public.rechunk(p_vid text, p_revision text, p_chunks jsonb)
returns boolean language plpgsql set search_path = public, extensions as $$
begin
  if jsonb_array_length(p_chunks)=0 then raise exception 'Empty chunks'; end if;
  perform 1 from video where id=p_vid for update;
  if not found then return false; end if;
  delete from outline where video_id=p_vid;
  delete from chunk where video_id=p_vid;
  insert into chunk(id,video_id,seq,t,t_end,text)
    select p_vid||':'||(ord-1),p_vid,(ord-1)::int,(c->>'t')::real,(c->>'t_end')::real,c->>'text'
    from jsonb_array_elements(p_chunks) with ordinality as x(c,ord);
  update video set revision=p_revision, status='문단완료' where id=p_vid;
  return true;
end $$;

revoke all on function public.rechunk(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.rechunk(text,text,jsonb) to service_role;

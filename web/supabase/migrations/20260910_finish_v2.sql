-- Apply after schema.sql. Existing mode stays NULL because its origin is unknown.
begin;
alter table public.video add column if not exists mode text check (mode in ('native', 'generate'));
alter table public.video add column if not exists requested_lang text;
alter table public.video add column if not exists transcribed_at timestamptz;
alter table public.video add column if not exists revision text;
alter table public.video add column if not exists ingest_token text;
alter table public.video add column if not exists ingest_started_at timestamptz;
alter table public.video add column if not exists pending_mode text;
alter table public.video add column if not exists pending_lang text;
alter table public.outline add column if not exists source text not null default 'model';
alter table public.outline add column if not exists attempts int;
alter table public.outline add column if not exists failure text;

-- One active ingest per video across serverless instances. Old content stays readable.
create or replace function public.begin_ingest(p_vid text, p_replace boolean, p_token text, p_mode text, p_lang text)
returns text language plpgsql set search_path = public, extensions as $$
declare v public.video%rowtype;
begin
  perform pg_advisory_xact_lock(hashtext(p_vid));
  select * into v from video where id=p_vid for update;
  if found then
    if v.ingest_token is not null and v.ingest_started_at > now() - interval '15 minutes' then return 'busy'; end if;
    if not p_replace then return 'exists'; end if;
  end if;
  insert into video(id, status, ingest_token, ingest_started_at, pending_mode, pending_lang)
    values(p_vid, '전사중', p_token, now(), p_mode, p_lang)
    on conflict(id) do update set ingest_token=p_token, ingest_started_at=now(), pending_mode=p_mode, pending_lang=p_lang, job=null;
  return 'started';
end $$;

create or replace function public.set_ingest_job(p_vid text, p_token text, p_job text)
returns boolean language plpgsql set search_path = public, extensions as $$
begin
  update video set job=p_job where id=p_vid and ingest_token=p_token;
  return found;
end $$;

create or replace function public.cancel_ingest(p_vid text, p_token text)
returns void language plpgsql set search_path = public, extensions as $$
begin
  update video set ingest_token=null, ingest_started_at=null, pending_mode=null, pending_lang=null, job=null,
    status=case when exists(select 1 from chunk where video_id=p_vid) then status else '실패' end
    where id=p_vid and ingest_token=p_token;
end $$;

-- Entire replacement is a transaction; a failed insert cannot erase the old transcript.
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
    mode=v.pending_mode, requested_lang=v.pending_lang, transcribed_at=now(), revision=p_token,
    status='문단완료', job=null, ingest_token=null, ingest_started_at=null, pending_mode=null, pending_lang=null
    where id=p_vid;
  return true;
end $$;

-- A late model response must not write results for a replaced transcript.
create or replace function public.save_outline_batch(p_vid text, p_revision text, p_items jsonb)
returns boolean language plpgsql set search_path = public, extensions as $$
declare v public.video%rowtype;
begin
  select * into v from video where id=p_vid for update;
  if not found or v.revision is distinct from p_revision then return false; end if;
  insert into outline(video_id,seq,t,label,quote,source,attempts,failure)
    select p_vid,(o->>'seq')::int,(o->>'t')::real,o->>'label',o->>'quote',o->>'source',(o->>'attempts')::int,o->>'failure'
    from jsonb_array_elements(p_items) as x(o)
    on conflict(video_id,seq) do update set t=excluded.t,label=excluded.label,quote=excluded.quote,
      source=excluded.source,attempts=excluded.attempts,failure=excluded.failure;
  return true;
end $$;

create or replace function public.save_embedding_batch(p_vid text, p_revision text, p_items jsonb)
returns boolean language plpgsql set search_path = public, extensions as $$
declare v public.video%rowtype; item jsonb;
begin
  select * into v from video where id=p_vid for update;
  if not found or v.revision is distinct from p_revision then return false; end if;
  for item in select value from jsonb_array_elements(p_items) loop
    update chunk set embedding=(item->>'vector')::vector where video_id=p_vid and seq=(item->>'seq')::int;
  end loop;
  return true;
end $$;

create or replace function public.refresh_video_status(p_vid text, p_revision text)
returns boolean language plpgsql set search_path = public, extensions as $$
declare v public.video%rowtype;
begin
  select * into v from video where id=p_vid for update;
  if not found or v.revision is distinct from p_revision then return false; end if;
  update video set status=case when
    exists(select 1 from chunk where video_id=p_vid) and
    not exists(select 1 from chunk c where c.video_id=p_vid and (c.embedding is null or not exists
      (select 1 from outline o where o.video_id=c.video_id and o.seq=c.seq)))
    then '완료' else '문단완료' end where id=p_vid;
  return true;
end $$;

-- Mutations are available only to the application's server credential.
revoke all on function public.begin_ingest(text,boolean,text,text,text) from public, anon, authenticated;
revoke all on function public.set_ingest_job(text,text,text) from public, anon, authenticated;
revoke all on function public.cancel_ingest(text,text) from public, anon, authenticated;
revoke all on function public.finish_ingest(text,text,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.save_outline_batch(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.save_embedding_batch(text,text,jsonb) from public, anon, authenticated;
revoke all on function public.refresh_video_status(text,text) from public, anon, authenticated;
grant execute on function public.begin_ingest(text,boolean,text,text,text) to service_role;
grant execute on function public.set_ingest_job(text,text,text) to service_role;
grant execute on function public.cancel_ingest(text,text) to service_role;
grant execute on function public.finish_ingest(text,text,jsonb,jsonb) to service_role;
grant execute on function public.save_outline_batch(text,text,jsonb) to service_role;
grant execute on function public.save_embedding_batch(text,text,jsonb) to service_role;
grant execute on function public.refresh_video_status(text,text) to service_role;
notify pgrst, 'reload schema';
commit;

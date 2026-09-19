begin;
alter table public.video add column if not exists outline_complete boolean not null default false;
alter table public.video add column if not exists tldr jsonb;
create or replace function public.reset_outline_completion() returns trigger language plpgsql set search_path=public as $$
begin
 if new.revision is distinct from old.revision then new.outline_complete=false; new.tldr=null; end if;
 return new;
end $$;
drop trigger if exists reset_outline_completion on public.video;
create trigger reset_outline_completion before update of revision on public.video for each row execute function public.reset_outline_completion();

create or replace function public.replace_outline(p_vid text,p_revision text,p_items jsonb,p_tldr jsonb)
returns boolean language plpgsql set search_path=public,extensions as $$
declare v public.video%rowtype;
begin
 select * into v from video where id=p_vid for update;
 if not found or v.revision is distinct from p_revision then return false; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)<2 then raise exception 'Whole outline requires at least two items'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where not exists(select 1 from chunk c where c.video_id=p_vid and c.seq=(x->>'seq')::int and c.t=(x->>'t')::real)) then raise exception 'Invalid outline target'; end if;
 delete from outline where video_id=p_vid;
 insert into outline(video_id,seq,t,label,quote,source,attempts,failure)
 select p_vid,(x->>'seq')::int,(x->>'t')::real,x->>'label',x->>'quote',x->>'source',(x->>'attempts')::int,x->>'failure' from jsonb_array_elements(p_items) x;
 update video set outline_complete=true,tldr=p_tldr where id=p_vid;
 return true;
end $$;

-- Partial fallback batches accumulate; late batches cannot contaminate a completed whole outline.
create or replace function public.save_outline_batch(p_vid text,p_revision text,p_items jsonb)
returns boolean language plpgsql set search_path=public,extensions as $$
declare v public.video%rowtype;
begin
 select * into v from video where id=p_vid for update;
 if not found or v.revision is distinct from p_revision then return false; end if;
 if v.outline_complete then return true; end if;
 insert into outline(video_id,seq,t,label,quote,source,attempts,failure)
 select p_vid,(x->>'seq')::int,(x->>'t')::real,x->>'label',x->>'quote',x->>'source',(x->>'attempts')::int,x->>'failure' from jsonb_array_elements(p_items) x
 on conflict(video_id,seq) do update set t=excluded.t,label=excluded.label,quote=excluded.quote,source=excluded.source,attempts=excluded.attempts,failure=excluded.failure;
 return true;
end $$;
create or replace function public.refresh_video_status(p_vid text,p_revision text)
returns boolean language plpgsql set search_path=public,extensions as $$
declare v public.video%rowtype;
begin
 select * into v from video where id=p_vid for update;
 if not found or v.revision is distinct from p_revision then return false; end if;
 update video set status=case when exists(select 1 from chunk where video_id=p_vid)
 and not exists(select 1 from chunk where video_id=p_vid and embedding is null)
 and (v.outline_complete or not exists(select 1 from chunk c where c.video_id=p_vid and not exists(select 1 from outline o where o.video_id=c.video_id and o.seq=c.seq)))
 then '완료' else '문단완료' end where id=p_vid;
 return true;
end $$;
revoke all on function public.replace_outline(text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_outline(text,text,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;

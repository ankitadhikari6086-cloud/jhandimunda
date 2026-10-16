-- Run this ONLY if you already ran the old schema.sql
drop function if exists create_room(text,text);
create or replace function create_room(p_title text, p_name text, p_code text default null) returns game_rooms language plpgsql security definer set search_path=public as $$
declare r game_rooms; c text; a text:='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin if auth.uid() is null then raise exception 'NOT_AUTH'; end if;
 if nullif(trim(coalesce(p_code,'')),'') is not null then
  c:=upper(trim(p_code)); if c !~ '^[A-Z0-9]{4,8}$' then raise exception 'BAD_CODE'; end if;
  if exists(select 1 from game_rooms where room_code=c) then raise exception 'CODE_TAKEN'; end if;
 else
  loop c:=''; for i in 1..6 loop c:=c||substr(a,1+floor(random()*32)::int,1); end loop;
   exit when not exists(select 1 from game_rooms where room_code=c); end loop;
 end if;
 insert into game_rooms(room_code,title,host_user_id) values(c,left(coalesce(nullif(trim(p_title),''),'Langur Burja Room'),40),auth.uid()) returning * into r;
 insert into room_members(room_id,user_id,display_name) values(r.id,auth.uid(),clean_name(p_name)); return r; end $$;

revoke all on function create_room(text,text,text) from public, anon;
grant execute on function create_room(text,text,text) to authenticated;

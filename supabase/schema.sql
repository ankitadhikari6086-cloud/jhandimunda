-- Langur Burja (free play). Run in Supabase SQL Editor. No money, stakes or payouts anywhere.
create table if not exists profiles(id uuid primary key references auth.users on delete cascade,
  display_name text not null check(char_length(display_name) between 2 and 24), created_at timestamptz default now());
create table if not exists game_rooms(id uuid primary key default gen_random_uuid(), room_code text unique not null,
  title text not null default 'Langur Burja Room' check(char_length(title)<=40), host_user_id uuid not null references auth.users,
  status text not null default 'open' check(status in('open','closed')), max_members int not null default 8, created_at timestamptz default now());
create table if not exists room_members(room_id uuid references game_rooms on delete cascade, user_id uuid references auth.users on delete cascade,
  display_name text not null, joined_at timestamptz default now(), primary key(room_id,user_id));
create table if not exists game_rounds(id uuid primary key default gen_random_uuid(), room_id uuid not null references game_rooms on delete cascade,
  round_number int not null, status text not null default 'picking' check(status in('picking','rolled')), dice text[], created_at timestamptz default now());
create table if not exists round_picks(round_id uuid references game_rounds on delete cascade, user_id uuid references auth.users on delete cascade,
  room_id uuid not null references game_rooms on delete cascade,
  symbol text not null check(symbol in('flag','crown','heart','spade','diamond','club')), primary key(round_id,user_id));

create or replace function is_member(rid uuid) returns boolean language sql security definer set search_path=public stable
as $$ select exists(select 1 from room_members where room_id=rid and user_id=auth.uid()) $$;

alter table profiles enable row level security; alter table game_rooms enable row level security;
alter table room_members enable row level security; alter table game_rounds enable row level security; alter table round_picks enable row level security;
create policy p_own_sel on profiles for select using(id=auth.uid());
create policy p_own_ins on profiles for insert with check(id=auth.uid());
create policy p_own_upd on profiles for update using(id=auth.uid());
create policy r_sel on game_rooms for select using(is_member(id));
create policy m_sel on room_members for select using(is_member(room_id));
create policy g_sel on game_rounds for select using(is_member(room_id));
create policy k_sel on round_picks for select using(is_member(room_id));
-- No insert/update/delete policies on rooms/members/rounds/picks: all writes go through the functions below.

create or replace function clean_name(n text) returns text language plpgsql as $$
begin n:=regexp_replace(trim(coalesce(n,'')),'\s+',' ','g');
 if n !~ '^[[:alnum:] _.-]{2,24}$' then raise exception 'BAD_NAME'; end if; return n; end $$;

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

create or replace function join_room(p_code text, p_name text) returns game_rooms language plpgsql security definer set search_path=public as $$
declare r game_rooms; begin if auth.uid() is null then raise exception 'NOT_AUTH'; end if;
 select * into r from game_rooms where room_code=upper(trim(p_code)); if not found then raise exception 'ROOM_NOT_FOUND'; end if;
 if r.status<>'open' then raise exception 'ROOM_CLOSED'; end if;
 if not is_member(r.id) and (select count(*) from room_members where room_id=r.id)>=r.max_members then raise exception 'ROOM_FULL'; end if;
 insert into room_members(room_id,user_id,display_name) values(r.id,auth.uid(),clean_name(p_name))
  on conflict(room_id,user_id) do update set display_name=excluded.display_name; return r; end $$;

create or replace function leave_room(p_room uuid) returns void language plpgsql security definer set search_path=public as $$
declare nh uuid; begin delete from room_members where room_id=p_room and user_id=auth.uid();
 if exists(select 1 from game_rooms where id=p_room and host_user_id=auth.uid()) then
  select user_id into nh from room_members where room_id=p_room order by joined_at limit 1;
  if nh is null then update game_rooms set status='closed' where id=p_room; else update game_rooms set host_user_id=nh where id=p_room; end if; end if; end $$;

create or replace function kick_member(p_room uuid, p_user uuid) returns void language plpgsql security definer set search_path=public as $$
begin if not exists(select 1 from game_rooms where id=p_room and host_user_id=auth.uid()) then raise exception 'NOT_HOST'; end if;
 if p_user<>auth.uid() then delete from room_members where room_id=p_room and user_id=p_user; end if; end $$;

create or replace function start_round(p_room uuid) returns game_rounds language plpgsql security definer set search_path=public as $$
declare g game_rounds; begin
 if not exists(select 1 from game_rooms where id=p_room and host_user_id=auth.uid() and status='open') then raise exception 'NOT_HOST'; end if;
 select * into g from game_rounds where room_id=p_room and status='picking' limit 1; if found then return g; end if;
 insert into game_rounds(room_id,round_number) values(p_room,coalesce((select max(round_number) from game_rounds where room_id=p_room),0)+1) returning * into g; return g; end $$;

create or replace function submit_pick(p_round uuid, p_symbol text) returns void language plpgsql security definer set search_path=public as $$
declare g game_rounds; begin select * into g from game_rounds where id=p_round;
 if not found or not is_member(g.room_id) or g.status<>'picking' then raise exception 'NOT_ALLOWED'; end if;
 insert into round_picks(round_id,user_id,room_id,symbol) values(p_round,auth.uid(),g.room_id,p_symbol)
  on conflict(round_id,user_id) do update set symbol=excluded.symbol; end $$;

create or replace function roll_round(p_round uuid) returns game_rounds language plpgsql security definer set search_path=public as $$
declare g game_rounds; d text[]; begin select * into g from game_rounds where id=p_round for update;
 if not found or g.status<>'picking' or not exists(select 1 from game_rooms where id=g.room_id and host_user_id=auth.uid()) then raise exception 'NOT_ALLOWED'; end if;
 select array_agg((array['flag','crown','heart','spade','diamond','club'])[1+floor(random()*6)::int]) into d from generate_series(1,6);
 update game_rounds set status='rolled', dice=d where id=p_round returning * into g; return g; end $$;

revoke all on function create_room,join_room,leave_room,kick_member,start_round,submit_pick,roll_round from public, anon;
grant execute on function create_room,join_room,leave_room,kick_member,start_round,submit_pick,roll_round to authenticated;
alter publication supabase_realtime add table room_members, game_rounds, round_picks;

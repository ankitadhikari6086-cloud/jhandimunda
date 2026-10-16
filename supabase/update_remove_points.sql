-- Run this ONLY if you already ran an older schema.sql (removes the point system)
alter table room_members drop column if exists score;
drop function if exists submit_amount(uuid,text);
alter table round_picks drop column if exists amount;
delete from round_picks where symbol is null;
alter table round_picks alter column symbol set not null;

create or replace function roll_round(p_round uuid) returns game_rounds language plpgsql security definer set search_path=public as $$
declare g game_rounds; d text[]; begin select * into g from game_rounds where id=p_round for update;
 if not found or g.status<>'picking' or not exists(select 1 from game_rooms where id=g.room_id and host_user_id=auth.uid()) then raise exception 'NOT_ALLOWED'; end if;
 select array_agg((array['flag','crown','heart','spade','diamond','club'])[1+floor(random()*6)::int]) into d from generate_series(1,6);
 update game_rounds set status='rolled', dice=d where id=p_round returning * into g; return g; end $$;

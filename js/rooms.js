import { sb } from "./supa.js";
const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); if (error) throw new Error(error.message); return data; };
export const createRoom = (title, name, code) => rpc("create_room", { p_title: title, p_name: name, p_code: code || null });
export const joinRoom = (code, name) => rpc("join_room", { p_code: code, p_name: name });
export const leaveRoom = (id) => rpc("leave_room", { p_room: id });
export const kick = (id, uid) => rpc("kick_member", { p_room: id, p_user: uid });
export const startRound = (id) => rpc("start_round", { p_room: id });
export const pick = (rid, sym) => rpc("submit_pick", { p_round: rid, p_symbol: sym });
export const roll = (rid) => rpc("roll_round", { p_round: rid });

export async function load(id) {
  const [m, r, g] = await Promise.all([
    sb.from("room_members").select("user_id,display_name").eq("room_id", id).order("joined_at"),
    sb.from("game_rounds").select("*").eq("room_id", id).order("round_number", { ascending: false }).limit(1),
    sb.from("game_rooms").select("*").eq("id", id).maybeSingle(),
  ]);
  if (m.error) throw new Error(m.error.message);
  const round = r.data?.[0] || null;
  const picks = round ? (await sb.from("round_picks").select("user_id,symbol").eq("round_id", round.id)).data || [] : [];
  return { members: m.data, round, picks, room: g.data };
}

// Realtime: DB changes (roster/game) + Presence (who is online). Returns an unsubscribe function.
export function subscribe(id, user, name, onChange, onPresence) {
  const ch = sb.channel(`room:${id}`, { config: { presence: { key: user.id } } });
  for (const t of ["room_members", "game_rounds", "round_picks"])
    ch.on("postgres_changes", { event: "*", schema: "public", table: t, filter: `room_id=eq.${id}` }, onChange);
  ch.on("presence", { event: "sync" }, () => onPresence(Object.keys(ch.presenceState())));
  ch.subscribe((s) => { if (s === "SUBSCRIBED") ch.track({ name }); });
  return () => sb.removeChannel(ch);
}

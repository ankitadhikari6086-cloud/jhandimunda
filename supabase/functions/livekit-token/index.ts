// Issues a short-lived LiveKit token ONLY to authenticated members of the requested room.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { AccessToken } from "npm:livekit-server-sdk@2.6.1";

const cors = { "Access-Control-Allow-Origin": "*", // tighten to your site origin in production
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);
    const { roomId } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(String(roomId))) return json({ error: "bad room" }, 400);
    // RLS: only returns a row if this user is a member of the room
    const { data: m } = await sb.from("room_members").select("display_name, game_rooms(status)")
      .eq("room_id", roomId).eq("user_id", user.id).maybeSingle();
    if (!m) return json({ error: "not a member" }, 403);
    if ((m as any).game_rooms?.status !== "open") return json({ error: "room closed" }, 403);
    const at = new AccessToken(Deno.env.get("LIVEKIT_API_KEY")!, Deno.env.get("LIVEKIT_API_SECRET")!,
      { identity: user.id, name: m.display_name, ttl: "15m" });
    at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: false });
    return json({ token: await at.toJwt(), url: Deno.env.get("LIVEKIT_URL") });
  } catch (_e) { return json({ error: "server error" }, 500); }
});

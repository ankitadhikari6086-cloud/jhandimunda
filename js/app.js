import * as S from "./supa.js";
import * as R from "./rooms.js";
import * as V from "./voice.js";
import { renderGame } from "./game.js";

const $ = (id) => document.getElementById(id);
const st = { user: null, name: "", room: null, members: [], round: null, picks: [], online: new Set(), voiceIds: new Set(), speaking: new Set(), vstate: "off", muted: false, unsub: null };
const MSG = {
  ROOM_NOT_FOUND: "That room code doesn't exist.", ROOM_CLOSED: "That room is closed.", ROOM_FULL: "That room is full.", CODE_TAKEN: "That room code is already used. Pick another or leave it blank.", BAD_CODE: "Room code must be 4–8 letters or numbers.", GUEST: "Guest access is off. In Supabase enable Authentication → Anonymous sign-ins.",
  MIC_DENIED: "Microphone blocked. Allow it in your browser's site settings, then try again. You can still play without voice.",
  NO_MIC: "No microphone found. You can still play without voice.", UNSUPPORTED: "Voice isn't supported in this browser.",
  TOKEN: "Voice service unavailable. The game still works.", CONNECT: "Couldn't connect to voice. The game still works.",
};
let sayTimer;
function say(e, ok) {
  const k = Object.keys(MSG).find((c) => String(e?.message ?? e).includes(c));
  const s = $("status"); s.textContent = k ? MSG[k] : (typeof e === "string" ? e : e?.message || "Something went wrong."); s.className = ok ? "ok" : "err";
  clearTimeout(sayTimer); sayTimer = setTimeout(() => { s.textContent = ""; }, ok ? 2500 : 6000); // toast disappears by itself
}
async function busy(btn, fn) { // prevents duplicate clicks while a request is running
  if (btn?.disabled) return; if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { say(e); } finally { if (btn) btn.disabled = false; }
}
const validName = () => {
  const n = $("name").value.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N} _.-]{2,24}$/u.test(n)) throw new Error("Display name must be 2–24 letters, numbers, spaces, _ . or -");
  localStorage.setItem("lb_name", n); return n;
};

function showHome() { $("home").hidden = false; $("room").hidden = true; }
function onSession(s) { st.user = s?.user ?? null; }
async function ready() { // silent guest session: no login screen
  if (st.user) return;
  try { onSession(await S.session()); if (!st.user) { await S.guest(); onSession(await S.session()); } }
  catch { throw new Error("GUEST"); }
  if (!st.user) throw new Error("GUEST");
}

function render() {
  const ul = $("members"); ul.replaceChildren(); $("empty").hidden = st.members.length > 0;
  const host = st.room?.host_user_id === st.user.id;
  for (const m of st.members) {
    const li = document.createElement("li"); li.className = "m" + (st.speaking.has(m.user_id) ? " speaking" : "");
    const add = (t, cls) => { const x = document.createElement("span"); x.textContent = t; if (cls) x.className = cls; li.append(x); };
    const av = document.createElement("span"); av.className = "av"; av.textContent = [...m.display_name][0]?.toUpperCase() || "?";
    av.style.background = `hsl(${[...m.display_name].reduce((a, c) => a + c.charCodeAt(0) * 37, 0) % 360} 70% 45%)`; li.append(av);
    add(m.display_name + (m.user_id === st.user.id ? " (you)" : ""));
    if (m.user_id === st.room?.host_user_id) add("host", "b");
    add(st.online.has(m.user_id) ? "● online" : "○ away", "b");
    if (st.voiceIds.has(m.user_id)) add(st.speaking.has(m.user_id) ? "🔊 speaking" : "🎙 in voice", "b");
    if (host && m.user_id !== st.user.id) {
      const k = document.createElement("button"); k.className = "danger small"; k.textContent = "Remove"; k.ariaLabel = "Remove " + m.display_name;
      k.onclick = () => busy(k, () => R.kick(st.room.id, m.user_id)); li.append(k);
    }
    ul.append(li);
  }
  renderGame($("game"), st, act);
  const on = st.vstate === "connected" || st.vstate === "reconnecting";
  $("vJoin").hidden = on || st.vstate === "connecting"; $("vMute").hidden = !on; $("vLeave").hidden = !on;
  $("vMute").textContent = st.muted ? "Unmute" : "Mute"; $("vMute").setAttribute("aria-pressed", st.muted);
  $("vStatus").textContent = { off: "Voice is off. Your microphone is only used after you click Join voice.", connecting: "Connecting to voice…",
    reconnecting: "Connection lost – reconnecting…", connected: st.muted ? "Connected · microphone MUTED" : "Connected · microphone ON" }[st.vstate];
}
const act = {
  start: (e) => busy(e?.target, () => R.startRound(st.room.id)),
  pick: (rid, sym) => R.pick(rid, sym).catch(say),
  roll: (rid) => R.roll(rid).catch(say),
};
let reloading = false;
async function refresh() {
  if (!st.room || reloading) return; reloading = true;
  try {
    const d = await R.load(st.room.id);
    if (!d.members.some((m) => m.user_id === st.user.id)) { say("You are no longer in this room."); return leaveRoom(true); }
    Object.assign(st, d); $("rTitle").textContent = d.room?.title ?? "Room"; render();
  } catch (e) { say(e); } finally { reloading = false; }
}

async function enter(room) {
  st.unsub?.(); // never keep two realtime subscriptions
  st.room = room; st.name = $("name").value.trim();
  localStorage.setItem("lb_room", room.room_code);
  $("home").hidden = true; $("room").hidden = false; $("rTitle").textContent = room.title; $("rCode").textContent = room.room_code;
  st.unsub = R.subscribe(room.id, st.user, st.name, () => refresh(), (ids) => { st.online = new Set(ids); render(); });
  await refresh();
}
async function leaveRoom(silent) {
  await V.leave(); st.vstate = "off";
  st.unsub?.(); st.unsub = null;
  if (st.room && st.user && !silent) await R.leaveRoom(st.room.id).catch(() => {});
  st.room = null; st.members = []; st.round = null; st.picks = []; localStorage.removeItem("lb_room");
  showHome();
}

const vcb = {
  state: (s) => { st.vstate = s; if (s === "off") st.muted = false; render(); },
  speakers: (ids) => { st.speaking = new Set(ids); render(); },
  people: (ids) => { st.voiceIds = new Set(ids); render(); },
};

// --- wiring ---
$("create").onclick = (e) => busy(e.target, async () => {
  const n = validName(), c = $("code").value.trim().toUpperCase();
  if (c && !/^[A-Z0-9]{4,8}$/.test(c)) throw new Error("BAD_CODE");
  await ready(); await S.saveProfile(st.user, n);
  await enter(await R.createRoom($("title").value.trim() || "Langur Burja Room", n, c));
});
$("join").onclick = (e) => busy(e.target, async () => {
  const n = validName(), c = $("code").value.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(c)) throw new Error("Enter the room code (4–8 letters or numbers).");
  await ready(); await S.saveProfile(st.user, n); await enter(await R.joinRoom(c, n));
});
$("leave").onclick = (e) => busy(e.target, () => leaveRoom());
$("copy").onclick = () => navigator.clipboard?.writeText(`${location.origin}${location.pathname}?room=${$("rCode").textContent}`).then(() => say("Invite link copied.", true), () => say("Couldn't copy. Copy the address bar link instead."));
$("vJoin").onclick = (e) => busy(e.target, () => V.join(st.room.id, vcb));
$("vMute").onclick = () => { st.muted = !st.muted; V.setMuted(st.muted); render(); };
$("vLeave").onclick = (e) => busy(e.target, async () => { await V.leave(); vcb.state("off"); vcb.people([]); vcb.speakers([]); });
addEventListener("pagehide", () => { V.leave(); });
addEventListener("offline", () => say("You're offline. Reconnecting when the network returns."));
addEventListener("online", () => { say("Back online.", true); refresh(); });

// --- fun lobby helpers (client only) ---
const pickOne = (a) => a[Math.floor(Math.random() * a.length)];
$("rndName").onclick = () => { $("name").value = `${pickOne(["Lucky", "Jolly", "Mighty", "Sweet", "Royal", "Kite", "Tika", "Masala"])} ${pickOne(["Langur", "Burja", "Sher", "Mayur", "Dhaka Topi", "Sel Roti", "Jamara"])}`; };
$("rndCode").onclick = () => { $("code").value = pickOne(["DASHAIN", "TIKA", "JAMARA", "KITE", "PING", "BIJAYA", "SELROTI"]).slice(0, 5) + Math.floor(Math.random() * 90 + 10); };
document.querySelectorAll("#titleChips .chip").forEach((c) => (c.onclick = () => { $("title").value = c.textContent.replace(/^\S+\s/, "").trim(); }));
$("name").value = localStorage.getItem("lb_name") || "";
$("code").value = (new URLSearchParams(location.search).get("room") || "").toUpperCase().slice(0, 8);
S.onAuth(onSession);
S.session().then(async (s) => {
  onSession(s);
  const last = localStorage.getItem("lb_room"); // rejoin after refresh
  if (s && last && $("name").value) { try { await enter(await R.joinRoom(last, $("name").value.trim())); } catch { localStorage.removeItem("lb_room"); } }
});

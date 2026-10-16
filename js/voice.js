import { sb } from "./supa.js";
let room = null;
export const inVoice = () => !!room;

export async function join(roomId, cb) {
  if (room) return; // never create duplicate connections
  const LK = window.LivekitClient;
  if (!LK) throw new Error("UNSUPPORTED");
  cb.state("connecting");
  const { data, error } = await sb.functions.invoke("livekit-token", { body: { roomId } });
  if (error || !data?.token) { cb.state("off"); throw new Error("TOKEN"); }
  const r = (room = new LK.Room({ adaptiveStream: true }));
  const ids = () => [r.localParticipant, ...r.remoteParticipants.values()].map((p) => p.identity);
  r.on(LK.RoomEvent.TrackSubscribed, (t) => { if (t.kind === "audio") document.getElementById("audio").appendChild(t.attach()); })
   .on(LK.RoomEvent.TrackUnsubscribed, (t) => t.detach().forEach((e) => e.remove()))
   .on(LK.RoomEvent.ActiveSpeakersChanged, (s) => cb.speakers(s.map((p) => p.identity)))
   .on(LK.RoomEvent.ParticipantConnected, () => cb.people(ids()))
   .on(LK.RoomEvent.ParticipantDisconnected, () => cb.people(ids()))
   .on(LK.RoomEvent.Reconnecting, () => cb.state("reconnecting"))
   .on(LK.RoomEvent.Reconnected, () => cb.state("connected"))
   .on(LK.RoomEvent.Disconnected, () => { cleanup(); cb.state("off"); cb.people([]); cb.speakers([]); });
  try {
    await r.connect(data.url, data.token);
    await r.localParticipant.setMicrophoneEnabled(true); // browser asks for mic permission here
    await r.startAudio();
    cb.people(ids()); cb.state("connected");
  } catch (e) {
    await leave(); cb.state("off");
    if (e?.name === "NotAllowedError") throw new Error("MIC_DENIED");
    if (e?.name === "NotFoundError") throw new Error("NO_MIC");
    throw new Error("CONNECT");
  }
}
export const setMuted = (m) => room?.localParticipant.setMicrophoneEnabled(!m);
export async function leave() {
  const r = room; if (!r) return;
  try { await r.localParticipant.setMicrophoneEnabled(false); } catch {}
  r.removeAllListeners(); await r.disconnect(true); cleanup();
}
function cleanup() { room = null; document.getElementById("audio").replaceChildren(); }

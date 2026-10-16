import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";
export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const clean = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
export const session = async () => (await sb.auth.getSession()).data.session;
export const signIn = (email, password) => sb.auth.signInWithPassword({ email, password }).then(clean);
export const signUp = (email, password) => sb.auth.signUp({ email, password }).then(clean);
export const guest = () => sb.auth.signInAnonymously().then(clean); // enable "Anonymous sign-ins" in Supabase
export const signOut = () => sb.auth.signOut();
export const onAuth = (fn) => sb.auth.onAuthStateChange((_e, s) => fn(s));
export async function saveProfile(user, name) {
  await sb.from("profiles").upsert({ id: user.id, display_name: name });
}

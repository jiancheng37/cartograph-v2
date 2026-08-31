import { createClient, type Session } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
export const authConfigured = Boolean(url && key);
export const supabase = authConfigured ? createClient(url!, key!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : undefined;

export async function currentSession(): Promise<Session | null> { return supabase ? (await supabase.auth.getSession()).data.session : null; }
export async function accessToken() { return (await currentSession())?.access_token; }
export async function signInWithGoogle() { if (!supabase) return; const redirectTo = `${window.location.origin}/auth/callback`; const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } }); if (error) throw error; }
export async function signOut() { await supabase?.auth.signOut(); window.location.assign(marketingUrl()); }
export const appUrl = () => (import.meta.env.VITE_APP_URL as string | undefined) ?? `${window.location.origin}/app`;
export const marketingUrl = () => (import.meta.env.VITE_MARKETING_URL as string | undefined) ?? window.location.origin;

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { LoaderCircle, Map } from "lucide-react";
import { App } from "./App";
import { authConfigured, signInWithGoogle, supabase } from "./auth";

export function AuthGate() {
  const [session, setSession] = useState<Session | null | undefined>(authConfigured ? undefined : null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!authConfigured) return import.meta.env.PROD
    ? <main className="auth-loading"><Map/><span>Authentication is not configured.</span></main>
    : <App />;
  if (session === undefined) return <div className="auth-loading"><LoaderCircle className="spin"/><span>Opening Cartograph</span></div>;
  if (session) return <App user={{ name: session.user.user_metadata.full_name ?? session.user.email ?? "Account", email: session.user.email ?? "" }} />;
  return <main className="login-page"><a className="public-brand" href="/"><Map size={18}/><b>Cartograph</b></a><section><span>Welcome back</span><h1>Your codebase, remembered.</h1><p>Sign in to open your maps and connect a coding agent.</p><button onClick={() => void signInWithGoogle().catch(cause => setError(cause instanceof Error ? cause.message : "Could not sign in"))}><GoogleMark/>Continue with Google</button>{error && <small>{error}</small>}</section><footer>By continuing, you agree to the Terms and Privacy Policy.</footer></main>;
}

function GoogleMark() { return <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.09-1.92 3.27-4.75 3.27-8.1Z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.29-2.65l-3.57-2.77c-.98.66-2.24 1.06-3.72 1.06-2.87 0-5.3-1.94-6.17-4.54H2.15v2.84A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M5.83 14.1A6.6 6.6 0 0 1 5.48 12c0-.73.13-1.43.35-2.1V7.06H2.15A11 11 0 0 0 1 12c0 1.77.42 3.44 1.15 4.94l3.68-2.84Z"/><path fill="#EA4335" d="M12 5.36c1.62 0 3.06.56 4.2 1.64l3.17-3.16A10.6 10.6 0 0 0 12 1a11 11 0 0 0-9.85 6.06L5.83 9.9C6.7 7.3 9.13 5.36 12 5.36Z"/></svg>; }

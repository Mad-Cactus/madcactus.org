import { createClient } from "@supabase/supabase-js";

// ponytail: 10s fetch timeout prevents infinite hangs when SUPABASE_URL is
// unreachable or misconfigured. Without this, signInWithPassword hangs forever
// and the login button stays stuck on "Signing in…".
const fetchWithTimeout =
	(timeoutMs: number) => (url: any, init: any) =>
		fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });

function requireEnv(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`${name} is not set — check dashboard/.env`);
	return v;
}

/**
 * Supabase client using anon/publishable key.
 * Used by admin auth (signIn, session management). RLS-enforced.
 */
export function supabaseAdmin() {
	return createClient(
		requireEnv("SUPABASE_URL"),
		requireEnv("SUPABASE_ANON_KEY"),
		{
			auth: { persistSession: false, autoRefreshToken: false },
			global: { fetch: fetchWithTimeout(10_000) as unknown as typeof fetch },
		},
	);
}

/** Supabase client using service role key.
 * Bypasses RLS. Used for storage operations (file uploads/downloads).
 * All data queries go through Drizzle (~/db) instead.
 * 10-min fetch timeout — meeting audio uploads are 35-45MB and a 10s cap
 * aborts them mid-flight ("The operation timed out."). */
export function supabaseService() {
	return createClient(
		requireEnv("SUPABASE_URL"),
		requireEnv("SUPABASE_SERVICE_KEY"),
		{
			auth: { persistSession: false, autoRefreshToken: false },
			global: { fetch: fetchWithTimeout(600_000) as unknown as typeof fetch },
		},
	);
}

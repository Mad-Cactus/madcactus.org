import { createClient } from "@supabase/supabase-js";

// ponytail: 10s fetch timeout prevents infinite hangs when SUPABASE_URL is
// unreachable or misconfigured. Without this, signInWithPassword hangs forever
// and the login button stays stuck on "Signing in…".
const fetchWithTimeout = (url: any, init: any) =>
	fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });

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
			global: { fetch: fetchWithTimeout },
		},
	);
}

/**
 * Supabase client using service role key.
 * Bypasses RLS. Used for storage operations (file uploads/downloads).
 * All data queries go through Drizzle (~/db) instead.
 */
export function supabaseService() {
	return createClient(
		requireEnv("SUPABASE_URL"),
		requireEnv("SUPABASE_SERVICE_KEY"),
		{
			auth: { persistSession: false, autoRefreshToken: false },
			global: { fetch: fetchWithTimeout },
		},
	);
}

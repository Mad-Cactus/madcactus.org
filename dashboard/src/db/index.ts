import { drizzle } from "drizzle-orm/bun-sql";
import { SQL } from "bun";
import type { SQLWrapper } from "drizzle-orm";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check dashboard/.env");

// Bun's built-in postgres client — one less dependency. prepare:false because
// Supabase's pooler runs transaction-mode pgbouncer (named prepared statements
// break there), same reason the old postgres-js client had it. Flip to true
// only on a direct or session-pooler connection.
const client = new SQL(url, { prepare: false });

export const db = drizzle(client, { schema });

/** Typed raw SQL. Drizzle's bun-sql driver pins its result HKT to
 *  Record<string, any>[] so db.execute<T>() silently loses the row type —
 *  this wrapper restores it. */
export async function raw<T extends Record<string, unknown>>(query: SQLWrapper | string): Promise<T[]> {
	return db.execute(query) as Promise<T[]>;
}

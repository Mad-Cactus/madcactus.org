import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set — check dashboard/.env");

// ponytail: single connection, not pool. This app is single-user admin +
// low-traffic client portal. A pool (max: 10) wastes Supabase's free-tier
// connection budget. Upgrade to postgres(url, { max: N }) if concurrency bites.
const client = postgres(url, { prepare: false });

export const db = drizzle(client, { schema });

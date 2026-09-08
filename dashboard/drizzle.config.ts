import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "../supabase/migrations",
	dialect: "postgresql",
	// supabase prefix → YYYYMMDDHHMMSS_name.sql, which sorts AFTER all existing
	// migrations. drizzle's default index prefix (00NN_) sorts BEFORE them and
	// breaks filename-order replay (CI + supabase db push).
	migrations: { prefix: "supabase" },
	dbCredentials: {
		url: process.env.DATABASE_URL!,
	},
});

-- Singleton running-timer row. id is pinned to 1 so at most one timer exists.
CREATE TABLE "timer" (
	"id" integer PRIMARY KEY,
	"project_id" "uuid" NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
	"description" text NOT NULL DEFAULT '',
	"started_at" timestamp NOT NULL DEFAULT now(),
	CONSTRAINT "timer_singleton" CHECK ("id" = 1)
);

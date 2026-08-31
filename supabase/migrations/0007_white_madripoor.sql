CREATE TABLE "timer" (
	"id" integer PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "timer" ADD CONSTRAINT "timer_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timer" ADD CONSTRAINT "timer_singleton" CHECK ("id" = 1);

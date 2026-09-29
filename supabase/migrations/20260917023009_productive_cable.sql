ALTER TABLE "docs" ADD COLUMN "issue_number" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "docs_issue_number_key" ON "docs" USING btree ("issue_number") WHERE issue_number is not null;--> statement-breakpoint
-- one-time backfill: number every newsletter that ever went out (published_at
-- survives unlisting) oldest-first, so existing issues keep their numbers
WITH numbered AS (
	SELECT id, row_number() OVER (ORDER BY published_at) AS n
	FROM docs
	WHERE kind = 'newsletter' AND published_at IS NOT NULL
)
UPDATE docs SET issue_number = n FROM numbered WHERE docs.id = numbered.id;
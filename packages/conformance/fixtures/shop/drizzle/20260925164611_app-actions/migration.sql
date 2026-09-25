CREATE TABLE "invites" (
	"token" varchar(80) PRIMARY KEY,
	"project_id" integer NOT NULL,
	"accepted_by" integer,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id");--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_accepted_by_fkey" FOREIGN KEY ("accepted_by") REFERENCES "users"("id");
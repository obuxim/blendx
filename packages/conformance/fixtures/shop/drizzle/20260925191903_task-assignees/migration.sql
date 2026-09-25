CREATE TABLE "task_assignees" (
	"task_id" integer,
	"user_id" integer,
	CONSTRAINT "task_assignees_pkey" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "tasks"("id");--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");
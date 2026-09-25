CREATE TABLE "uploads" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "uploads_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"filename" varchar(255) NOT NULL,
	"content_type" varchar(120) NOT NULL,
	"byte_length" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");
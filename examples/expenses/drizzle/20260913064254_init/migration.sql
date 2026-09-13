CREATE TYPE "expense_category" AS ENUM('travel', 'meals', 'office', 'other');--> statement-breakpoint
CREATE TYPE "expense_status" AS ENUM('draft', 'submitted', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expenses_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"user_id" integer NOT NULL,
	"description" varchar(200) NOT NULL,
	"category" "expense_category" NOT NULL,
	"amount" numeric(10,2) NOT NULL,
	"tax" numeric(10,2) NOT NULL,
	"total" numeric(10,2) NOT NULL,
	"status" "expense_status" DEFAULT 'draft'::"expense_status" NOT NULL,
	"spent_on" date NOT NULL,
	"review_note" varchar(500),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"email" varchar(255) NOT NULL CONSTRAINT "users_email_key" UNIQUE,
	"name" varchar(80) NOT NULL,
	"is_approver" boolean DEFAULT false NOT NULL,
	"api_token" uuid DEFAULT gen_random_uuid() NOT NULL CONSTRAINT "users_api_token_key" UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "expenses_status_idx" ON "expenses" ("status");--> statement-breakpoint
CREATE INDEX "expenses_spent_on_idx" ON "expenses" ("spent_on");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id");
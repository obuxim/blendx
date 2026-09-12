CREATE TABLE "addition_results" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "addition_results_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"result" double precision,
	"created_at" timestamp,
	"updated_at" timestamp,
	"deleted_at" timestamp
);

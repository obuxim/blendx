CREATE TABLE "order_items" (
	"order_id" bigint,
	"line" integer,
	"sku" varchar(32) NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "order_items_pkey" PRIMARY KEY("order_id","line")
);
--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;
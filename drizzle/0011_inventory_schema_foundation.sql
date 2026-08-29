-- TIN-3814 I1: inventory schema and tenant-isolation policy.
-- Generated table/enum/constraint DDL is followed in this same ledger entry
-- by the hand-authored ENABLE + FORCE + USING/WITH CHECK policy that
-- drizzle-kit 0.30 cannot represent completely. Keeping them atomic prevents
-- any numbered migration state in which inventory tables exist unprotected.

CREATE TYPE "public"."asset_state" AS ENUM('available', 'checked_out', 'repair', 'quarantined', 'retired');--> statement-breakpoint
CREATE TYPE "public"."loan_state" AS ENUM('draft', 'active', 'overdue', 'returned', 'cancelled');--> statement-breakpoint
CREATE TABLE "asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"short_id" text NOT NULL,
	"display_label" text NOT NULL,
	"kind" text NOT NULL,
	"custody_basis" text NOT NULL,
	"legacy_identifier" text,
	"state" "asset_state" DEFAULT 'available' NOT NULL,
	"checklist_version" integer DEFAULT 1 NOT NULL,
	"parent_asset_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_tenant_row_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "asset_component" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'content' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "asset_component_tenant_row_uniq" UNIQUE("tenant_id","id"),
	CONSTRAINT "asset_component_kind" CHECK ("asset_component"."kind" in ('content', 'consumable'))
);
--> statement-breakpoint
CREATE TABLE "inspection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"condition" text NOT NULL,
	"notes" text,
	"actor_id" uuid NOT NULL,
	"media_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspection_kind" CHECK ("inspection"."kind" in ('checkout', 'return'))
);
--> statement-breakpoint
CREATE TABLE "loan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"state" "loan_state" DEFAULT 'draft' NOT NULL,
	"checkout_at" timestamp with time zone,
	"expected_return_at" timestamp with time zone,
	"returned_at" timestamp with time zone,
	"checkout_checklist_version" integer,
	"return_checklist_version" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loan_tenant_row_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "location_observation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"loan_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"latitude" numeric(9, 6) NOT NULL,
	"longitude" numeric(9, 6) NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"actor_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repair_case" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"loan_id" uuid,
	"open_disposition" text NOT NULL,
	"diagnosis" text,
	"parts_consumables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"responsible_operator_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"close_disposition" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "repair_case_open_disposition" CHECK ("repair_case"."open_disposition" in ('needs_repair', 'missing_content', 'damage')),
	CONSTRAINT "repair_case_close_disposition" CHECK ("repair_case"."close_disposition" is null or "repair_case"."close_disposition" in ('serviceable', 'retired'))
);
--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset" ADD CONSTRAINT "asset_parent_in_tenant_fk" FOREIGN KEY ("tenant_id","parent_asset_id") REFERENCES "public"."asset"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_component" ADD CONSTRAINT "asset_component_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_component" ADD CONSTRAINT "asset_component_asset_in_tenant_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."asset"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_loan_in_tenant_fk" FOREIGN KEY ("tenant_id","loan_id") REFERENCES "public"."loan"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspection" ADD CONSTRAINT "inspection_actor_in_tenant_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."person"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_asset_in_tenant_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."asset"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loan" ADD CONSTRAINT "loan_person_in_tenant_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."person"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_observation" ADD CONSTRAINT "location_observation_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_observation" ADD CONSTRAINT "location_observation_loan_in_tenant_fk" FOREIGN KEY ("tenant_id","loan_id") REFERENCES "public"."loan"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_observation" ADD CONSTRAINT "location_observation_actor_in_tenant_fk" FOREIGN KEY ("tenant_id","actor_id") REFERENCES "public"."person"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case" ADD CONSTRAINT "repair_case_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case" ADD CONSTRAINT "repair_case_asset_in_tenant_fk" FOREIGN KEY ("tenant_id","asset_id") REFERENCES "public"."asset"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case" ADD CONSTRAINT "repair_case_loan_in_tenant_fk" FOREIGN KEY ("tenant_id","loan_id") REFERENCES "public"."loan"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_case" ADD CONSTRAINT "repair_case_operator_in_tenant_fk" FOREIGN KEY ("tenant_id","responsible_operator_id") REFERENCES "public"."person"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "asset_short_id_unique" ON "asset" USING btree ("tenant_id","short_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loan_one_live_per_asset" ON "loan" USING btree ("tenant_id","asset_id") WHERE "loan"."state" in ('active', 'overdue');
--> statement-breakpoint

ALTER TABLE "asset" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "asset_tenant" ON "asset"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "asset_component" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "asset_component" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "asset_component_tenant" ON "asset_component"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "loan" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "loan" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "loan_tenant" ON "loan"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "inspection" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "inspection" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "inspection_tenant" ON "inspection"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "location_observation" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "location_observation" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "location_observation_tenant" ON "location_observation"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

ALTER TABLE "repair_case" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "repair_case" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "repair_case_tenant" ON "repair_case"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

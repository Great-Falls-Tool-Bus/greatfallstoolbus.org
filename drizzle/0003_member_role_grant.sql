CREATE TABLE "member_role_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "member_role_grant" ADD CONSTRAINT "member_role_grant_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_role_grant_live_uniq" ON "member_role_grant" USING btree ("tenant_id","person_id","role") WHERE "member_role_grant"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "member_role_grant_person" ON "member_role_grant" USING btree ("tenant_id","person_id");--> statement-breakpoint

-- ─── Hand-written half: row-level security (TIN-3817 slice S2) ───────────────
--
-- Everything above the marker is `drizzle-kit generate` output for the
-- `member_role_grant` declaration in schema.ts. Everything below is
-- hand-written for the same reason 0002 is entirely hand-written: drizzle-kit
-- cannot emit FORCE ROW LEVEL SECURITY, and FORCE is the half that matters —
-- without it the table owner (the migration role) bypasses the policy. Same
-- file rather than a second migration because the slice's fence is "+ one
-- migration", and 0001 already set the house precedent of hand-finished SQL
-- inside one ledgered file. The guard against this block going missing is the
-- pg_class/pg_policies iteration in rls.integration.test.ts, which fails on
-- ANY table in a tenant-scoped schema lacking ENABLE + FORCE + a policy.
--
-- The policy text is byte-identical to every other table's (see 0002 for the
-- nullif and WITH CHECK rationale). No CHECK constraint on `role` on purpose:
-- the role VOCABULARY is pending ratification at sitting #2 (Item 2), and a
-- constraint here would ratify it by migration.
--
-- No GRANT is needed: 0002's ALTER DEFAULT PRIVILEGES already hands gftb_app
-- SELECT/INSERT/UPDATE/DELETE on tables later migrations create — that this
-- works is asserted by the runtime-role rows in auth.integration.test.ts.

ALTER TABLE "member_role_grant" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "member_role_grant" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "member_role_grant_tenant" ON "member_role_grant"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

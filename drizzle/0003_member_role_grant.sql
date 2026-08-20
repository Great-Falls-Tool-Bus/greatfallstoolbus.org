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
--> statement-breakpoint

-- ─── Hand-written half 2: append-only enforced by the database (S2 review) ───
--
-- Adversarial review on PR #175 proved the file's "append-only, never
-- deleted" comments were convention only: gftb_app held blanket UPDATE and
-- DELETE, so a compromised runtime could rewrite `role`/`granted_by` or erase
-- revocation history — precisely the audit trail S5 will hang keyholder
-- authorization on. Enforced here, before S5 exists, on the finance_receipt
-- doctrine (spec §3.3: "enforced by grant rather than by convention"):
--
--   grants  gftb_app loses DELETE and table-level UPDATE; it keeps INSERT,
--           SELECT, and a COLUMN-level UPDATE on revoked_at — the one write
--           revocation needs.
--   trigger binds EVERY role, table owner included (grants do not): no
--           deletes, revocation is one-way (revoked_at NULL -> NOT NULL,
--           once), and every other column is immutable.
--
-- This block constrains ROW LIFECYCLE only. The role VOCABULARY stays
-- unratified (sitting #2 Item 2) and is deliberately not constrained here.

REVOKE UPDATE, DELETE ON "member_role_grant" FROM gftb_app;
--> statement-breakpoint
GRANT UPDATE ("revoked_at") ON "member_role_grant" TO gftb_app;
--> statement-breakpoint
CREATE FUNCTION member_role_grant_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'member_role_grant is append-only: grants are revoked (revoked_at), never deleted';
	END IF;
	IF OLD.revoked_at IS NOT NULL THEN
		RAISE EXCEPTION 'member_role_grant is append-only: a revoked grant is immutable; re-grant with a new row';
	END IF;
	IF NEW.revoked_at IS NULL THEN
		RAISE EXCEPTION 'member_role_grant: an update may only set revoked_at (revocation is one-way)';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
		OR NEW.person_id IS DISTINCT FROM OLD.person_id
		OR NEW.role IS DISTINCT FROM OLD.role
		OR NEW.granted_by IS DISTINCT FROM OLD.granted_by
		OR NEW.granted_at IS DISTINCT FROM OLD.granted_at THEN
		RAISE EXCEPTION 'member_role_grant: grant fields are immutable; only revoked_at may change';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER member_role_grant_append_only
	BEFORE UPDATE OR DELETE ON "member_role_grant"
	FOR EACH ROW EXECUTE FUNCTION member_role_grant_append_only();

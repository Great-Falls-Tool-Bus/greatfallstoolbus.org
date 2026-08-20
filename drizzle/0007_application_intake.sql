CREATE TABLE "application" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"interests_help_offer" text NOT NULL,
	"tour_availability" text NOT NULL,
	"disclosures" text NOT NULL,
	"age_attested_at" timestamp with time zone NOT NULL,
	"age_attestation_version" text NOT NULL,
	"submission_idempotency_key" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_submission_idem_uniq" UNIQUE("tenant_id","submission_idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "application_email_token" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_email_token_hash_uniq" UNIQUE("tenant_id","token_hash")
);
--> statement-breakpoint
ALTER TABLE "application" ADD CONSTRAINT "application_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_email_token" ADD CONSTRAINT "application_email_token_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_email_token" ADD CONSTRAINT "application_email_token_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_status" ON "application" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "application_email" ON "application" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "application_email_token_app" ON "application_email_token" USING btree ("tenant_id","application_id");
-- ─── Hand-written half: row-level security (TIN-3440 slice S4) ───────────────
--
-- Everything above the marker is `drizzle-kit generate` output for the
-- `application` and `application_email_token` declarations in schema.ts.
-- Everything below is hand-written for the 0002/0003 reason: drizzle-kit
-- cannot emit FORCE ROW LEVEL SECURITY, and FORCE is the half that matters.
-- The guard against this block going missing is the pg_class/pg_policies
-- iteration in rls.integration.test.ts, which fails on ANY public-schema
-- table lacking ENABLE + FORCE + a policy. The policy text is byte-identical
-- to every other table's (see 0002 for the nullif and WITH CHECK rationale).

ALTER TABLE "application" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "application" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "application_tenant" ON "application"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "application_email_token" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "application_email_token" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "application_email_token_tenant" ON "application_email_token"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ─── Hand-written half 2: the ratified FSM and token rules as CHECKs ─────────
--
-- `status` admits exactly the eight PERSISTED states of the ratified
-- application state machine (spec §4:157-160; ADR 0014; member-lifecycle.mmd).
-- `draft` is deliberately absent — slices §2.2 row 1 makes `begin` client-side
-- only, so a draft row is a bug, not a state. This is NOT a vocabulary
-- ratification-by-migration like the one 0003 refuses for roles: these states
-- ARE ratified (ADR 0014, DECIDED 2026-08-16).
--
-- Token purposes are the two S4 mints; `verify_email` tokens MUST expire —
-- "random, opaque, hashed at rest, single-use, and expiring" (spec §4) — so
-- that word is a CHECK rather than a comment. `withdraw` carries no time
-- expiry (ASSUMPTION, resolver Jess: the withdrawal right dies with the
-- application's terminality; a time box would be an invented policy).

ALTER TABLE "application" ADD CONSTRAINT "application_status_fsm" CHECK (
	status in ('submitted', 'email_verified', 'claimed', 'tour_scheduled',
	           'approved', 'declined', 'withdrawn', 'expired')
);
--> statement-breakpoint
ALTER TABLE "application_email_token" ADD CONSTRAINT "application_email_token_purpose" CHECK (
	purpose in ('verify_email', 'withdraw')
);
--> statement-breakpoint
ALTER TABLE "application_email_token" ADD CONSTRAINT "application_email_token_verify_expires" CHECK (
	purpose <> 'verify_email' OR expires_at IS NOT NULL
);
--> statement-breakpoint

-- ─── Hand-written half 3: lifecycle enforced by the database (0003 doctrine) ──
--
-- Member v0 DELETES NOTHING: every retention period is the sitting #3 named
-- gate (spec §14 item 4; TIN-3440: retention periods "are a named human
-- ratification gate and are not hard-coded"). Until a period is ratified there
-- is no lawful delete path, so the runtime role simply does not hold DELETE —
-- enforced by grant AND by trigger (which binds the table owner too), the
-- member_role_grant/finance_receipt append-only doctrine.
--
--   application        keeps INSERT/SELECT and table-level UPDATE (the FSM's
--                      transitions rewrite status/version/timestamps and S5/S6
--                      continue them); loses DELETE.
--   application_email_token
--                      loses DELETE and table-level UPDATE; keeps a
--                      COLUMN-level UPDATE on consumed_at — the one write
--                      single-use consumption needs. The trigger makes
--                      consumption one-way (NULL -> NOT NULL, once) and every
--                      other column immutable, so a compromised runtime cannot
--                      un-consume, re-point, or re-date a credential row.
--
-- No GRANT of the base privileges is needed: 0002's ALTER DEFAULT PRIVILEGES
-- already hands gftb_app SELECT/INSERT/UPDATE/DELETE on tables later
-- migrations create; the REVOKEs below narrow that.

REVOKE DELETE ON "application" FROM gftb_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "application_email_token" FROM gftb_app;
--> statement-breakpoint
GRANT UPDATE ("consumed_at") ON "application_email_token" TO gftb_app;
--> statement-breakpoint
CREATE FUNCTION application_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'application rows are never deleted: retention periods are a named ratification gate (spec §14 item 4); terminal states are the only exit';
END
$$;
--> statement-breakpoint
CREATE TRIGGER application_no_delete
	BEFORE DELETE ON "application"
	FOR EACH ROW EXECUTE FUNCTION application_no_delete();
--> statement-breakpoint
CREATE FUNCTION application_email_token_single_use() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'application_email_token is append-only: tokens are consumed (consumed_at), never deleted';
	END IF;
	IF OLD.consumed_at IS NOT NULL THEN
		RAISE EXCEPTION 'application_email_token: a consumed token is immutable (single-use is one-way)';
	END IF;
	IF NEW.consumed_at IS NULL THEN
		RAISE EXCEPTION 'application_email_token: an update may only set consumed_at (consumption is the sole write)';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
		OR NEW.application_id IS DISTINCT FROM OLD.application_id
		OR NEW.purpose IS DISTINCT FROM OLD.purpose
		OR NEW.token_hash IS DISTINCT FROM OLD.token_hash
		OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'application_email_token: token fields are immutable; only consumed_at may change';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER application_email_token_single_use
	BEFORE UPDATE OR DELETE ON "application_email_token"
	FOR EACH ROW EXECUTE FUNCTION application_email_token_single_use();

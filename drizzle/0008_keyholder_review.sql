CREATE TABLE "application_claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"keyholder_person_id" uuid NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "application_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"decided_by" uuid NOT NULL,
	"reason_class" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_decision_one_per_application" UNIQUE("tenant_id","application_id")
);
--> statement-breakpoint
ALTER TABLE "application_claim" ADD CONSTRAINT "application_claim_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_claim" ADD CONSTRAINT "application_claim_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_decision" ADD CONSTRAINT "application_decision_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_decision" ADD CONSTRAINT "application_decision_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_claim_live_uniq" ON "application_claim" USING btree ("tenant_id","application_id") WHERE "application_claim"."released_at" is null;--> statement-breakpoint
CREATE INDEX "application_claim_keyholder" ON "application_claim" USING btree ("tenant_id","keyholder_person_id");
-- ─── Hand-written half: row-level security (TIN-3440 slice S5) ───────────────
--
-- Everything above the marker is `drizzle-kit generate` output for the
-- `application_claim` and `application_decision` declarations in schema.ts.
-- Everything below is hand-written for the 0002/0003/0007 reason: drizzle-kit
-- cannot emit FORCE ROW LEVEL SECURITY, and FORCE is the half that matters.
-- The guard against this block going missing is the pg_class/pg_policies
-- iteration in rls.integration.test.ts, which fails on ANY public-schema
-- table lacking ENABLE + FORCE + a policy. The policy text is byte-identical
-- to every other table's (see 0002 for the nullif and WITH CHECK rationale).

ALTER TABLE "application_claim" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "application_claim" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "application_claim_tenant" ON "application_claim"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "application_decision" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "application_decision" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "application_decision_tenant" ON "application_decision"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ─── Hand-written half 2: the ratified decision shapes as CHECKs ─────────────
--
-- `decision` admits exactly the two keyholder decisions of the ratified FSM
-- (spec §4: one keyholder may approve or decline after the in-person tour).
-- Withdrawal is the APPLICANT's transition and records no decision row, so
-- `withdrawn` is deliberately absent — like `draft` in 0007, its absence is
-- part of the shape. These states ARE ratified (ADR 0014), so a CHECK is not
-- a vocabulary-ratification-by-migration.
--
-- A declined decision MUST record a reason (TIN-3440 "must record a reason";
-- S5 acceptance: decline without a reason is rejected) — and an empty-string
-- reason is no reason. `reason_class` stays free TEXT: no decline-reason
-- vocabulary is ratified anywhere, and an enum here would invent one (the
-- 0003 role-vocabulary posture).

ALTER TABLE "application_decision" ADD CONSTRAINT "application_decision_kind" CHECK (
	decision in ('approved', 'declined')
);
--> statement-breakpoint
ALTER TABLE "application_decision" ADD CONSTRAINT "application_decision_declined_reason" CHECK (
	decision <> 'declined' OR (reason_class IS NOT NULL AND length(btrim(reason_class)) > 0)
);
--> statement-breakpoint

-- ─── Hand-written half 3: lifecycle enforced by the database (0003 doctrine) ──
--
-- Member v0 DELETES NOTHING (spec §14 item 4: retention is the sitting #3
-- named gate), and both review tables are HISTORY:
--
--   application_claim     loses DELETE and table-level UPDATE; keeps a
--                         COLUMN-level UPDATE on released_at — the one write
--                         the explicit operator un-claim path (slices §1.7
--                         rollback note) will need. The trigger makes release
--                         one-way (NULL -> NOT NULL, once) and every other
--                         column immutable — who claimed, and when, cannot be
--                         rewritten from the runtime.
--   application_decision  loses UPDATE and DELETE entirely; the trigger binds
--                         the table owner too. A decision is the audit record
--                         of the decisive act (TIN-3440's recorded reason
--                         lives here); it is immutable, full stop.
--
-- No GRANT of the base privileges is needed: 0002's ALTER DEFAULT PRIVILEGES
-- already hands gftb_app SELECT/INSERT/UPDATE/DELETE on tables later
-- migrations create; the REVOKEs below narrow that.

REVOKE UPDATE, DELETE ON "application_claim" FROM gftb_app;
--> statement-breakpoint
GRANT UPDATE ("released_at") ON "application_claim" TO gftb_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "application_decision" FROM gftb_app;
--> statement-breakpoint
CREATE FUNCTION application_claim_release_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'application_claim is append-only history: claims are released (released_at), never deleted';
	END IF;
	IF OLD.released_at IS NOT NULL THEN
		RAISE EXCEPTION 'application_claim: a released claim is immutable (release is one-way)';
	END IF;
	IF NEW.released_at IS NULL THEN
		RAISE EXCEPTION 'application_claim: an update may only set released_at (the explicit operator release)';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
		OR NEW.application_id IS DISTINCT FROM OLD.application_id
		OR NEW.keyholder_person_id IS DISTINCT FROM OLD.keyholder_person_id
		OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at THEN
		RAISE EXCEPTION 'application_claim: claim fields are immutable; only released_at may change';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER application_claim_release_only
	BEFORE UPDATE OR DELETE ON "application_claim"
	FOR EACH ROW EXECUTE FUNCTION application_claim_release_only();
--> statement-breakpoint
CREATE FUNCTION application_decision_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'application_decision is immutable: a recorded decision is the audit record and is never rewritten or deleted';
END
$$;
--> statement-breakpoint
CREATE TRIGGER application_decision_immutable
	BEFORE UPDATE OR DELETE ON "application_decision"
	FOR EACH ROW EXECUTE FUNCTION application_decision_immutable();

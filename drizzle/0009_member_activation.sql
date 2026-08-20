CREATE TABLE "agreement_version" (
	"tenant_id" uuid NOT NULL,
	"id" integer NOT NULL,
	"body_sha256" text NOT NULL,
	"body" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agreement_version_pkey" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "agreement_version_id_positive" CHECK ("agreement_version"."id" > 0)
);
--> statement-breakpoint
CREATE TABLE "assent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"agreement_version_id" integer NOT NULL,
	"assented_at" timestamp with time zone NOT NULL,
	CONSTRAINT "assent_one_per_membership" UNIQUE("tenant_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"event" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"result" text DEFAULT 'committed' NOT NULL,
	"agreement_version_id" integer,
	"reason_class" text,
	"reauth_at" timestamp with time zone,
	"token_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_event_actor" CHECK ("audit_event"."actor_type" in ('person', 'system', 'public')),
	CONSTRAINT "audit_event_actor_id_required" CHECK ("audit_event"."actor_type" <> 'person' or "audit_event"."actor_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"status" text DEFAULT 'pending_assent' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"agreement_version_id" integer,
	"activated_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_one_per_application" UNIQUE("tenant_id","application_id"),
	CONSTRAINT "membership_tenant_row_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"application_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"auth_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "person_one_per_application" UNIQUE("tenant_id","application_id"),
	CONSTRAINT "person_tenant_row_uniq" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "person_email" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agreement_version" ADD CONSTRAINT "agreement_version_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assent" ADD CONSTRAINT "assent_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assent" ADD CONSTRAINT "assent_membership_in_tenant_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."membership"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assent" ADD CONSTRAINT "assent_person_in_tenant_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."person"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assent" ADD CONSTRAINT "assent_agreement_in_tenant_fk" FOREIGN KEY ("tenant_id","agreement_version_id") REFERENCES "public"."agreement_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_event" ADD CONSTRAINT "audit_event_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_person_in_tenant_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."person"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_agreement_in_tenant_fk" FOREIGN KEY ("tenant_id","agreement_version_id") REFERENCES "public"."agreement_version"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person" ADD CONSTRAINT "person_application_id_application_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."application"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_email" ADD CONSTRAINT "person_email_tenant_id_tenant_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_email" ADD CONSTRAINT "person_email_person_in_tenant_fk" FOREIGN KEY ("tenant_id","person_id") REFERENCES "public"."person"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_aggregate" ON "audit_event" USING btree ("tenant_id","aggregate_type","aggregate_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_live_uniq" ON "membership" USING btree ("tenant_id","person_id") WHERE "membership"."status" not in ('left', 'removed');--> statement-breakpoint
CREATE INDEX "membership_status" ON "membership" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "person_auth_user_uniq" ON "person" USING btree ("tenant_id","auth_user_id") WHERE "person"."auth_user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "person_email_current_uniq" ON "person_email" USING btree ("tenant_id","person_id") WHERE "person_email"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "person_email_lookup" ON "person_email" USING btree ("tenant_id","email");-- ─── Hand-written half: row-level security (TIN-3440 slices S6/S7) ───────────
--
-- Everything above the marker is `drizzle-kit generate` output for the
-- `person`/`person_email`/`agreement_version`/`membership`/`assent`/
-- `audit_event` declarations in schema.ts. Everything below is hand-written
-- for the 0002/0003/0007/0008 reason: drizzle-kit cannot emit FORCE ROW LEVEL
-- SECURITY, and FORCE is the half that matters. The guard against this block
-- going missing is the pg_class/pg_policies iteration in
-- rls.integration.test.ts, which fails on ANY public-schema table lacking
-- ENABLE + FORCE + a policy. The policy text is byte-identical to every other
-- table's (see 0002 for the nullif and WITH CHECK rationale).

ALTER TABLE "person" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "person" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "person_tenant" ON "person"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "person_email" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "person_email" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "person_email_tenant" ON "person_email"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "agreement_version" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agreement_version" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agreement_version_tenant" ON "agreement_version"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "membership" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "membership" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "membership_tenant" ON "membership"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "assent" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "assent" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "assent_tenant" ON "assent"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "audit_event" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "audit_event" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_event_tenant" ON "audit_event"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ─── Hand-written half 2: the ratified state shapes as CHECKs ────────────────
--
-- `membership.status` admits exactly the five states of the ratified FSM
-- (spec §4: `pending_assent → active ↔ paused → left | removed`; ADR 0014 §4
-- outcome vocabulary). These states ARE ratified, so a CHECK is not a
-- vocabulary-ratification-by-migration (the 0008 decision-kind precedent).

ALTER TABLE "membership" ADD CONSTRAINT "membership_status_kind" CHECK (
	status in ('pending_assent', 'active', 'paused', 'left', 'removed')
);
--> statement-breakpoint

-- ─── Hand-written half 3: the activation token purpose (spec §4) ─────────────
--
-- "Initial access follows application approval and the application-owned
-- verification/reset flow" (spec §4 authentication baseline): the M1
-- activation bearer credential rides S4's token substrate, purpose
-- `activate`, minted at decision-email render time (S4's payload doctrine —
-- the outbox row carries no token). Like `verify_email`, an activation token
-- MUST expire; the figure is an ASSUMPTION recorded in
-- src/lib/server/application/tokens.ts (resolver Jess, sitting #2).

ALTER TABLE "application_email_token" DROP CONSTRAINT "application_email_token_purpose";
--> statement-breakpoint
ALTER TABLE "application_email_token" ADD CONSTRAINT "application_email_token_purpose" CHECK (
	purpose in ('verify_email', 'withdraw', 'activate')
);
--> statement-breakpoint
ALTER TABLE "application_email_token" ADD CONSTRAINT "application_email_token_activate_expires" CHECK (
	purpose <> 'activate' OR expires_at IS NOT NULL
);
--> statement-breakpoint

-- ─── Hand-written half 4: lifecycle enforced by the database (0003 doctrine) ──
--
-- Member v0 DELETES NOTHING (spec §14 item 4: retention is the sitting #3
-- named gate). Per table:
--
--   person             loses DELETE; UPDATE narrowed to the two runtime
--                      writes (auth_user_id at activation, display_name);
--                      identity columns immutable by trigger — `person_id` is
--                      an IMMUTABLE UUID (spec §4), structurally.
--   person_email       loses DELETE and table-level UPDATE; keeps a
--                      column-level UPDATE on superseded_at — supersession is
--                      one-way (NULL -> NOT NULL, once) and every other
--                      column immutable: history, not state.
--   agreement_version  loses UPDATE and DELETE entirely; the trigger binds
--                      the table owner too. `body_sha256` is immutable by
--                      definition (slices §1.8 ASSUMPTION) — a version whose
--                      text can be rewritten under a standing assent is not a
--                      version.
--   membership         loses DELETE; UPDATE flows through the transition
--                      functions, and the trigger pins the identity columns
--                      (id, tenant, person, application, created_at) so a
--                      transition can never rewrite WHO the membership is.
--   assent             loses UPDATE and DELETE entirely — the assent is the
--                      durable record of the assenting act.
--   audit_event        loses UPDATE and DELETE entirely — the audit spine is
--                      append-only, full stop.

REVOKE UPDATE, DELETE ON "person" FROM gftb_app;
--> statement-breakpoint
GRANT UPDATE ("auth_user_id", "display_name") ON "person" TO gftb_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "person_email" FROM gftb_app;
--> statement-breakpoint
GRANT UPDATE ("superseded_at") ON "person_email" TO gftb_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "agreement_version" FROM gftb_app;
--> statement-breakpoint
REVOKE DELETE ON "membership" FROM gftb_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "assent" FROM gftb_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON "audit_event" FROM gftb_app;
--> statement-breakpoint
CREATE FUNCTION person_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'person is permanent: Member v0 deletes nothing (retention is the sitting #3 gate)';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
		OR NEW.application_id IS DISTINCT FROM OLD.application_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'person: person_id and provenance are immutable (spec section 4 identifiers)';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER person_identity_immutable
	BEFORE UPDATE OR DELETE ON "person"
	FOR EACH ROW EXECUTE FUNCTION person_identity_immutable();
--> statement-breakpoint
CREATE FUNCTION person_email_supersede_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'person_email is append-only history: addresses are superseded, never deleted';
	END IF;
	IF OLD.superseded_at IS NOT NULL THEN
		RAISE EXCEPTION 'person_email: a superseded address is immutable (supersession is one-way)';
	END IF;
	IF NEW.superseded_at IS NULL THEN
		RAISE EXCEPTION 'person_email: an update may only set superseded_at (the email-change path)';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
		OR NEW.person_id IS DISTINCT FROM OLD.person_id
		OR NEW.email IS DISTINCT FROM OLD.email
		OR NEW.effective_from IS DISTINCT FROM OLD.effective_from THEN
		RAISE EXCEPTION 'person_email: history fields are immutable; only superseded_at may change';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER person_email_supersede_only
	BEFORE UPDATE OR DELETE ON "person_email"
	FOR EACH ROW EXECUTE FUNCTION person_email_supersede_only();
--> statement-breakpoint
CREATE FUNCTION agreement_version_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'agreement_version is append-only: a version under assent is never rewritten or deleted; publish a new version instead';
END
$$;
--> statement-breakpoint
CREATE TRIGGER agreement_version_immutable
	BEFORE UPDATE OR DELETE ON "agreement_version"
	FOR EACH ROW EXECUTE FUNCTION agreement_version_immutable();
--> statement-breakpoint
CREATE FUNCTION membership_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'membership is permanent history: offboarding is a transition, never a deletion';
	END IF;
	IF NEW.id IS DISTINCT FROM OLD.id
		OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
		OR NEW.person_id IS DISTINCT FROM OLD.person_id
		OR NEW.application_id IS DISTINCT FROM OLD.application_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'membership: identity columns are immutable; transitions change status, never who';
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER membership_identity_immutable
	BEFORE UPDATE OR DELETE ON "membership"
	FOR EACH ROW EXECUTE FUNCTION membership_identity_immutable();
--> statement-breakpoint
CREATE FUNCTION assent_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'assent is immutable: the record of the assenting act is never rewritten or deleted';
END
$$;
--> statement-breakpoint
CREATE TRIGGER assent_immutable
	BEFORE UPDATE OR DELETE ON "assent"
	FOR EACH ROW EXECUTE FUNCTION assent_immutable();
--> statement-breakpoint
CREATE FUNCTION audit_event_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'audit_event is append-only: the audit spine is never rewritten or deleted';
END
$$;
--> statement-breakpoint
CREATE TRIGGER audit_event_immutable
	BEFORE UPDATE OR DELETE ON "audit_event"
	FOR EACH ROW EXECUTE FUNCTION audit_event_immutable();

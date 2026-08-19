-- 0001 — auth.* schema, VENDORED from @tummycrypt/tinyland-auth-pg@0.2.4 (TIN-3817 slice S1).
--
-- WHY THIS IS COPIED RATHER THAN INVOKED.
-- The package ships its own drizzle/ journal. Running it alongside ours would
-- give this database TWO migration ledgers, and spec §6 requires exactly one
-- immutable filename+hash ledger. So the package's DDL is vendored here as an
-- ordinary numbered migration in OUR sequence, and the package's journal is
-- never invoked. S2's acceptance rows assert exactly that.
--
-- PROVENANCE (this is the receipt; re-verify with the two commands below).
--   package @tummycrypt/tinyland-auth-pg@0.2.4
--   file    drizzle/0000_lush_carmella_unuscione.sql
--   tarball https://registry.npmjs.org/@tummycrypt/tinyland-auth-pg/-/tinyland-auth-pg-0.2.4.tgz
--   sha256 of that source file, on its own line so it reads as a digest rather
--   than as an assignment:
--     98c9942ec60503d697ccaa8e435cd968cced0af178af50fbbb78e76c6379facb
--
--   npm pack @tummycrypt/tinyland-auth-pg@0.2.4
--   tar -xOzf tinyland-auth-pg-0.2.4.tgz package/drizzle/0000_lush_carmella_unuscione.sql | shasum -a 256
--
-- The block between the BEGIN/END VENDORED markers is byte-identical to that
-- file (trailing whitespace trimmed). Do not hand-edit it: re-vendor from a new
-- package version as a NEW migration instead, because this one is already in
-- the ledger and its hash is immutable.
--
-- WHAT THE PACKAGE OMITS (spec §1.3, finding M11).
-- All six tables carry tenant_id — and the package ships ZERO row-level
-- security statements for them (grep -c 'row level security|create policy' on
-- the source file returns 0). Session and user rows would therefore sit outside
-- the isolation the rest of this slice builds. The second half of this file
-- adds ENABLE + FORCE + the same USING/WITH CHECK policy every first-party
-- table gets. FORCE matters most here: without it the table owner — the
-- migration role — reads every tenant's sessions.

-- ─── BEGIN VENDORED @tummycrypt/tinyland-auth-pg@0.2.4 ───────────────────────
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TABLE "auth"."audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" varchar(64) NOT NULL,
	"user_id" uuid,
	"target_user_id" uuid,
	"handle" varchar(64),
	"ip_address" varchar(45),
	"user_agent" text,
	"details" jsonb NOT NULL,
	"severity" varchar(16) DEFAULT 'info' NOT NULL,
	"source" varchar(16) DEFAULT 'system' NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."backup_codes" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"codes" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	CONSTRAINT "backup_codes_tenant_id_user_id_pk" PRIMARY KEY("tenant_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(32) NOT NULL,
	"created_by" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"used_by" uuid,
	"temporary_totp_secret" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires" timestamp NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"user_data" jsonb,
	"client_ip" varchar(45) DEFAULT 'unknown' NOT NULL,
	"client_ip_masked" varchar(45),
	"user_agent" text DEFAULT 'unknown' NOT NULL,
	"device_type" varchar(16) DEFAULT 'unknown',
	"browser_fingerprint" text,
	"geo_location" jsonb,
	"temp_totp_secret" text,
	"temp_totp_expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "auth"."totp_secrets" (
	"tenant_id" uuid NOT NULL,
	"handle" varchar(64) NOT NULL,
	"user_id" varchar(128) NOT NULL,
	"encrypted_secret" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"salt" text NOT NULL,
	"backup_codes_generated" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "totp_secrets_tenant_id_handle_pk" PRIMARY KEY("tenant_id","handle")
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"handle" varchar(64) NOT NULL,
	"email" varchar(255) NOT NULL,
	"display_name" varchar(128),
	"password_hash" text NOT NULL,
	"role" varchar(32) DEFAULT 'viewer' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_locked" boolean DEFAULT false,
	"lock_reason" text,
	"locked_at" timestamp,
	"needs_onboarding" boolean DEFAULT true NOT NULL,
	"onboarding_step" integer DEFAULT 0 NOT NULL,
	"first_login" boolean DEFAULT true,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_secret_id" varchar(128),
	"permissions" jsonb,
	"bio" text,
	"avatar_url" text,
	"pronouns" varchar(32),
	"timezone" varchar(64),
	"locale" varchar(16),
	"theme" varchar(8),
	"email_notifications" boolean DEFAULT true,
	"login_attempts" integer DEFAULT 0,
	"last_failed_login_at" timestamp,
	"last_login_at" timestamp,
	"password_changed_at" timestamp,
	"ip_address" varchar(45),
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."backup_codes" ADD CONSTRAINT "backup_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."invitations" ADD CONSTRAINT "invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_idx" ON "auth"."audit_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "backup_codes_tenant_idx" ON "auth"."backup_codes" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_tenant_token_unique" ON "auth"."invitations" USING btree ("tenant_id","token");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "auth"."invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sessions_tenant_idx" ON "auth"."sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "totp_secrets_tenant_idx" ON "auth"."totp_secrets" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_handle_unique" ON "auth"."users" USING btree ("tenant_id","handle");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_unique" ON "auth"."users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE INDEX "users_tenant_idx" ON "auth"."users" USING btree ("tenant_id");
--> statement-breakpoint
-- ─── END VENDORED ────────────────────────────────────────────────────────────

-- Row-level security for the six vendored tables (spec §1.3 M11).
-- nullif(…, '') is load-bearing: current_setting(…, true) yields the EMPTY
-- STRING for a GUC that was set and then reset in the session, and ''::uuid
-- RAISES rather than yielding NULL. Without the nullif a reset GUC turns every
-- query into an error instead of an empty result.
-- The explicit WITH CHECK is load-bearing too: a USING-only policy silently
-- permits an INSERT that writes another tenant's tenant_id.
ALTER TABLE "auth"."audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth"."audit_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "audit_events_tenant" ON "auth"."audit_events"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "auth"."backup_codes" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth"."backup_codes" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "backup_codes_tenant" ON "auth"."backup_codes"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "auth"."invitations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth"."invitations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "invitations_tenant" ON "auth"."invitations"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "auth"."sessions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth"."sessions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "sessions_tenant" ON "auth"."sessions"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "auth"."totp_secrets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth"."totp_secrets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "totp_secrets_tenant" ON "auth"."totp_secrets"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "auth"."users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "auth"."users" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "users_tenant" ON "auth"."users"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

-- 0002 — row-level security, FORCE, and the DML-only runtime role (TIN-3817 slice S1).
--
-- WHY THIS DDL IS HAND-WRITTEN AND NOT GENERATED.
-- drizzle-kit@0.30 can emit ENABLE ROW LEVEL SECURITY and CREATE POLICY, but it
-- cannot emit FORCE ROW LEVEL SECURITY — and FORCE is the half that matters,
-- because without it the table owner (the migration role) bypasses every policy
-- and the isolation is decorative. Declaring half the story in schema.ts and
-- half here would split the source of truth and leave `drizzle-kit generate`
-- diffing against a shape the database does not have. So ALL of it is here, and
-- the guard against a future table shipping unprotected is a pg_class
-- assertion in rls.integration.test.ts, not a promise in a comment.
--
-- THE POLICY, AND WHY IT IS WRITTEN EXACTLY THIS WAY (spec §1.3).
--   nullif(current_setting('app.tenant_id', true), '')::uuid
--     current_setting(…, true) returns the EMPTY STRING — not NULL — for a GUC
--     that was SET and then reset within a session, and ''::uuid RAISES rather
--     than yielding NULL. Without the nullif, a session that has finished with
--     one tenant turns every subsequent query into an error instead of an empty
--     result. With it, an unset GUC makes the predicate NULL, which denies.
--   WITH CHECK, stated explicitly and identically
--     A USING-only policy silently permits an INSERT that writes another
--     tenant's tenant_id. Reads would then be isolated and writes would not,
--     which is the worst of the three possible states.
--
-- SEEDING A TENANT. Because `tenant` is itself under the policy, the first row
-- must be inserted by a session that has already declared the id it is about to
-- write:
--     set local app.tenant_id = '<uuid>';
--     insert into tenant (tenant_id, slug, display_name) values ('<uuid>', …);
-- That is a feature: no session can conjure a tenant whose id it did not name.

ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_tenant" ON "tenant"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "outbox_job" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "outbox_job" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "outbox_job_tenant" ON "outbox_job"
	USING      (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
	WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
--> statement-breakpoint

-- ─── The DML-only runtime role ───────────────────────────────────────────────
--
-- Spec §6 requires the runtime role to be separate from the migration role and
-- to hold DML only: `web` and `worker` connect as gftb_app and can read and
-- write rows; they cannot create, alter, or drop anything, and no pod migrates
-- on startup.
--
-- CREATED HERE, CREDENTIALED ELSEWHERE. The role is created NOLOGIN and with no
-- password, because this repository is public and owns no secret (ADR 0014
-- §0.2). `great-falls-tool-bus-infra` grants LOGIN and the credential. If infra
-- has already provisioned the role, the block below finds it and skips — so the
-- migration credential needs CREATEROLE only on a cluster where the role does
-- not exist yet.
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'gftb_app') THEN
		EXECUTE 'CREATE ROLE gftb_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS';
		RAISE NOTICE 'created runtime role gftb_app (NOLOGIN); infra owns the login credential';
	END IF;
END
$$;
--> statement-breakpoint

-- Fail closed if the runtime role can see past the policies. A role carrying
-- SUPERUSER or BYPASSRLS makes every assertion in this file cosmetic, and that
-- is precisely the misconfiguration nobody notices until a cross-tenant read
-- succeeds in production.
DO $$
DECLARE
	is_super boolean;
	is_bypass boolean;
BEGIN
	SELECT rolsuper, rolbypassrls INTO is_super, is_bypass
	  FROM pg_catalog.pg_roles WHERE rolname = 'gftb_app';
	IF is_super THEN
		RAISE EXCEPTION 'runtime role gftb_app is SUPERUSER; row-level security cannot constrain it';
	END IF;
	IF is_bypass THEN
		RAISE EXCEPTION 'runtime role gftb_app has BYPASSRLS; row-level security cannot constrain it';
	END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA "public" TO gftb_app;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "auth" TO gftb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "public" TO gftb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "auth" TO gftb_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "public" TO gftb_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "auth" TO gftb_app;
--> statement-breakpoint

-- Tables a LATER migration creates get the same DML and nothing else, so the
-- next slice cannot accidentally ship a table the runtime role cannot read —
-- or one it can reshape.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gftb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "auth" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO gftb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT USAGE, SELECT ON SEQUENCES TO gftb_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "auth" GRANT USAGE, SELECT ON SEQUENCES TO gftb_app;
--> statement-breakpoint

-- DDL is not the runtime role's to issue. PostgreSQL 15+ already withholds
-- CREATE on `public` from PUBLIC; both statements are stated anyway so the
-- intent survives a restore onto an older cluster or a hand-loosened database.
REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "public" FROM gftb_app;
--> statement-breakpoint
REVOKE CREATE ON SCHEMA "auth" FROM gftb_app;
--> statement-breakpoint

-- The migration ledger is not tenant data and has no policy. Instead the
-- runtime role holds no privilege on it whatsoever, which is stronger: there is
-- no statement gftb_app can issue that reads or writes migration history.
REVOKE ALL ON SCHEMA "migration" FROM gftb_app;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA "migration" FROM gftb_app;

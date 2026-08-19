/**
 * PostgreSQL fixture for the S1 integration suite (TIN-3817).
 *
 * Runs only under `just test-integration`; it is never imported by application
 * code and never reached by the default `vitest` include.
 *
 * WHY THIS BUILDS THREE ROLES INSTEAD OF USING THE SERVER SUPERUSER.
 * A superuser bypasses row-level security unconditionally. A suite that
 * asserted "cross-tenant read returns zero rows" as `postgres` would pass on a
 * database with no policies at all — it would be the specific shape of green
 * that proves nothing. So the fixture reproduces the production role split
 * spec §6 requires:
 *
 *   postgres       superuser — used ONLY to build the fixture
 *   gftb_migrator  the migration credential; owns the tables, NOSUPERUSER,
 *                  NOBYPASSRLS, so FORCE ROW LEVEL SECURITY genuinely binds it
 *   gftb_app       the DML-only runtime role the migration itself creates
 *
 * Every assertion about isolation runs as one of the latter two.
 *
 * TWO WAYS TO GET A SERVER, and the reason there are two.
 * The default is a `postgres:16.15` testcontainer, which is the version
 * TIN-3817 acceptance row 1 narrows CNPG to. But this org's ARC pool advertises
 * only `tinyland-nix` and has no dind runner, and the operator's macOS host
 * runs no daemon either — so a container-only fixture would mean these rows are
 * never executed anywhere, by anyone, until the runner situation changes.
 * `GFTB_TEST_PG_SUPERUSER_DSN` therefore points the same suite at an already-
 * running server, creating and dropping a throwaway database per fixture. That
 * path proves the SQL, the policies, and the lock; it does NOT prove the 16.15
 * pin, because it runs whatever the host has. Both facts belong in the PR body.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { RUNTIME_ROLE } from './constants';

/**
 * PostgreSQL 16.15 — the exact version TIN-3817 acceptance row 1 narrows CNPG
 * to. Pinned rather than floated on `16`: "tested on 16" and "runs on 16.15"
 * are different claims, and only the second is the one the ticket makes.
 */
export const PG_IMAGE = 'postgres:16.15';

export const MIGRATION_ROLE = 'gftb_migrator';

/** Name only — the value is the operator's, and never enters this repository. */
export const EXTERNAL_DSN_ENV = 'GFTB_TEST_PG_SUPERUSER_DSN';

/** Repo-root `drizzle/`, resolved from this module rather than from cwd. */
export const MIGRATIONS_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'..',
	'..',
	'..',
	'drizzle',
);

export interface PgFixture {
	/** Superuser DSN. Fixture construction only — never an assertion subject. */
	superuserDsn: string;
	/** The migration credential: owns the schema, but cannot bypass RLS. */
	migratorDsn: string;
	/** The DML-only runtime credential. */
	runtimeDsn: string;
	/** How the server was obtained, for the suite to report honestly. */
	provenance: 'testcontainer' | 'external';
	stop: () => Promise<void>;
}

function withDatabase(dsn: string, database: string, user?: string, password?: string): string {
	const url = new URL(dsn);
	url.pathname = `/${database}`;
	if (user !== undefined) url.username = encodeURIComponent(user);
	if (password !== undefined) url.password = encodeURIComponent(password);
	return url.toString();
}

/** Run statements on one short-lived connection. */
export async function exec(dsn: string, statements: string[]): Promise<void> {
	const client = new pg.Client({ connectionString: dsn });
	await client.connect();
	try {
		for (const statement of statements) await client.query(statement);
	} finally {
		await client.end();
	}
}

/** One query, one connection, rows back. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
	dsn: string,
	sql: string,
	params: unknown[] = [],
): Promise<T[]> {
	const client = new pg.Client({ connectionString: dsn });
	await client.connect();
	try {
		const { rows } = await client.query<T>(sql, params);
		return rows;
	} finally {
		await client.end();
	}
}

/**
 * Open a session pinned to one tenant for the life of the connection.
 *
 * `set_config(…, false)` — session scope, not transaction scope — because
 * several assertions issue more than one statement and are about what a
 * connection can see, not about what a transaction can see. Application code
 * uses the transaction-scoped `withTenant` instead; both read the same GUC.
 */
export async function asTenant<T>(
	dsn: string,
	tenantId: string | null,
	fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
	const client = new pg.Client({ connectionString: dsn });
	await client.connect();
	try {
		if (tenantId !== null) await client.query('select set_config($1, $2, false)', ['app.tenant_id', tenantId]);
		return await fn(client);
	} finally {
		await client.end();
	}
}

/**
 * Give `gftb_migrator` what a migration credential needs in one database:
 * ownership of `public` so it can create tables there, and CREATE on the
 * database so it can create the `auth` and `migration` schemas. CREATEROLE is
 * cluster-level and granted once, so migration 0002 can create the runtime role
 * on a cluster where infra has not pre-provisioned it — the harder of the two
 * production paths, and therefore the one worth exercising.
 */
async function prepareDatabase(superuserDsn: string, database: string, migratorPassword: string): Promise<void> {
	await exec(superuserDsn, [
		`do $$ begin
			if not exists (select 1 from pg_catalog.pg_roles where rolname = '${MIGRATION_ROLE}') then
				execute format('create role %I login nosuperuser nobypassrls createrole', '${MIGRATION_ROLE}');
			end if;
		end $$`,
		`alter role ${MIGRATION_ROLE} login password '${migratorPassword}' nosuperuser nobypassrls createrole`,
		`grant create on database "${database}" to ${MIGRATION_ROLE}`,
		`alter schema public owner to ${MIGRATION_ROLE}`,
	]);
}

/** Start PostgreSQL 16.15 in a container and build the role split. */
async function startContainer(): Promise<PgFixture> {
	const container = await new PostgreSqlContainer(PG_IMAGE).start();
	const superuserDsn = container.getConnectionUri();
	// Ephemeral, generated per run, never written to disk or logged. This
	// repository is public and ships no credential, not even a throwaway one.
	const migratorPassword = randomUUID();
	const runtimePassword = randomUUID();

	await prepareDatabase(superuserDsn, container.getDatabase(), migratorPassword);

	return {
		superuserDsn,
		migratorDsn: withDatabase(superuserDsn, container.getDatabase(), MIGRATION_ROLE, migratorPassword),
		runtimeDsn: withDatabase(superuserDsn, container.getDatabase(), RUNTIME_ROLE, runtimePassword),
		provenance: 'testcontainer',
		stop: async () => {
			await container.stop();
		},
	};
}

/** Carve a throwaway database out of an already-running server. */
async function startExternal(adminDsn: string): Promise<PgFixture> {
	const database = `gftb_it_${randomUUID().replace(/-/g, '')}`;
	const migratorPassword = randomUUID();
	const runtimePassword = randomUUID();

	await exec(adminDsn, [
		`create database "${database}"`,
		// Roles are CLUSTER-scoped while databases are not, so on a reused server
		// gftb_app survives every previous fixture — including the LOGIN that
		// `credentialRuntimeRole` granted it. Reset it, or the "created NOLOGIN by
		// the migration" assertion would pass on the first run of a fresh server
		// and fail on the second, which is the worst kind of test.
		`do $$ begin
			if exists (select 1 from pg_catalog.pg_roles where rolname = '${RUNTIME_ROLE}') then
				execute format('alter role %I nologin', '${RUNTIME_ROLE}');
			end if;
		end $$`,
	]);
	const superuserDsn = withDatabase(adminDsn, database);
	await prepareDatabase(superuserDsn, database, migratorPassword);

	return {
		superuserDsn,
		migratorDsn: withDatabase(superuserDsn, database, MIGRATION_ROLE, migratorPassword),
		runtimeDsn: withDatabase(superuserDsn, database, RUNTIME_ROLE, runtimePassword),
		provenance: 'external',
		stop: async () => {
			// Terminate first: an open pool would make DROP DATABASE hang, and a
			// hung teardown looks exactly like a hung test.
			await exec(adminDsn, [
				`select pg_terminate_backend(pid) from pg_stat_activity where datname = '${database}' and pid <> pg_backend_pid()`,
				`drop database if exists "${database}"`,
			]);
		},
	};
}

export async function startPostgres(): Promise<PgFixture> {
	const external = process.env[EXTERNAL_DSN_ENV]?.trim();
	return external ? startExternal(external) : startContainer();
}

/**
 * Grant the runtime role a login, the way `great-falls-tool-bus-infra` does
 * after the migration has created it. Call AFTER the migrator has run — before
 * that the role does not exist, which is itself the point: the repository never
 * carries the credential.
 */
export async function credentialRuntimeRole(fixture: PgFixture): Promise<void> {
	const password = decodeURIComponent(new URL(fixture.runtimeDsn).password);
	await exec(fixture.superuserDsn, [`alter role ${RUNTIME_ROLE} login password '${password}'`]);
}

/**
 * Insert a tenant row.
 *
 * The GUC must be set to the id being written, because `tenant` is under the
 * same policy as everything else and its WITH CHECK compares against the row's
 * own primary key. No session can conjure a tenant whose id it did not name.
 */
export async function seedTenant(dsn: string, slug: string): Promise<string> {
	const tenantId = randomUUID();
	await asTenant(dsn, tenantId, async (client) => {
		await client.query('insert into tenant (tenant_id, slug, display_name) values ($1, $2, $3)', [
			tenantId,
			slug,
			`Fixture tenant ${slug}`,
		]);
	});
	return tenantId;
}

/** Enqueue one outbox row for `tenantId`, as that tenant. */
export async function seedOutboxJob(dsn: string, tenantId: string, kind = 'fixture.noop'): Promise<string> {
	return asTenant(dsn, tenantId, async (client) => {
		const { rows } = await client.query<{ id: string }>(
			`insert into outbox_job (tenant_id, kind, aggregate_type, aggregate_id, payload, idempotency_key)
			 values ($1, $2, 'fixture', gen_random_uuid(), '{}'::jsonb, $3)
			 returning id`,
			[tenantId, kind, randomUUID()],
		);
		return rows[0].id;
	});
}

/**
 * Mechanical access to `member_role_grant` (TIN-3817 slice S2).
 *
 * ⚠ PENDING RATIFICATION — the role MODEL (which roles exist, what each may
 * do, `steward` omitted) is sitting #2 Item 2 (`meta`
 * `spec/sitting-2-packet-2026-08-22.md`, staged in meta PR #24). The
 * executable-slices spec §1.4 drafts it as an AMENDMENT, explicitly "drafted,
 * not ratified". This file therefore ships exactly the packet's "mechanical
 * half": rows in, rows revoked, rows read — and NO policy:
 *
 *   - `role` is an opaque string here. No enum, no allow-list, no constant
 *     naming the drafted vocabulary — encoding `member`/`keyholder`/`finance`
 *     (or `steward`'s absence) in code would pre-empt the ruling.
 *   - No capability semantics. Nothing here answers "may this keyholder
 *     approve" (S5's, post-ratification) or "may this session read amounts"
 *     (S8's, blocked on the same ruling per slices §6.4).
 *   - Grants are orthogonal to membership state by SHAPE (the drafted model's
 *     one structural commitment, already load-bearing for the table's
 *     uniqueness rules): nothing joins membership here, so a person can hold
 *     a grant while `paused` — or the sitting can rule otherwise without a
 *     schema change.
 *
 * History is append-only: revocation sets `revoked_at`, never deletes, and a
 * re-grant after revocation is a NEW row (the partial unique index constrains
 * live grants only).
 *
 * APPEND-ONLY IS ENFORCED IN THE DATABASE, not by this file's discipline
 * (PR #175 adversarial review proved the earlier claim was convention: the
 * runtime role held blanket UPDATE/DELETE). Migration 0003's hardening block
 * revokes DELETE and table-level UPDATE from `gftb_app`, grants UPDATE on
 * `revoked_at` alone, and installs a trigger that binds EVERY role — table
 * owner included — to: no deletes, revocation one-way (NULL → NOT NULL,
 * once), all other columns immutable. S5 can hang keyholder authorization on
 * these rows knowing the audit trail cannot be rewritten from the runtime.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { DbTransaction } from '$lib/server/db/client';
import { memberRoleGrant, type MemberRoleGrant } from '$lib/server/db/schema';
import { AuthError } from './session';

export interface GrantInput {
	personId: string;
	role: string;
	grantedBy: string;
}

/**
 * Grant `role` to `personId`. Idempotent on a live grant: granting what is
 * already held returns the existing row instead of erroring, so a retried
 * request converges rather than 500s.
 *
 * CONVERGENT UNDER CONCURRENCY, not merely under retry (PR #175 review nit:
 * the original check-then-insert raised a unique violation when two grants
 * raced). `ON CONFLICT DO NOTHING` makes the loser's insert a no-op against
 * the partial live-grant index; the follow-up select then reads the winner's
 * committed row. Insert-first also removes the TOCTOU window the read-first
 * version had.
 */
export async function grantRole(tx: DbTransaction, tenantId: string, input: GrantInput): Promise<MemberRoleGrant> {
	const inserted = await tx
		.insert(memberRoleGrant)
		.values({
			tenantId,
			personId: input.personId,
			role: input.role,
			grantedBy: input.grantedBy,
		})
		.onConflictDoNothing()
		.returning();
	if (inserted[0]) return inserted[0];

	const existing = await tx
		.select()
		.from(memberRoleGrant)
		.where(
			and(
				eq(memberRoleGrant.tenantId, tenantId),
				eq(memberRoleGrant.personId, input.personId),
				eq(memberRoleGrant.role, input.role),
				isNull(memberRoleGrant.revokedAt),
			),
		)
		.limit(1);
	if (existing[0]) return existing[0];

	// A conflict was reported yet no live grant is readable: the winner was
	// revoked (or filtered) between our two statements. Retryable, and said so.
	throw new AuthError(409, 'grant_conflict', 'Concurrent grant change; retry the grant.');
}

/**
 * Revoke a live grant by setting `revoked_at`. Returns the revoked row, or
 * `null` when no live grant existed — idempotent, like `grantRole`.
 */
export async function revokeRole(
	tx: DbTransaction,
	tenantId: string,
	personId: string,
	role: string,
): Promise<MemberRoleGrant | null> {
	const revoked = await tx
		.update(memberRoleGrant)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(memberRoleGrant.tenantId, tenantId),
				eq(memberRoleGrant.personId, personId),
				eq(memberRoleGrant.role, role),
				isNull(memberRoleGrant.revokedAt),
			),
		)
		.returning();
	return revoked[0] ?? null;
}

/** Every live grant a person holds. Revoked history is excluded. */
export async function activeRoles(tx: DbTransaction, tenantId: string, personId: string): Promise<MemberRoleGrant[]> {
	return tx
		.select()
		.from(memberRoleGrant)
		.where(
			and(
				eq(memberRoleGrant.tenantId, tenantId),
				eq(memberRoleGrant.personId, personId),
				isNull(memberRoleGrant.revokedAt),
			),
		);
}

/**
 * Does this person hold a live grant of `role`? The check every future
 * authorization guard composes; per spec §6 the caller must run it IN THE
 * SAME UNIT OF WORK as the action it authorizes — which is exactly what
 * taking the `tx` handle forces.
 */
export async function hasRole(tx: DbTransaction, tenantId: string, personId: string, role: string): Promise<boolean> {
	const rows = await tx
		.select({ id: memberRoleGrant.id })
		.from(memberRoleGrant)
		.where(
			and(
				eq(memberRoleGrant.tenantId, tenantId),
				eq(memberRoleGrant.personId, personId),
				eq(memberRoleGrant.role, role),
				isNull(memberRoleGrant.revokedAt),
			),
		)
		.limit(1);
	return rows.length > 0;
}

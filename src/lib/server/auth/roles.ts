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
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { DbTransaction } from '$lib/server/db/client';
import { memberRoleGrant, type MemberRoleGrant } from '$lib/server/db/schema';

export interface GrantInput {
	personId: string;
	role: string;
	grantedBy: string;
}

/**
 * Grant `role` to `personId`. Idempotent on a live grant: granting what is
 * already held returns the existing row instead of erroring, so a retried
 * request converges rather than 500s.
 */
export async function grantRole(tx: DbTransaction, tenantId: string, input: GrantInput): Promise<MemberRoleGrant> {
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

	const inserted = await tx
		.insert(memberRoleGrant)
		.values({
			tenantId,
			personId: input.personId,
			role: input.role,
			grantedBy: input.grantedBy,
		})
		.returning();
	return inserted[0];
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

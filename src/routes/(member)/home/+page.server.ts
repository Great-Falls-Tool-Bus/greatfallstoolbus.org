/**
 * `/home` — the member's post-activation home (TIN-3818 slice S7).
 *
 * The page a just-activated member lands on: their membership status, the
 * VERSIONED agreement they assented to (S6's `assent` row joined to the
 * `agreement_version` body — ADR 0016 §2.3: the agreement is a separable,
 * versioned record, so the page shows the exact version assented to, never
 * "the latest text"), and the OPTIONAL contribution offer as a doorway —
 * the offer itself lives at `/contribution`, downstream of membership
 * authority (member-projection-flow.mmd hangs it off Active), and skipping
 * it entirely is valid (ADR 0014 §4: "a person may choose $0 and remain
 * eligible" — or choose nothing at all).
 *
 * READ-ONLY: this load mutates nothing. The `?checkout=success` return from
 * a hosted Checkout bounce is informational only and is not even read here —
 * durable contribution state moves exclusively via the webhook inbox
 * (ADR 0016 §3; spec §5 "Success-page redirects … never activate durable
 * state").
 *
 * The member sees their OWN contribution state (spec §5:216–220 vocabulary)
 * — their data, their session. No keyholder surface serves this shape;
 * keyholders get exactly `{ offered, helpRequested }` (spec §5:222–225).
 */

import { eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { withTenant } from '$lib/server/db/tenant';
import { assent, membership } from '$lib/server/db/schema';
import { personByAuthUser } from '$lib/server/membership/activate';
import { agreementVersionById } from '$lib/server/membership/agreement';
import { canBorrow } from '$lib/server/membership/transition';
import { getAgreement } from '$lib/server/contribution/agreement';
import { memberContributionView } from '$lib/server/contribution/offer';
import type { PageServerLoad } from './$types';

export const prerender = false;

export interface HomeSeams {
	env?: NodeJS.ProcessEnv;
}

export function _createHomeLoad(seams: HomeSeams = {}) {
	const env = seams.env ?? process.env;

	return async (event: RequestEvent) => {
		const tenantId = env.GFTB_TENANT_ID?.trim();
		if (!tenantId || !env.DATABASE_URL?.trim()) {
			return { available: false as const, authenticated: false as const, member: null };
		}
		const session = event.locals.authSession;
		if (!session) return { available: true as const, authenticated: false as const, member: null };
		try {
			const member = await withTenant(tenantId, async (tx) => {
				const person = await personByAuthUser(tx, session.userId);
				if (!person) return null;
				const memberships = await tx
					.select()
					.from(membership)
					.where(eq(membership.personId, person.id))
					.orderBy(membership.createdAt);
				const latest = memberships.at(-1);
				if (!latest) return null;

				// The assent row is unique per membership (S6); join it to the
				// exact agreement version body it named.
				const [assentRow] = await tx.select().from(assent).where(eq(assent.membershipId, latest.id)).limit(1);
				const agreementVersion = assentRow ? await agreementVersionById(tx, assentRow.agreementVersionId) : null;

				const contribution = memberContributionView(await getAgreement(tx, person.id));

				return {
					displayName: person.displayName,
					membership: {
						status: latest.status,
						canBorrow: canBorrow(latest),
						activatedAt: latest.activatedAt?.toISOString() ?? null,
					},
					agreement:
						assentRow && agreementVersion
							? {
									versionId: agreementVersion.id,
									body: agreementVersion.body,
									assentedAt: assentRow.assentedAt.toISOString(),
								}
							: null,
					contribution,
				};
			});
			return { available: true as const, authenticated: true as const, member };
		} catch (error) {
			console.error('[home] load refused:', error instanceof Error ? error.message : error);
			return { available: true as const, authenticated: false as const, member: null };
		}
	};
}

export const load: PageServerLoad = _createHomeLoad();

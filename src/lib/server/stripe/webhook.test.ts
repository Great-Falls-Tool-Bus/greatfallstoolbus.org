/**
 * The verify → livemode-reject → persist → ack order, without a database
 * (TIN-3818; slices §3.2). The persist seam is injected; the integration
 * suite runs the same handler against real RLS-bearing tables.
 */

import { describe, expect, it } from 'vitest';
import { signPayloadForTest } from './client';
import type { StripeWebhookSecret } from './config';
import { readFixtureEventRaw } from './fixtures';
import { handleStripeWebhook } from './webhook';

const WHSEC = ('whsec_' + 'unit_webhook_secret_0001') as StripeWebhookSecret;
const TENANT = '22222222-2222-4222-8222-222222222222';

function persistSpy() {
	const persisted: string[] = [];
	return {
		persisted,
		persist: async (event: { id: string }) => {
			persisted.push(event.id);
			return { inserted: true };
		},
	};
}

describe('handleStripeWebhook', () => {
	it('acks a correctly signed test-mode event AFTER persisting it', async () => {
		const raw = readFixtureEventRaw('03-invoice-paid.json');
		const { persisted, persist } = persistSpy();
		const response = await handleStripeWebhook(
			{ rawBody: raw, signatureHeader: signPayloadForTest(raw, WHSEC) },
			{ webhookSecret: WHSEC, tenantId: TENANT, persist },
		);
		expect(response.status).toBe(200);
		expect(persisted).toEqual(['evt_gftb_fx_0003']);
	});

	it('400s a missing signature header and persists nothing', async () => {
		const raw = readFixtureEventRaw('03-invoice-paid.json');
		const { persisted, persist } = persistSpy();
		const response = await handleStripeWebhook(
			{ rawBody: raw, signatureHeader: null },
			{ webhookSecret: WHSEC, tenantId: TENANT, persist },
		);
		expect(response.status).toBe(400);
		expect(persisted).toEqual([]);
	});

	it('400s a tampered body and persists nothing', async () => {
		const raw = readFixtureEventRaw('03-invoice-paid.json');
		const header = signPayloadForTest(raw, WHSEC);
		const { persisted, persist } = persistSpy();
		const response = await handleStripeWebhook(
			{ rawBody: raw.replace('"amount_paid": 1000', '"amount_paid": 9000'), signatureHeader: header },
			{ webhookSecret: WHSEC, tenantId: TENANT, persist },
		);
		expect(response.status).toBe(400);
		expect(persisted).toEqual([]);
	});

	it('400s a CORRECTLY SIGNED live-mode event — the second refusal is independent of key shape', async () => {
		// Flip the fixture to livemode true and re-sign it, so the ONLY thing
		// wrong with the delivery is liveness.
		const live = readFixtureEventRaw('03-invoice-paid.json').replace('"livemode": false', '"livemode": true');
		const { persisted, persist } = persistSpy();
		const response = await handleStripeWebhook(
			{ rawBody: live, signatureHeader: signPayloadForTest(live, WHSEC) },
			{ webhookSecret: WHSEC, tenantId: TENANT, persist },
		);
		expect(response.status).toBe(400);
		expect(response.body.error).toContain('live');
		expect(persisted).toEqual([]);
	});

	it('acks a duplicate delivery too — durability, not processing, satisfies Stripe', async () => {
		const raw = readFixtureEventRaw('03-invoice-paid.json');
		const header = signPayloadForTest(raw, WHSEC);
		const response = await handleStripeWebhook(
			{ rawBody: raw, signatureHeader: header },
			{ webhookSecret: WHSEC, tenantId: TENANT, persist: async () => ({ inserted: false }) },
		);
		expect(response.status).toBe(200);
	});
});

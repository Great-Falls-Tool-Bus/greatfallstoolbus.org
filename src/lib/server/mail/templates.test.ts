/**
 * The three application mail templates (TIN-4062). Pure, no database.
 *
 * WHAT THIS PINS: all three ship `approved: false` — spec provides no email
 * body copy for any of the three kinds — and every rendered subject/body
 * carries the TODO marker so an accidental send (were the approval gate ever
 * bypassed) could never be mistaken for ratified operator wording.
 */

import { describe, expect, it } from 'vitest';
import { DECISION_EMAIL_TEMPLATE, RECEIPT_EMAIL_TEMPLATE, WITHDRAWN_ACK_EMAIL_TEMPLATE } from './templates';

const APPLICATION_ID = '11111111-2222-4333-8444-555555555555';

describe('every shipped template', () => {
	it.each([
		['application.receipt_email', RECEIPT_EMAIL_TEMPLATE],
		['application.decision_email', DECISION_EMAIL_TEMPLATE],
		['application.withdrawn_ack', WITHDRAWN_ACK_EMAIL_TEMPLATE],
	] as const)('%s ships approved: false — no ratified copy exists', (id, template) => {
		expect(template.id).toBe(id);
		expect(template.approved).toBe(false);
	});
});

describe('RECEIPT_EMAIL_TEMPLATE', () => {
	const data = {
		applicationId: APPLICATION_ID,
		verifyUrl: 'https://greatfallstoolbus.org/apply/verify?token=abc',
		withdrawUrl: 'https://greatfallstoolbus.org/apply/withdraw?token=def',
	};

	it('subject and text both carry the TODO marker', () => {
		expect(RECEIPT_EMAIL_TEMPLATE.subject(data)).toContain('TODO');
		expect(RECEIPT_EMAIL_TEMPLATE.text(data)).toContain('TODO');
	});

	it('text carries the application id and both links, recipient-neutral (no name, no salutation)', () => {
		const text = RECEIPT_EMAIL_TEMPLATE.text(data);
		expect(text).toContain(APPLICATION_ID);
		expect(text).toContain(data.verifyUrl);
		expect(text).toContain(data.withdrawUrl);
		expect(text).not.toMatch(/dear /i);
	});
});

describe('DECISION_EMAIL_TEMPLATE', () => {
	it('declined carries no activation link', () => {
		const text = DECISION_EMAIL_TEMPLATE.text({ applicationId: APPLICATION_ID, decision: 'declined' });
		expect(text).not.toContain('Activate:');
	});

	it('approved carries the activation link when supplied', () => {
		const text = DECISION_EMAIL_TEMPLATE.text({
			applicationId: APPLICATION_ID,
			decision: 'approved',
			activateUrl: 'https://greatfallstoolbus.org/assent?token=xyz',
		});
		expect(text).toContain('Activate: https://greatfallstoolbus.org/assent?token=xyz');
	});

	it('subject names the decision', () => {
		expect(DECISION_EMAIL_TEMPLATE.subject({ applicationId: APPLICATION_ID, decision: 'approved' })).toContain(
			'approved',
		);
		expect(DECISION_EMAIL_TEMPLATE.subject({ applicationId: APPLICATION_ID, decision: 'declined' })).toContain(
			'declined',
		);
	});
});

describe('WITHDRAWN_ACK_EMAIL_TEMPLATE', () => {
	it('carries the application id and no link of any kind', () => {
		const text = WITHDRAWN_ACK_EMAIL_TEMPLATE.text({ applicationId: APPLICATION_ID });
		expect(text).toContain(APPLICATION_ID);
		expect(text).not.toMatch(/https?:\/\//);
	});
});

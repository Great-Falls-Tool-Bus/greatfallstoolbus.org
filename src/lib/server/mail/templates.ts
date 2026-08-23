/**
 * Application mail templates (TIN-4062).
 *
 * NO EMAIL BODY COPY IS RATIFIED ANYWHERE IN META for any of the three kinds.
 * `spec/member-v0-executable-slices-2026-08-18.md` row 2 states the row-2
 * audit event itself carries "no email body," and neither
 * `spec/launch-member-v0-system-2026-08-16.md` nor any `decisions/*` record
 * supplies subject/body wording for a receipt, a decision, or a withdrawal
 * acknowledgement. This is the SAME posture `application/intake.ts` already
 * ships for the disclosure prompt: "the mechanism … builds now; the prompt
 * ships with the ratified copy round (published: false / TODO until then)."
 *
 * Every template below is therefore `approved: false` — an operator-wording
 * TODO stand-in, structurally incapable of being treated as real copy. The
 * approval gate lives in `./delivery.ts`'s `resolveDelivery`: a handler
 * refuses to construct `SmtpDelivery` (real transmission) while
 * `template.approved !== true`, even when `GFTB_MAIL_DELIVERY=enabled` and a
 * transport DSN are both present. Flipping `approved` to `true` for one
 * template, with ratified operator wording, is a normal code change — no
 * migration, no schema change — but it is also the ONLY door from "built" to
 * "reachable," and it stays firmly the operator's to open.
 *
 * CONTENT IS MINIMAL AND RECIPIENT-NEUTRAL BY CONSTRUCTION: no name, no
 * salutation, no marketing copy — just the mechanism the applicant needs
 * (a link/token reference) and a clear TODO marker so nobody mistakes a
 * placeholder for shipped wording if the approval gate is ever bypassed in a
 * future change.
 */

export type MailTemplateId = 'application.receipt_email' | 'application.decision_email' | 'application.withdrawn_ack';

export interface MailTemplate<TData> {
	id: MailTemplateId;
	/** Operator sign-off gate. Real delivery is refused while this is not `true` — see `./delivery.ts`. */
	approved: boolean;
	subject(data: TData): string;
	text(data: TData): string;
}

const TODO_MARKER =
	'[TODO: operator-approved wording is not yet ratified — see TIN-4062, and ' +
	'spec/launch-member-v0-system-2026-08-16.md §7. This placeholder must never be sent for real; ' +
	'the template-approval gate refuses SmtpDelivery while approved !== true.]';

export interface ReceiptEmailData {
	applicationId: string;
	/** The A3 verify_email bearer link the handler minted at render time. */
	verifyUrl: string;
	/** The A8 withdraw bearer link the handler minted at render time (slices §2.2 row 2). */
	withdrawUrl: string;
}

export const RECEIPT_EMAIL_TEMPLATE: MailTemplate<ReceiptEmailData> = {
	id: 'application.receipt_email',
	approved: false,
	subject: () => `${TODO_MARKER} Great Falls Tool Bus — application received`,
	text: (data) =>
		[
			TODO_MARKER,
			'',
			`Application: ${data.applicationId}`,
			`Verify: ${data.verifyUrl}`,
			`Withdraw: ${data.withdrawUrl}`,
			'',
			'This is an automated receipt. No further action is required to keep your application active.',
		].join('\n'),
};

export interface DecisionEmailData {
	applicationId: string;
	decision: 'approved' | 'declined';
	/** Present only when `decision === 'approved'` — the M1 activation bearer link, minted at render time. */
	activateUrl?: string;
}

export const DECISION_EMAIL_TEMPLATE: MailTemplate<DecisionEmailData> = {
	id: 'application.decision_email',
	approved: false,
	subject: (data) => `${TODO_MARKER} Great Falls Tool Bus — application ${data.decision}`,
	text: (data) =>
		[
			TODO_MARKER,
			'',
			`Application: ${data.applicationId}`,
			`Decision: ${data.decision}`,
			...(data.activateUrl ? [`Activate: ${data.activateUrl}`] : []),
		].join('\n'),
};

export interface WithdrawnAckEmailData {
	applicationId: string;
}

export const WITHDRAWN_ACK_EMAIL_TEMPLATE: MailTemplate<WithdrawnAckEmailData> = {
	id: 'application.withdrawn_ack',
	approved: false,
	subject: () => `${TODO_MARKER} Great Falls Tool Bus — application withdrawn`,
	text: (data) =>
		[TODO_MARKER, '', `Application: ${data.applicationId}`, '', 'Your application has been withdrawn.'].join('\n'),
};

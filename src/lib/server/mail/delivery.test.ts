/**
 * `MailDelivery` (TIN-4062) — everything provable without a real socket:
 *   - `DisabledDelivery` never touches the network.
 *   - `resolveDelivery` is the ONE door to `SmtpDelivery`, and it is closed
 *     by default and by an unapproved template.
 *   - `SmtpDelivery`'s real SMTP dialogue, run against an injected fake
 *     socket (an EventEmitter standing in for `net.Socket`/`tls.TLSSocket`)
 *     rather than a live connection — proving the "fully built" claim
 *     without ever opening a port.
 */

import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { MAIL_DELIVERY_ENV, MAIL_FROM_ADDRESS_ENV, MAIL_SMTP_URL_ENV } from './config';
import { DisabledDelivery, resolveDelivery, SmtpDelivery, TemplateNotApprovedError } from './delivery';
import type { MailTemplate } from './templates';

const UNAPPROVED: MailTemplate<{ applicationId: string }> = {
	id: 'application.receipt_email',
	approved: false,
	subject: () => 'subject',
	text: () => 'text',
};

const APPROVED: MailTemplate<{ applicationId: string }> = {
	id: 'application.receipt_email',
	approved: true,
	subject: () => 'subject',
	text: () => 'text',
};

const ENABLED_ENV = {
	[MAIL_DELIVERY_ENV]: 'enabled',
	[MAIL_SMTP_URL_ENV]: 'smtps://user:pass@mail.example.invalid:465',
	[MAIL_FROM_ADDRESS_ENV]: 'noreply@example.invalid',
} as NodeJS.ProcessEnv;

describe('DisabledDelivery', () => {
	it('performs no network I/O and reports mode: disabled', async () => {
		const outcome = await new DisabledDelivery().send({ to: 'x@example.invalid', subject: 's', text: 't' });
		expect(outcome.mode).toBe('disabled');
		expect(outcome.detail).toContain('disabled');
	});
});

describe('resolveDelivery — the one door', () => {
	it('returns DisabledDelivery, never SmtpDelivery, under a totally empty env', () => {
		const delivery = resolveDelivery(UNAPPROVED, {});
		expect(delivery).toBeInstanceOf(DisabledDelivery);
		expect(delivery).not.toBeInstanceOf(SmtpDelivery);
	});

	it('returns DisabledDelivery even when the template IS approved, if delivery is not enabled', () => {
		const delivery = resolveDelivery(APPROVED, {});
		expect(delivery).toBeInstanceOf(DisabledDelivery);
	});

	it('throws TemplateNotApprovedError — never constructing SmtpDelivery — when enabled but the template is not approved', () => {
		expect(() => resolveDelivery(UNAPPROVED, ENABLED_ENV)).toThrow(TemplateNotApprovedError);
	});

	it('returns a real SmtpDelivery only when BOTH enabled and the template is approved', () => {
		const delivery = resolveDelivery(APPROVED, ENABLED_ENV);
		expect(delivery).toBeInstanceOf(SmtpDelivery);
	});
});

/** A minimal fake `net.Socket`/`tls.TLSSocket` stand-in: scripted SMTP responses, recorded writes. */
class FakeSmtpSocket extends EventEmitter {
	written: string[] = [];
	private script: string[];
	private timeoutHandle: ReturnType<typeof setTimeout> | null = null;

	constructor(script: string[]) {
		super();
		this.script = script;
	}

	write(data: string): boolean {
		this.written.push(data);
		const next = this.script.shift();
		if (next !== undefined) {
			setImmediate(() => this.emit('data', Buffer.from(next)));
		}
		return true;
	}

	off(event: string | symbol, listener: (...args: never[]) => void): this {
		return super.off(event, listener as never);
	}

	/** Models `net.Socket#setTimeout`: (re)arms an idle timer that emits `'timeout'`; `0` disarms it. */
	setTimeout(ms: number): this {
		if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
		this.timeoutHandle = ms > 0 ? setTimeout(() => this.emit('timeout'), ms) : null;
		return this;
	}

	destroy(): void {
		if (this.timeoutHandle) clearTimeout(this.timeoutHandle);
		this.emit('close');
	}

	greet(): void {
		setImmediate(() => this.emit('data', Buffer.from('220 mail.example.invalid ESMTP\r\n')));
	}
}

describe('SmtpDelivery — a real SMTP dialogue over an injected fake socket', () => {
	it('sends the correct command sequence, dot-stuffs the body, and reports mode: sent', async () => {
		const socket = new FakeSmtpSocket([
			'250-mail.example.invalid\r\n250 AUTH LOGIN\r\n', // EHLO response (no STARTTLS: implicit TLS already)
			'334 VXNlcm5hbWU6\r\n', // AUTH LOGIN
			'334 UGFzc3dvcmQ6\r\n', // username
			'235 Authentication successful\r\n', // password
			'250 OK\r\n', // MAIL FROM
			'250 OK\r\n', // RCPT TO
			'354 Start mail input\r\n', // DATA
			'250 OK: queued\r\n', // message body
			'221 Bye\r\n', // QUIT
		]);
		const connect = vi.fn().mockImplementation(() => {
			socket.greet();
			return Promise.resolve(socket as unknown as import('node:net').Socket);
		});

		const delivery = new SmtpDelivery(
			{
				enabled: true,
				transportUrl: ENABLED_ENV[MAIL_SMTP_URL_ENV] as string,
				fromAddress: ENABLED_ENV[MAIL_FROM_ADDRESS_ENV] as string,
			},
			connect,
		);

		const outcome = await delivery.send({
			to: 'applicant@example.invalid',
			subject: 'subject line',
			text: '.leading dot\nsecond line',
		});

		expect(outcome).toEqual({ mode: 'sent', detail: 'transmitted via mail.example.invalid:465' });
		expect(connect).toHaveBeenCalledTimes(1);

		const commands = socket.written.map((line) => line.split('\r\n')[0]);
		expect(commands[0]).toMatch(/^EHLO /);
		expect(commands).toContain('AUTH LOGIN');
		expect(commands).toContain('MAIL FROM:<noreply@example.invalid>');
		expect(commands).toContain('RCPT TO:<applicant@example.invalid>');
		expect(commands).toContain('DATA');
		// The dot-stuffed body ends with the bare "." terminator and never
		// leaks the from-address credential shape; the leading "." on the
		// message text must have been doubled per RFC 5321.
		const dataCommand = socket.written.find((line) => line.includes('..leading dot'));
		expect(dataCommand).toBeDefined();
		// The bare "." terminator is its own line, immediately before the
		// trailing CRLF `writeLine` appends to every command.
		expect(dataCommand?.endsWith('.\r\n')).toBe(true);
		expect(dataCommand?.split('\r\n').at(-2)).toBe('.');
	});

	it('rejects when the server refuses RCPT TO', async () => {
		const socket = new FakeSmtpSocket([
			'250 mail.example.invalid\r\n', // EHLO (no auth advertised, no creds in this DSN)
			'250 OK\r\n', // MAIL FROM
			'550 No such user\r\n', // RCPT TO refused
		]);
		const connect = vi.fn().mockImplementation(() => {
			socket.greet();
			return Promise.resolve(socket as unknown as import('node:net').Socket);
		});
		const delivery = new SmtpDelivery(
			{ enabled: true, transportUrl: 'smtps://mail.example.invalid:465', fromAddress: 'noreply@example.invalid' },
			connect,
		);
		await expect(delivery.send({ to: 'nobody@example.invalid', subject: 's', text: 't' })).rejects.toThrow(
			/SMTP command failed/,
		);
	});

	it('E1: a silent peer (accepts the connection, then sends nothing) settles with an error — measured, not a hang', async () => {
		// The reviewer's exact scenario: `connect()` resolves (the peer accepted
		// the TCP connection) and then never sends a byte — no greeting, ever.
		// Before E1, `send()` had not settled after 5005ms; this test proves a
		// bounded, measured settlement instead, using a short override so the
		// suite itself does not have to wait out the real 30s production default.
		const socket = new FakeSmtpSocket([]); // never scripted to emit anything
		const connect = vi.fn().mockImplementation(() => Promise.resolve(socket as unknown as import('node:net').Socket));
		// No socket.greet() call: the peer stays silent forever.

		const SHORT_TIMEOUT_MS = 75;
		const delivery = new SmtpDelivery(
			{ enabled: true, transportUrl: 'smtps://mail.example.invalid:465', fromAddress: 'noreply@example.invalid' },
			connect,
			SHORT_TIMEOUT_MS,
		);

		const start = Date.now();
		await expect(delivery.send({ to: 'nobody@example.invalid', subject: 's', text: 't' })).rejects.toThrow(
			/no complete SMTP response within 75ms/,
		);
		const elapsed = Date.now() - start;

		// Bounded well under the reviewer's reported 5005ms — and well under a
		// generous multiple of the configured timeout, proving this settled
		// because the timer fired, not because of some unrelated coincidence.
		expect(elapsed).toBeLessThan(1000);
		expect(elapsed).toBeGreaterThanOrEqual(SHORT_TIMEOUT_MS - 5);
	});

	it('E1: the idle timer is per-response, not cumulative — a peer that replies slowly-but-within-budget on EVERY step still succeeds', async () => {
		// Guards against an overcorrection: a naive "one timeout for the whole
		// dialogue" implementation would fail a peer that is merely slow, not
		// hung. Nine responses, each delivered just under a short timeout
		// budget that would NOT survive if it applied to the sum of all nine.
		const RESPONSES = [
			'250-mail.example.invalid\r\n250 AUTH LOGIN\r\n',
			'334 VXNlcm5hbWU6\r\n',
			'334 UGFzc3dvcmQ6\r\n',
			'235 Authentication successful\r\n',
			'250 OK\r\n',
			'250 OK\r\n',
			'354 Start mail input\r\n',
			'250 OK: queued\r\n',
			'221 Bye\r\n',
		];
		const PER_STEP_DELAY_MS = 40;
		const PER_STEP_TIMEOUT_MS = 150; // each step comfortably clears its own budget…
		// …but nine steps at 40ms would sum to 360ms, which would NOT clear a
		// single cumulative 150ms budget — proving re-arming, not summing.
		expect(RESPONSES.length * PER_STEP_DELAY_MS).toBeGreaterThan(PER_STEP_TIMEOUT_MS);

		class SlowSmtpSocket extends FakeSmtpSocket {
			private remaining: string[];
			constructor(script: string[]) {
				super([]);
				this.remaining = script;
			}
			write(data: string): boolean {
				this.written.push(data);
				const next = this.remaining.shift();
				if (next !== undefined) setTimeout(() => this.emit('data', Buffer.from(next)), PER_STEP_DELAY_MS);
				return true;
			}
		}

		const socket = new SlowSmtpSocket(RESPONSES);
		const connect = vi.fn().mockImplementation(() => {
			setTimeout(() => socket.emit('data', Buffer.from('220 mail.example.invalid ESMTP\r\n')), PER_STEP_DELAY_MS);
			return Promise.resolve(socket as unknown as import('node:net').Socket);
		});
		const delivery = new SmtpDelivery(
			{
				enabled: true,
				transportUrl: 'smtps://user:pass@mail.example.invalid:465',
				fromAddress: 'noreply@example.invalid',
			},
			connect,
			PER_STEP_TIMEOUT_MS,
		);

		const outcome = await delivery.send({ to: 'applicant@example.invalid', subject: 's', text: 't' });
		expect(outcome.mode).toBe('sent');
	});
});

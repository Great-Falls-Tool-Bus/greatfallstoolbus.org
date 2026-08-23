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

	destroy(): void {
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
});

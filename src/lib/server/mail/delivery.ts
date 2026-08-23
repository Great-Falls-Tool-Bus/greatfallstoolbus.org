/**
 * The `MailDelivery` adapter (TIN-4062; operator interview 2026-08-23:
 * "delivery stays OFF until explicit operator activation; agents never send
 * mail").
 *
 * EXACTLY TWO SHIPPED IMPLEMENTATIONS.
 *   - `DisabledDelivery` — the default. Performs no network I/O and marks
 *     the message handled by returning `{ mode: 'disabled' }`; the caller
 *     (the outbox handler) is the one that journals the outcome, inside its
 *     own `withTenant` transaction (`./journal.ts`) — this class stays a
 *     pure, DB-free adapter so it is trivially unit-testable.
 *   - `SmtpDelivery` — fully built (real SMTP dialogue over `node:net`/
 *     `node:tls`, no new runtime dependency), and structurally UNREACHABLE
 *     from `resolveDelivery` below unless BOTH `GFTB_MAIL_DELIVERY=enabled`
 *     and a transport DSN are present (`./config.ts`) — an operator-attended
 *     env change, never a code default. Nothing in this repository's tests
 *     or CI ever sets that combination.
 *
 * THE TEMPLATE-APPROVAL GATE LIVES HERE, NOT IN THE HANDLER. `resolveDelivery`
 * is the ONE place `SmtpDelivery` can be constructed, and it refuses to build
 * one — throwing `TemplateNotApprovedError` before opening any socket —
 * whenever `template.approved !== true`, even when delivery is otherwise
 * enabled. That makes "no transport is ever constructed for an unapproved
 * template" true regardless of the `GFTB_MAIL_DELIVERY` combination, which is
 * a stronger property than the acceptance row asks for (the row only
 * requires it under the DEFAULT env) and costs nothing to keep.
 */

import { createHash } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';
import type { MailRuntimeConfig } from './config';
import { readMailConfig } from './config';
import type { MailTemplate } from './templates';

export interface MailMessage {
	to: string;
	subject: string;
	text: string;
}

export type MailDeliveryOutcome = { mode: 'disabled'; detail: string } | { mode: 'sent'; detail: string };

export interface MailDelivery {
	send(message: MailMessage): Promise<MailDeliveryOutcome>;
}

/** Never reaches a socket. The safe, load-bearing default. */
export class DisabledDelivery implements MailDelivery {
	async send(_message: MailMessage): Promise<MailDeliveryOutcome> {
		return {
			mode: 'disabled',
			detail: 'mail delivery gate disabled (GFTB_MAIL_DELIVERY is not "enabled") — recorded no-op',
		};
	}
}

/** Thrown by `resolveDelivery` when delivery is enabled but the template is not operator-approved. */
export class TemplateNotApprovedError extends Error {
	constructor(templateId: string) {
		super(
			`mail delivery: template "${templateId}" is not operator-approved (template.approved !== true). ` +
				'Refusing to construct a transport or send anything for real, even though delivery is enabled.',
		);
		this.name = 'TemplateNotApprovedError';
	}
}

interface ParsedSmtpUrl {
	host: string;
	port: number;
	implicitTls: boolean;
	user?: string;
	pass?: string;
}

/** Parse `smtp(s)://[user:pass@]host[:port]` without ever throwing on a credential-shaped value into a message. */
function parseSmtpUrl(transportUrl: string): ParsedSmtpUrl {
	let url: URL;
	try {
		url = new URL(transportUrl);
	} catch {
		throw new Error('mail delivery: transport DSN failed to parse as a URL');
	}
	const implicitTls = url.protocol === 'smtps:';
	const port = url.port ? Number(url.port) : implicitTls ? 465 : 587;
	return {
		host: url.hostname,
		port,
		implicitTls,
		user: url.username ? decodeURIComponent(url.username) : undefined,
		pass: url.password ? decodeURIComponent(url.password) : undefined,
	};
}

/** One line of SMTP `command\r\n`, written and awaited via the response reader below. */
function writeLine(socket: net.Socket | tls.TLSSocket, line: string): void {
	socket.write(`${line}\r\n`);
}

/**
 * Read one full SMTP response (possibly multi-line: `250-…` continuations
 * ending in `250 …`). Rejects on socket error/close/timeout so a hung server
 * cannot wedge the caller forever.
 */
function readResponse(socket: net.Socket | tls.TLSSocket): Promise<{ code: number; lines: string[] }> {
	return new Promise((resolve, reject) => {
		let buffer = '';
		const onData = (chunk: Buffer): void => {
			buffer += chunk.toString('utf8');
			const lines = buffer.split('\r\n').filter((l) => l.length > 0);
			const last = lines[lines.length - 1];
			// A final line has a SPACE (not a dash) after the 3-digit code.
			if (last && /^\d{3} /.test(last)) {
				cleanup();
				const code = Number(last.slice(0, 3));
				resolve({ code, lines });
			}
		};
		const onError = (error: Error): void => {
			cleanup();
			reject(error);
		};
		const onClose = (): void => {
			cleanup();
			reject(new Error('mail delivery: connection closed before a complete SMTP response arrived'));
		};
		const cleanup = (): void => {
			socket.off('data', onData);
			socket.off('error', onError);
			socket.off('close', onClose);
		};
		socket.on('data', onData);
		socket.on('error', onError);
		socket.on('close', onClose);
	});
}

async function command(socket: net.Socket | tls.TLSSocket, line: string, expect: number[]): Promise<string[]> {
	writeLine(socket, line);
	const { code, lines } = await readResponse(socket);
	if (!expect.includes(code)) {
		throw new Error(`mail delivery: SMTP command failed (expected ${expect.join('/')}, got ${code})`);
	}
	return lines;
}

/** RFC 5321 dot-stuffing: a line beginning with "." gets a second "." prepended. */
function dotStuff(text: string): string {
	return text
		.split(/\r\n|\n/)
		.map((line) => (line.startsWith('.') ? `.${line}` : line))
		.join('\r\n');
}

/**
 * Fully built, real SMTP transmission — and structurally unreachable outside
 * this file except through `resolveDelivery`'s gate. Supports implicit TLS
 * (`smtps://`) and opportunistic `STARTTLS` (`smtp://`, upgraded when the
 * server advertises it); AUTH LOGIN when the DSN carries credentials.
 */
export class SmtpDelivery implements MailDelivery {
	constructor(
		private readonly config: Extract<MailRuntimeConfig, { enabled: true }>,
		private readonly connect: (parsed: ParsedSmtpUrl) => Promise<net.Socket | tls.TLSSocket> = defaultConnect,
	) {}

	async send(message: MailMessage): Promise<MailDeliveryOutcome> {
		const parsed = parseSmtpUrl(this.config.transportUrl);
		const socket = await this.connect(parsed);
		try {
			await readResponse(socket); // server greeting (220)
			let active = socket;
			const ehlo = await command(active, `EHLO ${localHostname()}`, [250]);

			if (!parsed.implicitTls && ehlo.some((l) => /STARTTLS/i.test(l))) {
				await command(active, 'STARTTLS', [220]);
				active = tls.connect({ socket: active, host: parsed.host, servername: parsed.host });
				await new Promise<void>((resolve, reject) => {
					active.once('secureConnect', () => resolve());
					active.once('error', reject);
				});
				await command(active, `EHLO ${localHostname()}`, [250]);
			}

			if (parsed.user && parsed.pass) {
				await command(active, 'AUTH LOGIN', [334]);
				await command(active, Buffer.from(parsed.user, 'utf8').toString('base64'), [334]);
				await command(active, Buffer.from(parsed.pass, 'utf8').toString('base64'), [235]);
			}

			await command(active, `MAIL FROM:<${this.config.fromAddress}>`, [250]);
			await command(active, `RCPT TO:<${message.to}>`, [250, 251]);
			await command(active, 'DATA', [354]);

			const headers = [
				`From: <${this.config.fromAddress}>`,
				`To: <${message.to}>`,
				`Subject: ${message.subject}`,
				`Message-Id: <${randomMessageId()}@greatfallstoolbus.org>`,
				'MIME-Version: 1.0',
				'Content-Type: text/plain; charset=utf-8',
			].join('\r\n');
			const body = `${headers}\r\n\r\n${dotStuff(message.text)}`;
			await command(active, `${body}\r\n.`, [250]);

			await command(active, 'QUIT', [221]);
			return { mode: 'sent', detail: `transmitted via ${parsed.host}:${parsed.port}` };
		} finally {
			socket.destroy();
		}
	}
}

function defaultConnect(parsed: ParsedSmtpUrl): Promise<net.Socket | tls.TLSSocket> {
	return new Promise((resolve, reject) => {
		const onError = (error: Error): void => reject(error);
		if (parsed.implicitTls) {
			const socket = tls.connect({ host: parsed.host, port: parsed.port, servername: parsed.host }, () => {
				socket.off('error', onError);
				resolve(socket);
			});
			socket.once('error', onError);
			return;
		}
		const socket = net.connect({ host: parsed.host, port: parsed.port }, () => {
			socket.off('error', onError);
			resolve(socket);
		});
		socket.once('error', onError);
	});
}

function localHostname(): string {
	return 'gftb-worker.invalid';
}

function randomMessageId(): string {
	return createHash('sha256').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 32);
}

/**
 * The ONE door from "built" to "reachable." Returns `DisabledDelivery`
 * whenever `GFTB_MAIL_DELIVERY` is not exactly `"enabled"` — the default in
 * every environment this repository's own tests and CI ever run in — and
 * throws `TemplateNotApprovedError` (never constructing a transport) when
 * delivery IS enabled but the template the caller is about to render has not
 * been operator-approved.
 */
export function resolveDelivery<TData>(
	template: MailTemplate<TData>,
	env: NodeJS.ProcessEnv = process.env,
): MailDelivery {
	const config = readMailConfig(env);
	if (!config.enabled) return new DisabledDelivery();
	if (!template.approved) throw new TemplateNotApprovedError(template.id);
	return new SmtpDelivery(config);
}

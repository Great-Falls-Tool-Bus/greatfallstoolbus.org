// Mail lace-up truth for the keyholders list. ONE source of truth for three
// consumers, so they can never drift:
//   1. /contact renders the mail-client cards from MAIL_CLIENTS.
//   2. scripts/build-agent-skills.mjs derives one provider-neutral SKILL.md per
//      client under .agents/skills/gftb-mail-laceup-<id>/ (mirrored to
//      .claude/skills/) so a keyholder's own agent can lace up their client.
//   3. The same generator rewrites the mail section of static/llms.txt so any
//      agent pointed at greatfallstoolbus.org/llms.txt discovers each skill.
// Regenerate + drift-check with `just skills-build` / `just skills-check`.
// Keep prose brief and free of em-dashes (operator directive).

/** The keyholders Mailman surface. This is a private access-gating role list:
 *  curated keyholder membership, non-member posts accepted/moderated for access
 *  requests, and no public archive. discuss@ is the future public list. */
export const LIST = {
	post: 'keyholders@latoolb.us',
	join: 'keyholders-join@latoolb.us',
	owner: 'keyholders-owner@latoolb.us',
	/** List-Id Mailman emits; clients key list rules and reply-to-list on this. */
	listId: 'keyholders.latoolb.us',
} as const;

/** Submission and retrieval settings for keyholders who hold a latoolb.us
 *  mailbox. Values match the live mail stack. */
export const MAILBOX = {
	host: 'mail.latoolb.us',
	imapPort: 993,
	imapSecurity: 'SSL/TLS',
	submissionPort: 587,
	submissionSecurity: 'STARTTLS',
	auth: 'SASL (normal password)',
} as const;

/** HyperKitty web archive. The keyholders archive is private/members-only or
 *  off because access requests may contain personal details. */
export const ARCHIVE = {
	url: 'https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/',
	status: 'private or off, pending TIN-2380',
} as const;

export interface MailClient {
	/** Slug. Skill directory is gftb-mail-laceup-<id>. */
	id: string;
	/** Display name for the contact card and skill title. */
	name: string;
	/** Where this client runs. */
	platforms: string;
	/** One honest sentence for the /contact card. */
	summary: string;
	/** How an approved keyholder subscribes by email. */
	subscribe: string;
	/** Folder or label rule that files list mail. */
	filing: string;
	/** How replying to the list behaves in this client. */
	replyToList: string;
	/** IMAP/SMTP note for keyholders with a latoolb.us mailbox. */
	mailbox: string;
	/** Machine-actionable steps an agent can run against the user's config. */
	agentHints: string[];
}

const imapSmtp = `${MAILBOX.host}: IMAP ${MAILBOX.imapPort} (${MAILBOX.imapSecurity}), submission ${MAILBOX.submissionPort} (${MAILBOX.submissionSecurity}, ${MAILBOX.auth}).`;

export const MAIL_CLIENTS: MailClient[] = [
	{
		id: 'gmail',
		name: 'Gmail',
		platforms: 'Web, Android, iOS',
		summary: `Label mail from ${LIST.post} and keep early list mail out of spam.`,
		subscribe: `Approved keyholders send an empty email to ${LIST.join} from their Gmail address, then confirm the reply; owners approve membership.`,
		filing: `Settings, Filters and Blocked Addresses, Create a new filter: From ${LIST.post}, Apply a label "keyholders" and Never send to Spam.`,
		replyToList: `Gmail has no reply-to-list button; use Reply All so the reply reaches ${LIST.post}. Remove extra recipients to keep it list-only.`,
		mailbox: `If you hold a latoolb.us mailbox, add it as a full account (not send-as) with ${imapSmtp}`,
		agentHints: [
			`For an approved keyholder, compose an email to ${LIST.join} with an empty subject and body, send it, and watch for the confirmation reply.`,
			`Create a Gmail filter with criteria from=${LIST.post}, actions add label "keyholders" and never-spam.`,
			`When replying to a list thread, address the reply to ${LIST.post} only.`,
		],
	},
	{
		id: 'thunderbird',
		name: 'Thunderbird',
		platforms: 'Linux, macOS, Windows',
		summary: `Full mailing-list support; reads the List-Post and List-Id headers Mailman emits.`,
		subscribe: `Approved keyholders send an empty email to ${LIST.join}, then confirm the reply; owners approve membership.`,
		filing: `Tools, Message Filters: match List-Id ${LIST.listId}, move to a "keyholders" folder.`,
		replyToList: `Use Reply to List (the reply goes to ${LIST.post} using the List-Post header).`,
		mailbox: `For a latoolb.us mailbox, add an account with ${imapSmtp}`,
		agentHints: [
			`For an approved keyholder, send an empty message to ${LIST.join} and confirm the round trip.`,
			`Add a message filter keyed on header List-Id "${LIST.listId}" that moves matches to a "keyholders" folder.`,
			`Prefer the Reply to List action so replies target ${LIST.post}.`,
		],
	},
	{
		id: 'apple-mail',
		name: 'Apple Mail',
		platforms: 'macOS, iOS',
		summary: `File list mail with a rule; Apple Mail lacks a reply-to-list button.`,
		subscribe: `Approved keyholders send an empty email to ${LIST.join}, then confirm the reply; owners approve membership.`,
		filing: `On macOS, Mail, Settings, Rules: if From contains ${LIST.post}, Move Message to a "Keyholders" mailbox.`,
		replyToList: `No reply-to-list button; use Reply All so ${LIST.post} stays on the reply, then trim other recipients.`,
		mailbox: `For a latoolb.us mailbox, add an account with ${imapSmtp}`,
		agentHints: [
			`For an approved keyholder, send an empty message to ${LIST.join} and confirm the reply.`,
			`Create a Mail rule: condition From contains "${LIST.post}", action move to mailbox "Keyholders".`,
			`On reply, keep ${LIST.post} as the recipient and remove others.`,
		],
	},
	{
		id: 'kmail',
		name: 'KMail',
		platforms: 'Linux (KDE)',
		summary: `Native mailing-list management once the first list message arrives.`,
		subscribe: `Approved keyholders send an empty email to ${LIST.join}, then confirm the reply; owners approve membership.`,
		filing: `Folder, Mailing List Management, Detect Automatically on the folder holding list mail.`,
		replyToList: `Use Message, Reply to List; KMail reads the List-Post header to target ${LIST.post}.`,
		mailbox: `For a latoolb.us mailbox, add an account with ${imapSmtp}`,
		agentHints: [
			`For an approved keyholder, send an empty message to ${LIST.join} and confirm the reply.`,
			`On the folder that receives list mail, enable Mailing List Management with Detect Automatically.`,
			`Use Reply to List so replies go to ${LIST.post}.`,
		],
	},
	{
		id: 'geary',
		name: 'Geary',
		platforms: 'Linux (GNOME)',
		summary: `Lightweight client; sort list mail server-side. The keyholders archive is private or off.`,
		subscribe: `Approved keyholders send an empty email to ${LIST.join}, then confirm the reply; owners approve membership.`,
		filing: `Geary has no local filters; sort with a server-side rule on ${MAILBOX.host} or read the web archive.`,
		replyToList: `No reply-to-list button; use Reply All and keep ${LIST.post} on the reply.`,
		mailbox: `For a latoolb.us mailbox, add an account with ${imapSmtp}`,
		agentHints: [
			`For an approved keyholder, send an empty message to ${LIST.join} and confirm the reply.`,
			`Add a server-side sieve/filter on ${MAILBOX.host} keyed on List-Id "${LIST.listId}" to file list mail.`,
			`On reply, keep ${LIST.post} as a recipient.`,
		],
	},
	{
		id: 'outlook',
		name: 'Outlook',
		platforms: 'Web, Windows, macOS',
		summary: `File list mail with an inbox rule; use Reply All for list replies.`,
		subscribe: `Approved keyholders send an empty email to ${LIST.join}, then confirm the reply; owners approve membership.`,
		filing: `Settings, Rules, Add new rule: if From is ${LIST.post}, move to a "Keyholders" folder.`,
		replyToList: `No reply-to-list button; use Reply All so ${LIST.post} stays on the reply, then trim other recipients.`,
		mailbox: `For a latoolb.us mailbox, add an account with ${imapSmtp}`,
		agentHints: [
			`For an approved keyholder, send an empty message to ${LIST.join} and confirm the reply.`,
			`Create an inbox rule: condition From "${LIST.post}", action move to folder "Keyholders".`,
			`On reply, keep ${LIST.post} as the recipient and remove others.`,
		],
	},
];

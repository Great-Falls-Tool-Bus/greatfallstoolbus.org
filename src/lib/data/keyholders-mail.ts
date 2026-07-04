export type MailClientSetup = {
	id: string;
	name: string;
	cardSummary: string;
	overview: string;
	tips: readonly string[];
};

export type MailAddressCard = {
	label: string;
	address: string;
	note: string;
};

export const keyholdersMail = {
	listName: 'keyholders',
	domain: 'latoolb.us',
	listAddress: 'keyholders@latoolb.us',
	addresses: {
		join: 'keyholders-join@latoolb.us',
		leave: 'keyholders-leave@latoolb.us',
		post: 'keyholders@latoolb.us',
		owner: 'keyholders-owner@latoolb.us',
	},
	status: {
		mailbox: 'The mailbox receives inbound mail and outbound-signed delivery has been certified with SPF and DKIM.',
		list: 'The Mailman 3 / Postorius / HyperKitty list runtime is still pending TIN-2380 deployment and list round-trip smoke.',
		archive:
			'The HyperKitty archive is intended to be public after the list runtime exists and the archive route is verified.',
		directSubmit:
			'The bot-guarded direct-submit form remains TIN-2420 Path B. The static site currently opens a mail draft.',
	},
	addressCards: [
		{
			label: 'Join the keyholders list',
			address: 'keyholders-join@latoolb.us',
			note: 'Send an empty email here after the list runtime is applied.',
		},
		{
			label: 'Post to the list',
			address: 'keyholders@latoolb.us',
			note: 'For subscribed members after Mailman confirms the subscription.',
		},
		{
			label: 'Reach list owners',
			address: 'keyholders-owner@latoolb.us',
			note: 'The owner address after the list runtime is live.',
		},
	] satisfies readonly MailAddressCard[],
	memberFlows: [
		{
			title: 'Join or leave by email',
			steps: [
				'Send an empty email to keyholders-join@latoolb.us.',
				'Reply to the confirmation request Mailman sends back.',
				'Keep the welcome message; it includes list options and unsubscribe details.',
				'To leave, send mail to keyholders-leave@latoolb.us and reply to the confirmation.',
			],
		},
		{
			title: 'Join via Postorius',
			steps: [
				'Open the Postorius page after the deployment publishes it.',
				'Choose Subscribe, enter your address, and confirm through the email challenge.',
				'Use subscription preferences for digest mode or temporary delivery suspension.',
			],
		},
	],
	clientSetups: [
		{
			id: 'apple-mail',
			name: 'Apple Mail',
			cardSummary:
				'Subscribe by email; after the first list message, use a Mail rule to file keyholders mail into a mailbox.',
			overview: 'Apple Mail works with ordinary Mailman messages. It does not need a plugin for the keyholders list.',
			tips: [
				'Subscribe by sending mail to keyholders-join@latoolb.us and replying to the confirmation.',
				'Create a mailbox named keyholders, then use Mail -> Settings -> Rules to move messages where List-Id contains keyholders.',
				'When replying, check the To and Cc fields. Apple Mail does not expose a dedicated reply-to-list button.',
			],
		},
		{
			id: 'gmail',
			name: 'Gmail',
			cardSummary: 'Subscribe with your Gmail address, label list mail, and mark early messages as not spam if needed.',
			overview: 'Gmail is usable as a mailbox provider for the list, but it is not especially list-aware.',
			tips: [
				'Use the email subscription flow or the Postorius web flow.',
				'Create a filter matching To: keyholders@latoolb.us and apply a keyholders label.',
				'Use Reply all carefully and trim recipients when you mean to reply only to the list.',
				'If an early list message lands in Spam, mark it Not spam and update the filter to never send matching mail to Spam.',
			],
		},
		{
			id: 'thunderbird',
			name: 'Thunderbird',
			cardSummary: 'Use Thunderbird Reply List and filter on List-Id for durable list filing.',
			overview: 'Thunderbird has first-class mailing-list affordances and reads the Mailman List-* headers.',
			tips: [
				'Prefer Reply List over Reply or Reply All when responding to the whole keyholders list.',
				'Create a Message Filter where List-Id contains keyholders, then move matches into a keyholders folder.',
				'Use View -> Sort by -> Threaded to keep long list discussions readable.',
			],
		},
		{
			id: 'geary',
			name: 'Geary',
			cardSummary:
				'Use the normal subscribe flow; create sorting rules server-side because Geary has minimal local list tooling.',
			overview: 'Geary intentionally keeps list tooling simple. It can read and send list mail without special setup.',
			tips: [
				'Subscribe by email or Postorius.',
				'Check the To field manually when replying; Geary has no dedicated reply-to-list button.',
				'Create server-side rules through webmail or Sieve if your mail host supports it.',
			],
		},
		{
			id: 'kmail',
			name: 'KMail',
			cardSummary: 'Use Mailing List Management to detect List-* headers and enable list-specific actions.',
			overview: 'KMail has native mailing-list management and is a good fit for Mailman lists.',
			tips: [
				'After the first list message arrives, select the folder and use Folder -> Mailing List Management -> Detect Automatically.',
				'Create a filter where List-Id contains keyholders and move matches into a keyholders folder.',
				'Use Reply to Mailing-List or Post to Mailing-List after detection succeeds.',
			],
		},
	] satisfies readonly MailClientSetup[],
	ownerModeratorTips: [
		'Postorius owner and moderator access only applies to people explicitly assigned in the list runtime.',
		'Use Held messages to approve, reject, or discard moderated messages.',
		'Use Members to manage subscriptions, moderation flags, and bans.',
		'Before public announcement, verify archive visibility, who may post, subscription policy, and welcome text.',
		'Mail to keyholders-owner@latoolb.us reaches owners without going through the list.',
	],
} as const;

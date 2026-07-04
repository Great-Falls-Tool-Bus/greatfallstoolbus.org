---
name: gftb-mail-laceup-apple-mail
description: Lace up Apple Mail for the Great Falls Tool Bus keyholders mailing list (keyholders@latoolb.us). Use when a keyholder asks their agent to subscribe to, file, and reply to the keyholders list in Apple Mail.
---

# Apple Mail mail lace-up

Point your agent at this skill to lace up Apple Mail for the Great Falls
Tool Bus keyholders list. Your agent applies the steps below to the keyholder's
own Apple Mail configuration. No credentials live in this file; the
keyholder authorizes each change.

Platforms: macOS, iOS

## Subscribe

Send an empty email to keyholders-join@latoolb.us, then confirm the reply.

## File list mail

On macOS, Mail, Settings, Rules: if From contains keyholders@latoolb.us, Move Message to a "Keyholders" mailbox.

## Reply to the list

No reply-to-list button; use Reply All so keyholders@latoolb.us stays on the reply, then trim other recipients.

## Mailbox (optional)

For a latoolb.us mailbox, add an account with mail.latoolb.us: IMAP 993 (SSL/TLS), submission 587 (STARTTLS, SASL (normal password)).

## Archive

HyperKitty web archive: https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/ (pending (TIN-2380)).

## Agent steps

1. Send an empty message to keyholders-join@latoolb.us and confirm the reply.
2. Create a Mail rule: condition From contains "keyholders@latoolb.us", action move to mailbox "Keyholders".
3. On reply, keep keyholders@latoolb.us as the recipient and remove others.

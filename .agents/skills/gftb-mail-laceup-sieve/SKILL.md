---
name: gftb-mail-laceup-sieve
description: Lace up Server-side Sieve for the Great Falls Tool Bus keyholders mailing list (keyholders@latoolb.us). Use when a keyholder asks their agent to subscribe to, file, and reply to the keyholders list in Server-side Sieve.
---

# Server-side Sieve mail lace-up

Point your agent at this skill to lace up Server-side Sieve for the Great Falls
Tool Bus keyholders list. Your agent applies the steps below to the keyholder's
own Server-side Sieve configuration. No credentials live in this file; the
keyholder authorizes each change.

Platforms: IMAP hosts with Sieve or webmail filters

## Subscribe

Send an empty email to keyholders-join@latoolb.us, then confirm the reply from any mail client.

## File list mail

If the mailbox host exposes Sieve or webmail filters, match List-Id "keyholders.latoolb.us" and move matches to a "Keyholders" folder.

## Reply to the list

Sieve only files mail; reply from a mail client and keep keyholders@latoolb.us as the recipient.

## Mailbox (optional)

For a latoolb.us mailbox, use mail.latoolb.us: IMAP 993 (SSL/TLS), submission 587 (STARTTLS, SASL (normal password)). Do not assume a ManageSieve host or port until the operator or provider exposes one.

## Archive

HyperKitty web archive: https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/ (private or off, pending TIN-2380).

## Agent steps

1. Ask the user or provider whether Sieve or webmail filters are available; do not invent a ManageSieve host or port.
2. Create or verify a server-side folder named "Keyholders".
3. Install a rule that matches header List-Id "keyholders.latoolb.us" and moves matching mail to the "Keyholders" folder.
4. If List-Id is unavailable before the first Mailman message arrives, temporarily match To or Cc "keyholders@latoolb.us".
5. Do not handle credentials directly; let the user authorize the mail host or webmail session.

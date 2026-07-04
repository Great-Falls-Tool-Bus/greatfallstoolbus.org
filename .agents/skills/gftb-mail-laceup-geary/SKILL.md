---
name: gftb-mail-laceup-geary
description: Lace up Geary for the Great Falls Tool Bus keyholders mailing list (keyholders@latoolb.us). Use when a keyholder asks their agent to subscribe to, file, and reply to the keyholders list in Geary.
---

# Geary mail lace-up

Point your agent at this skill to lace up Geary for the Great Falls
Tool Bus keyholders list. Your agent applies the steps below to the keyholder's
own Geary configuration. No credentials live in this file; the
keyholder authorizes each change.

Platforms: Linux (GNOME)

## Subscribe

Send an empty email to keyholders-join@latoolb.us, then confirm the reply.

## File list mail

Geary has no local filters; sort with a server-side rule on mail.latoolb.us or read the web archive.

## Reply to the list

No reply-to-list button; use Reply All and keep keyholders@latoolb.us on the reply.

## Mailbox (optional)

For a latoolb.us mailbox, add an account with mail.latoolb.us: IMAP 993 (SSL/TLS), submission 587 (STARTTLS, SASL (normal password)).

## Archive

HyperKitty web archive: https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/ (pending (TIN-2380)).

## Agent steps

1. Send an empty message to keyholders-join@latoolb.us and confirm the reply.
2. Add a server-side sieve/filter on mail.latoolb.us keyed on List-Id "keyholders.latoolb.us" to file list mail.
3. On reply, keep keyholders@latoolb.us as a recipient.

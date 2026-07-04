---
name: gftb-mail-laceup-outlook
description: Lace up Outlook for the Great Falls Tool Bus keyholders mailing list (keyholders@latoolb.us). Use when a keyholder asks their agent to subscribe to, file, and reply to the keyholders list in Outlook.
---

# Outlook mail lace-up

Point your agent at this skill to lace up Outlook for the Great Falls
Tool Bus keyholders list. Your agent applies the steps below to the keyholder's
own Outlook configuration. No credentials live in this file; the
keyholder authorizes each change.

Platforms: Web, Windows, macOS

## Subscribe

Approved keyholders send an empty email to keyholders-join@latoolb.us, then confirm the reply; owners approve membership.

## File list mail

Settings, Rules, Add new rule: if From is keyholders@latoolb.us, move to a "Keyholders" folder.

## Reply to the list

No reply-to-list button; use Reply All so keyholders@latoolb.us stays on the reply, then trim other recipients.

## Mailbox (optional)

For a latoolb.us mailbox, add an account with mail.latoolb.us: IMAP 993 (SSL/TLS), submission 587 (STARTTLS, SASL (normal password)).

## Archive

HyperKitty web archive: https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/ (private or off, pending TIN-2380).

## Agent steps

1. For an approved keyholder, send an empty message to keyholders-join@latoolb.us and confirm the reply.
2. Create an inbox rule: condition From "keyholders@latoolb.us", action move to folder "Keyholders".
3. On reply, keep keyholders@latoolb.us as the recipient and remove others.

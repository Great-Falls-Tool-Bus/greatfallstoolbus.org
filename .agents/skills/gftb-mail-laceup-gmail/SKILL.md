---
name: gftb-mail-laceup-gmail
description: Lace up Gmail for the Great Falls Tool Bus keyholders mailing list (keyholders@latoolb.us). Use when a keyholder asks their agent to subscribe to, file, and reply to the keyholders list in Gmail.
---

# Gmail mail lace-up

Point your agent at this skill to lace up Gmail for the Great Falls
Tool Bus keyholders list. Your agent applies the steps below to the keyholder's
own Gmail configuration. No credentials live in this file; the
keyholder authorizes each change.

Platforms: Web, Android, iOS

## Subscribe

Send an empty email to keyholders-join@latoolb.us from your Gmail address, then confirm the reply.

## File list mail

Settings, Filters and Blocked Addresses, Create a new filter: From keyholders@latoolb.us, Apply a label "keyholders" and Never send to Spam.

## Reply to the list

Gmail has no reply-to-list button; use Reply All so the reply reaches keyholders@latoolb.us. Remove extra recipients to keep it list-only.

## Mailbox (optional)

If you hold a latoolb.us mailbox, add it as a full account (not send-as) with mail.latoolb.us: IMAP 993 (SSL/TLS), submission 587 (STARTTLS, SASL (normal password)).

## Archive

HyperKitty web archive: https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/ (pending (TIN-2380)).

## Agent steps

1. Compose an email to keyholders-join@latoolb.us with an empty subject and body, send it, and watch for the confirmation reply.
2. Create a Gmail filter with criteria from=keyholders@latoolb.us, actions add label "keyholders" and never-spam.
3. When replying to a list thread, address the reply to keyholders@latoolb.us only.

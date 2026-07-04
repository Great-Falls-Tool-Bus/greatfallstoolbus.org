---
name: gftb-mail-laceup-thunderbird
description: Lace up Thunderbird for the Great Falls Tool Bus keyholders mailing list (keyholders@latoolb.us). Use when a keyholder asks their agent to subscribe to, file, and reply to the keyholders list in Thunderbird.
---

# Thunderbird mail lace-up

Point your agent at this skill to lace up Thunderbird for the Great Falls
Tool Bus keyholders list. Your agent applies the steps below to the keyholder's
own Thunderbird configuration. No credentials live in this file; the
keyholder authorizes each change.

Platforms: Linux, macOS, Windows

## Subscribe

Send an empty email to keyholders-join@latoolb.us, then confirm the reply.

## File list mail

Tools, Message Filters: match List-Id keyholders.latoolb.us, move to a "keyholders" folder.

## Reply to the list

Use Reply to List (the reply goes to keyholders@latoolb.us using the List-Post header).

## Mailbox (optional)

For a latoolb.us mailbox, add an account with mail.latoolb.us: IMAP 993 (SSL/TLS), submission 587 (STARTTLS, SASL (normal password)).

## Archive

HyperKitty web archive: https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/ (pending (TIN-2380)).

## Agent steps

1. Send an empty message to keyholders-join@latoolb.us and confirm the round trip.
2. Add a message filter keyed on header List-Id "keyholders.latoolb.us" that moves matches to a "keyholders" folder.
3. Prefer the Reply to List action so replies target keyholders@latoolb.us.

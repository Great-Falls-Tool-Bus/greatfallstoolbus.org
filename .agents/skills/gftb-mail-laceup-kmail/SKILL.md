---
name: gftb-mail-laceup-kmail
description: Lace up KMail for the Great Falls Tool Bus keyholders mailing list (keyholders@latoolb.us). Use when a keyholder asks their agent to subscribe to, file, and reply to the keyholders list in KMail.
---

# KMail mail lace-up

Point your agent at this skill to lace up KMail for the Great Falls
Tool Bus keyholders list. Your agent applies the steps below to the keyholder's
own KMail configuration. No credentials live in this file; the
keyholder authorizes each change.

Platforms: Linux (KDE)

## Subscribe

Approved keyholders send an empty email to keyholders-join@latoolb.us, then confirm the reply; owners approve membership.

## File list mail

Folder, Mailing List Management, Detect Automatically on the folder holding list mail.

## Reply to the list

Use Message, Reply to List; KMail reads the List-Post header to target keyholders@latoolb.us.

## Mailbox (optional)

For a latoolb.us mailbox, add an account with mail.latoolb.us: IMAP 993 (SSL/TLS), submission 587 (STARTTLS, SASL (normal password)).

## Archive

HyperKitty web archive: https://lists.latoolb.us/hyperkitty/list/keyholders@latoolb.us/ (private or off).

## Agent steps

1. For an approved keyholder, send an empty message to keyholders-join@latoolb.us and confirm the reply.
2. On the folder that receives list mail, enable Mailing List Management with Detect Automatically.
3. Use Reply to List so replies go to keyholders@latoolb.us.

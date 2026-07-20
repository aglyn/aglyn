---
sidebar_position: 2
title: Designed emails
description: Build campaign emails in the besigner with email-safe blocks and merge tokens — no separate editor.
---

# Designed emails

Design campaign emails in the **besigner** — the same editor you use for
pages — with an email-safe block set. There is no separate email editor
to learn.

![A designed email open in the Besigner](/img/email-campaigns/email-editor.png)

## Create a template

On **Marketing → Email**, click **New email template**. That creates an
email document and opens it in the besigner with the email blocks:

- **Email section** — the 600px container with background and padding.
- **Email text** — heading/subheading/body/caption styles; supports
  merge tokens.
- **Email rich text** — formatted HTML (sanitized like the custom HTML
  block).
- **Email image**, **Email button**, **Email divider**, **Email
  spacer** — the essentials, rendered in email-client-safe markup.
- **Email product** — pick a product **by id**; its current name, price,
  and image fill in at send time (renames never break it).
- **Email custom HTML** — raw table markup for advanced layouts,
  sanitized.

## Styling email blocks

The styles panel works on email blocks exactly as on page elements —
your edits (fonts, colors, spacing) apply on top of each block's
email-safe defaults.

Because email clients run no JavaScript, the attributes panel does
**not** offer the Interactions section while an email document is open —
use links (Email button, image links) for anything clickable.

## Merge tokens

Use these anywhere in text, rich text, or button links:

| Token | Fills with |
| --- | --- |
| `{{contact.firstName}}` | Recipient's first name |
| `{{contact.name}}` | Full name |
| `{{contact.email}}` | Email address |
| `{{site.url}}` | Your site's base URL |
| `{{unsubscribeUrl}}` | Signed unsubscribe link |

Unknown tokens stay visible in the output so a typo shows up in your
test send instead of silently rendering blank.

## Send it

In the campaign composer, pick your template under **Email design**
(stored by id — renaming the template never breaks scheduled sends).
The plain-text message field disappears; the render pipeline produces
inline-styled table HTML plus a plain-text alternative per recipient.

- **Send test to me** delivers a proof to your own address without
  recording a campaign.
- Scheduling and A/B experiments work exactly as with plain campaigns.

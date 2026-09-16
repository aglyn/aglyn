---
sidebar_position: 3
title: Generate an email with AI
description: Turn a brief into a draft email design, or a draft campaign and the email it would send. Nothing is sent, and nothing is aimed at anybody until you choose.
---

# Generate an email with AI

Describe the email you want and AI generation writes a **draft design**:
one email built from the email blocks, with three subject lines and three
preheaders to choose between. Ask for a campaign instead and it writes the
same design plus the **draft campaign** that would send it.

Both are drafts. Nothing is sent, scheduled or queued, and the campaign is
aimed at nobody until you pick an audience yourself.

## What you get

**An email design.** It appears under **Marketing → Email** beside the
templates you made by hand, and opens in the besigner exactly as those do.
Every block is an email block — sections, text, buttons, images, dividers,
spacers and product cards — so it renders the same way in every mail client.

**Three subject lines and three preheaders.** They are stored with the
design, the strongest as the subject and the preheader, the rest as
alternatives. Change which one leads at any time, or write your own.

**A campaign, when you asked for one.** A draft campaign holding that one
email, with the subject and preheader already filled in. Open it from
**Marketing → Campaigns**.

## Write the brief

Say what the email is for, who it speaks to, and what you want the reader to
do. The more the brief gives, the less the email guesses.

> Announce the autumn menu to the regulars. Mention that the Tuesday bread
> class is running again, and point people at the class page to book.

A few things are worth knowing:

- **Pick the kind of email** — a welcome, a newsletter, a launch, a cart
  reminder or an event reminder — and the email is written in that shape.
- **Name a page and it gets linked.** A button pointing at one of your pages
  is written as that page's address and completed with your domain when the
  email is sent.
- **A fact the brief does not give** — a date, a price, a place — arrives in
  square brackets for you to fill, rather than invented.
- **No unsubscribe link is written.** Every campaign email gets one added
  when it is sent.

## Products

An email can carry **product cards**, which fill in each product's current
name, price and picture at the moment the email is sent, so a rename or a
price change never leaves a stale email behind.

Pick the products for the job, or name them in the brief exactly as they are
named in your catalog. The generated email places one card for each, in the
order you gave them, and binds each card to its product by id. No product's
details are sent for the email to be written — only how many cards to place.

## Who receives it

**Choosing the audience is yours.** A drafted campaign has no list, no
segment and no schedule.

When your brief names one of your lists, the campaign's note says which one
it is, and — if that list has enough history on this site — the day and hour
its past campaigns were opened most, with how many sends that reading is
taken from. Pick the list on the campaign, check the send time, and schedule
it when you are ready.

Your lists, contacts and past send figures are read on the server to work
that out. None of them is sent for the email to be written.

## Merge tokens

Generated copy greets the reader with the merge tokens every campaign fills:
`{{contact.firstName}}`, `{{contact.name}}` and `{{contact.email}}`, and only
in text — never in a link, a subject line or a preheader, where they are not
filled. Add any other token yourself in the besigner.

## What it will not do

- It will not send, schedule or queue anything.
- It will not publish an email design or mark a template live.
- It will not pick who receives a campaign.
- It will not write raw HTML into an email. Add the **Email custom HTML**
  block yourself if you need it.

## Where it runs

Email generation needs AI generation switched on for your workspace, the
**Email** plugin switched on for the site, and permission to generate.
Drafting a **campaign** also needs the **Marketing** plugin on and a plan
that sends campaign email — see [Billing &
Plans](/workspace-and-billing/billing-and-plans/overview). Without that, you
can still generate email designs.

## Related

- [Designed emails](./designed-emails.md) — the blocks, and editing a design
  by hand.
- [How Aglyn AI builds](/ai/how-aglyn-ai-builds) — the rules every generated
  document is held to.

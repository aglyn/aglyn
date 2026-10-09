---
sidebar_position: 13.5
title: Privacy and Aglyn AI
description: "What Aglyn AI sends to its AI providers, which provider handles what, what is never sent, and how long briefs and conversations are kept — with links to the legal pages that govern it."
---

# Privacy and Aglyn AI

This page says, in plain terms, what leaves Aglyn when you use AI and where it goes. The
terms that govern it are on Aglyn's [legal pages](#legal-pages); this page does not
replace them.

## What is sent {#what-is-sent}

A request sends the AI what it needs to do that one job, and no more:

- **your words**: the question, the brief or the description you typed;
- **what it builds against**: the names of the components, layouts, forms and datasets the
  site already has, your theme's values, and the copy of anything it starts from;
- **your [business profile](./business-profile.md)**: what the business does, who it is for,
  its tone, and the contact details you entered, plus the preferences
  [Aglyn AI learned](./business-profile.md#what-aglyn-ai-learned);
- **for a CRM summary or email**, the record you have open.

Each feature's guide lists exactly what its own requests send, under **What is sent**: for
example [CRM by AI](./crm-by-ai.md#what-is-sent),
[Automations with AI](./automations-with-ai.md#what-is-sent) and
[Create images with AI](./create-images.md#what-is-sent).

## Who processes it {#who-processes-it}

| What | Sent to |
| --- | --- |
| Answers, plans, pages, copy, emails, every text request, and vector pictures | Aglyn's AI model provider |
| Photo, art and design pictures | Google's image models on Vertex AI: only your description and the shape you chose |
| [Stock photos](./stock-photos.md) in AI sites | Pixabay: only the search words, never anything about you |

The providers, where they process data and what each receives are listed on the
[Subprocessors](https://aglyn.com/legal/subprocessors) page.

## What is never sent {#what-is-never-sent}

- No contact, lead, deal, form submission or list member is read to build a page.
- No file from your media library is sent to make a picture.
- Your name, email address and account identifiers are not sent with an image request or a
  stock photo search.

## How long it is kept {#how-long-it-is-kept}

- **Briefs** are kept with their job for **180 days**, then deleted.
- **Conversations with Aglyn Assist** are kept with your workspace for **180 days**, to
  improve answers and the documentation.
- **What AI built** (pages, forms, emails, pictures) is your content, kept until you delete
  it. A picture's description is kept with it as a record of how it was made.

## Turn AI off {#turn-ai-off}

A site admin can switch AI off for one site; every AI request for that site is then
refused. See [Switch AI off for one site](./overview.md#switch-ai-off-for-one-site). A
member whose role lacks the AI permissions cannot use AI at all; see
[Who can use it](./overview.md#who-can-use-it).

## Legal pages {#legal-pages}

- [Privacy Policy](https://aglyn.com/legal/privacy)
- [Subprocessors](https://aglyn.com/legal/subprocessors)
- [Data Processing Addendum](https://aglyn.com/legal/dpa)
- [Terms of Service](https://aglyn.com/legal/terms)
- [Acceptable Use Policy](https://aglyn.com/legal/acceptable-use)

## Related

- [Aglyn AI overview](./overview.md#what-is-sent)
- [Security & compliance](../enterprise/security-and-compliance.md)

---
sidebar_position: 1
title: Forms & Lead Capture
description: Add forms to your site, collect submissions in an inbox, and write them into datasets.
---

# Forms & Lead Capture

**Forms** let visitors send you information — contact requests, sign-ups, lead capture.
Submissions land in your **inbox** and can flow straight into a [dataset](../datasets/overview.md)
and your [contacts CRM](../contacts/overview.md).

![The Inbox page in the Aglyn console, with its Submissions, Members & leads, and Campaigns sections](/img/forms/inbox-page.png)

:::info Plan availability
**Free** for basic forms and the inbox. Higher tiers raise submission and dataset caps.
:::

## Reading submissions from code

Everything on this page describes the console inbox. The same submissions are
available over the REST API — list them, **mark each one read** as your integration
processes it, and delete them once they're archived elsewhere. That `read` flag is
what stops a nightly sync from pushing the same lead twice.

See **[Form submissions in the API reference](/api/resources/form-submissions)**, or
start from [Your first API call](../../guides/your-first-api-call.md).

## Build a form

1. Drop **form components** onto a screen in the Besigner (fields, submit button).
2. Configure the fields and the submit behavior.
3. Publish — the form posts to Aglyn's submit API.

:::note Per-visitor rate limit
Submissions are capped at **10 per minute per site, per visitor address**. A
visitor over the limit gets a short retry delay, not a permanent block. It's per
address, so one spammer can't lock out everyone else — but bulk-importing through
your own public form will trip it. Use
[datasets](../datasets/import-export.md) for imports instead.

That per-address limit is one of several protections in front of your form — see
[Spam and abuse protection](#spam-and-abuse-protection).
:::

### Monthly allowance per plan

Each tier includes a monthly form-submission allowance, counted per site:

| Plan | Submissions / month |
| --- | --- |
| Free | 20 |
| Starter | 200 |
| Pro | 1,000 |
| Business | 10,000 |
| Scale | 50,000 |
| Advanced | 100,000 |
| Agency & Enterprise | Unlimited |

On **Free**, that allowance is a hard wall: at the cap, further submissions are
**declined** — the visitor sees the form's error message rather than a fake success.
On every paid tier it is a band, not a wall: submissions past the included count keep
working and bill as
[metered overage](../../workspace-and-billing/billing-and-plans/overview.md#usage-meters),
the same way storage and API requests do, because a dropped submission is a lost lead.
Either way the count resets with the calendar month (UTC), and the
[billing page's usage meters](../../workspace-and-billing/billing-and-plans/overview.md#usage-meters)
warn you at 80% before you get there.

**Unlimited** on Agency and Enterprise means exactly that about the *plan*: nothing
meters your submission volume and nothing cuts you off for buying too small a tier.
It is not a promise that the endpoint will take any number of requests from anyone —
every site, on every plan, sits under the
[anti-abuse ceiling](#the-per-site-monthly-ceiling) below.

A single submission can carry up to **20 fields** and about **10 KB** of text — plenty
for any real form, tight enough that a bot can't stuff your inbox.

## Spam and abuse protection

A published form is a public endpoint on the open internet — that is the point of it.
Three things stand in front of it, and none of them asks your visitors to prove they
are human:

- **A honeypot field.** Every Aglyn form carries an input that humans never see and
  never fill. A bot that fills it in gets an ordinary-looking success and nothing is
  stored — it learns nothing and keeps wasting its time.
- **A per-address rate limit.** The 10-per-minute limit above, enforced across all of
  our servers rather than per instance, so it still holds when traffic is spread out.
- **A per-site monthly ceiling.** Below.

There is deliberately **no CAPTCHA and no attestation check** on the submit endpoint.
A challenge in front of a lead-capture form is paid for by every real visitor so that
a bot doesn't get through, and it costs conversions. Whether that trade is the right
one is an open question we have not settled — see
[Trust & security](/trust#api-surface) for the same statement from the reviewer's
side. Until it changes, the ceiling is what bounds the damage.

### The per-site monthly ceiling

Separate from your plan allowance, each site has a monthly ceiling on how many
submissions the endpoint will accept **at all**. It is abuse containment, not a
quota: you are not metered against it, it is not something to plan capacity around,
and no legitimate site reaches it. It sits at **ten times your plan's included
allowance, or 5,000, whichever is larger** — and at 1,000,000 on the unlimited tiers
— so it is always far above the volume you actually bought.

If a site does cross it:

- Further submissions are refused for the rest of the calendar month, and **a refused
  submission is not billed**. It is turned away before the billing counter moves, so a
  flood cannot add anything to your invoice — not even the part that was refused.
- Nothing is stored, so there is no spam in your inbox to clean up afterwards.
- The visitor is told plainly that the form isn't accepting messages and that their
  message was **not** sent — never a fake success that leaves a real customer waiting
  for a reply. If your site publishes a **support email**, the notice offers it, so
  there is still a way to reach you.
- Your site's **Inbox** shows *"Form submissions are paused"* above the tabs, with how
  many submissions were refused and the date it lifts, and site managers get a
  notification.
- It lifts by itself at the start of the next month (UTC).

Crossing the ceiling almost always means a bot found one of your forms. If it was real
traffic, **contact support** and we will raise the ceiling for your site.

## Field types

Each **Form Field** has a type that controls what visitors see and what is submitted:

| Type | Visitor sees | Submitted value |
| --- | --- | --- |
| **Text** (default) | Single-line input | The text |
| **Email** | Email input | The address |
| **Multiline** | Multi-row text area | The text |
| **Dropdown** | Select menu | The chosen option |
| **Radio choice** | One radio button per option | The chosen option |
| **Checkboxes** | One checkbox per option | All ticked options, joined with `, ` |
| **Star rating** | Five stars | The number of stars (e.g. `4`) |

Dropdown, radio, and checkbox fields take their choices from the field's
**Options** setting — enter one choice per line (or separate them with commas).
Blank entries are ignored. The **Required?** switch works per type: a required
checkbox group needs at least one box ticked.

### Labels and placeholders

Every field has a **Label** — the visible name of the input, and the one screen
readers announce. A field can also carry a **Placeholder**: a grey example
inside the empty input, such as `you@company.com` or "Tell us about your setup".
Set one and the label moves above the box so both are readable at once; leave it
empty and the label keeps its floating behavior.

A placeholder is a hint, never a substitute for the label — it vanishes the
moment a visitor starts typing, and a field labeled only by its placeholder is
unusable with a screen reader. Text, email, and multiline fields show it inside
the input; a dropdown displays it until a choice is made; radio, checkbox, and
rating fields ignore it. Clearing the setting removes the hint.

### Example: a quick survey

Build a feedback survey with four fields:

1. A **Star rating** field named `satisfaction`, labeled "How satisfied are you?".
2. A **Radio choice** field named `visit-frequency` with options
   `First time`, `Monthly`, `Weekly`.
3. A **Checkboxes** field named `topics` with options
   `Products, Support, Pricing` — visitors can tick several.
4. A **Multiline** field named `comments` for anything else.

Submissions land in the inbox like any other form — a visitor who ticks two
checkboxes submits `topics: Products, Pricing`, and the rating arrives as a
number you can chart from a bound [dataset](../datasets/overview.md).

## After submit

The form's **After submit** setting controls what a successful submission does:

| Outcome | What the visitor sees |
| --- | --- |
| **Show the success message** (default) | The form is replaced by your **Success message** |
| **Redirect the visitor** | The browser navigates to a **screen** you pick (rename-safe — slug changes never break it) or, with no screen picked, to a **Redirect URL** (a same-site path like `/thanks` or an https URL; anything else is ignored) |
| **Reveal a hidden element** | An element you pick from the canvas — hidden on the published page until then — appears in place of the form |

For the **reveal** outcome, drop the follow-up content (a thank-you block, a download
link, an embedded video) anywhere on the screen, then select it as the **Element to
reveal**. It stays hidden for visitors until the form is submitted; in the Besigner it
stays visible so you can keep editing it. If a redirect target can't be resolved (the
screen was deleted, the URL was rejected), the form falls back to the success message.

### Example: grow an email list from a signup form

Combine an outcome with a [conditional automation](../../marketing-and-automation/workflows-and-actions/actions-builder.md#only-run-when-a-field-matches):

1. Add a **Checkboxes** field named `subscribe` with one option, `Yes, keep me posted`.
2. Set **After submit** to *Redirect the visitor* and pick your `/thanks` screen.
3. On **Automation → Actions**, add an action on **formSubmission** with the condition
   *"A field is not empty" → `subscribe`* and the step **Enroll in a list**,
   picking your email audience.

Visitors who tick the box are added to the list (and can be targeted by
[email campaigns](../../marketing-and-automation/email-campaigns/overview.md));
everyone lands on the thank-you page.

Need a finer net? Conditions
[chain with AND/OR](../../marketing-and-automation/workflows-and-actions/actions-builder.md#chain-multiple-conditions-andor)
— e.g. enroll only when `subscribe` is ticked **and** `plan` equals `Pro`, or when
either of two topic boxes is ticked.

## Where submissions go

- **Inbox** — every submission is captured; open it in the console's mail reader dialog.
- **Datasets** — bind a form to a dataset (**Write to dataset** on the Form element)
  and each submission is also appended as a record. The inbox always gets its copy, and
  each submission's own detail dialog carries
  [chips saying where it went](#where-this-one-went) — including saying nothing about a
  dataset when the record wasn't created.
- **Contacts** — form submissions are one of the [ingestion sources](../contacts/overview.md)
  that build your contacts list.

### The inbox

The site's **Inbox** page collects everything visitors send, in three tabs —
**Submissions**, **Members & leads**, and **Campaigns**. The **Form Submissions** table
reads as a list of people, not of forms: **From**, **Message**, **Received**, and the
row actions.

- **From** shows the sender — a colored initials avatar and their name, with the
  **form name** as a caption underneath (the Form element's **Form name** attribute, so
  name your forms distinctly: "Contact", "Newsletter", "Survey"). The avatar's color is
  derived from the name, so one sender keeps one color on every machine.
- Unread submissions are **bold with a dot** at the left of the row. There is no "New"
  chip — bold text and a chip saying *New* are the same fact twice. Site managers also
  get an in-app notification per submission.
- **Received** is relative — `now`, `18m`, `3h`, `2d`, `4w`, `7mo`. Hover it for the
  absolute date and time; the detail dialog carries the absolute time too. An inbox is
  scanned for recency, and a locale timestamp makes you do the subtraction.
- Click a row to read it — every field the visitor filled, labeled — and it's marked
  read; **Mark unread** puts it back.
- **Delete** removes a submission permanently (it asks first).

#### Who a submission is "from" {#who-a-submission-is-from}

A form is yours to define, so there is no guaranteed name field. The sender is resolved
from the submitted values by convention, in this order:

1. A **name** field — `name`, `fullname`, `yourname`, `firstname` or `contactname`.
2. An **email** field — `email` or `emailaddress`.
3. The literal **Someone**.

Matching ignores case, spaces, underscores and hyphens, so `Full Name`, `full_name` and
`fullname` are all the same field. Empty values don't count, and where a form has two
spellings of the same name the first one submitted wins.

A form whose fields are named something else entirely — `q1`, `who`, `sender` — shows
**Someone** on every row. That is the design, not a fault: an avatar with no letters in
it is worse than a generic one, and the console will not guess which of your fields is a
person. Rename the field to one of the conventional names if you want the sender on the
row; the submission itself is unaffected, and every field is still in the detail dialog.

#### Where this one went {#where-this-one-went}

Open a submission and, under its fields, chips report what actually happened to it:

- **Saved to Inbox** — always, on every submission. It's reassurance rather than a
  status: a submission you're looking at is, by definition, in the inbox.
- **Added to "Leads" dataset** — only when this submission really did become a record in
  that dataset, named as the dataset is named today.

The rule behind the second chip is worth knowing, because its **absence** is
informative. It is stamped at submit time, only when a record was genuinely created. If
the bound dataset had been deleted, or its record quota was full, or none of the
submitted fields map onto the dataset's fields, the submission is still kept in full —
it's the record that didn't happen. In that case **no dataset chip appears at all**,
rather than a chip pointing at a row that doesn't exist. A submission with only **Saved
to Inbox** on a form you bound to a dataset is the signal to go and check the dataset.

#### Replying to a submission {#replying-to-a-submission}

Open a submission and, under the fields, there is a **Reply** composer. Write a message,
press **Send reply**, and it goes by email to the address on the submission. The
original message is quoted underneath yours, so the person can see which of their
messages you are answering.

Read this part before you use it, because it decides where the conversation continues:

- **Answers arrive in your email, not in the Inbox.** The reply is sent with your
  console account's address as its **Reply-To**, so when the recipient answers, their
  answer lands in your own mailbox. Nothing on this platform receives mail, so the
  Inbox will not show it. The Inbox is a record of what your site collected and what you
  sent back — it is not a mailbox.
- **The reply is sent from the platform's address**, with your site's sending name in
  front of it. Sending from your own domain is not available yet. The Reply-To above is
  what makes the round trip work in the meantime.
- **Replies sent** lists what you have already sent on this submission, so you can see
  whether someone else on your team has answered.

A reply is **transactional** mail: someone wrote to you and you are writing back. It is
not marketing, it does not need a marketing opt-in, and it does not add anyone to a
list. It still respects the addresses that can no longer be mailed — if the address has
bounced, reported a message as spam, or unsubscribed from your site, the composer
refuses and tells you which. Replies count toward your email costs but never toward the
campaign allowance your plan limits, so answering customers cannot use up the quota that
sends your newsletter.

A submission whose form had no email field cannot be replied to, and says so instead of
offering a Send that would fail.

<!-- screenshot: forms/inbox-submission-reader.png per SCREENSHOT_PLAN.md -->

## Related

- [Datasets & dynamic content](../datasets/overview.md)
- [Contacts CRM](../contacts/overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)

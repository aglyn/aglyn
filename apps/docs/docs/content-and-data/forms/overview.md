---
sidebar_position: 1
title: Forms & Lead Capture
description: Add forms to your site, collect submissions in an inbox, and write them into datasets.
---

# Forms & Lead Capture

**Forms** let visitors send you information — contact requests, sign-ups, lead capture.
Submissions land in your **inbox** and can flow straight into a [dataset](../datasets/overview.md)
and your [contacts CRM](../contacts/overview.md).

![The Inbox page in the Aglyn console, with Form Submissions, Site Members & Leads, Orders, and Email campaigns sections](/img/forms/inbox-page.png)

:::info Plan availability
**Free** for basic forms and the inbox. Higher tiers raise submission and dataset caps.
:::

## Build a form

1. Drop **form components** onto a screen in the Besigner (fields, submit button).
2. Configure the fields and the submit behavior.
3. Publish — the form posts to Aglyn's submit API.

:::note Submission limits
To keep spam from burning your plan's form allowance, submissions are capped at
**10 per minute per site, per visitor address**. A visitor over the limit gets a
short retry delay, not a permanent block. It's per address, so one spammer can't
lock out everyone else — but bulk-importing through your own public form will trip
it. Use [datasets](../datasets/import-export.md) for imports instead.
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

At the cap, further submissions are **declined** — the visitor sees the form's error
message rather than a fake success — and the count resets with the calendar month
(UTC). The [billing page's usage meters](../../workspace-and-billing/billing-and-plans/overview.md#usage-meters)
warn you at 80% before you get there.

A single submission can carry up to **20 fields** and about **10 KB** of text — plenty
for any real form, tight enough that a bot can't stuff your inbox.

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
empty and the label keeps its floating behaviour.

A placeholder is a hint, never a substitute for the label — it vanishes the
moment a visitor starts typing, and a field labelled only by its placeholder is
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
3. On the Workflows page, add an action on **formSubmission** with the condition
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
  and each submission is also appended as a record. The inbox always gets its copy.
- **Contacts** — form submissions are one of the [ingestion sources](../contacts/overview.md)
  that build your contacts list.

### The inbox

The site's **Inbox** page collects everything visitors send, in three tabs —
**Submissions**, **Members & leads**, and **Campaigns**. On the **Form Submissions**
table:

- Unread submissions are bold with a **New** chip; site managers also get an in-app
  notification per submission.
- Click a row to read it — every field the visitor filled, labeled — and it's marked
  read; **Mark unread** puts it back.
- **Delete** removes a submission permanently (it asks first).

Each row shows which **Form** it came from — that's the Form element's **Form name**
attribute, so name your forms distinctly ("Contact", "Newsletter", "Survey") and the
inbox stays sorted at a glance.

<!-- screenshot: forms/inbox-submission-reader.png per SCREENSHOT_PLAN.md -->

## Related

- [Datasets & dynamic content](../datasets/overview.md)
- [Contacts CRM](../contacts/overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)

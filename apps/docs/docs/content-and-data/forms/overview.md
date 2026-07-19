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
- **Datasets** — bind a form to a dataset and each submission becomes a validated record.
- **Contacts** — form submissions are one of the [ingestion sources](../contacts/overview.md)
  that build your contacts list.

## Related

- [Datasets & dynamic content](../datasets/overview.md)
- [Contacts CRM](../contacts/overview.md)
- [Email campaigns](../../marketing-and-automation/email-campaigns/overview.md)

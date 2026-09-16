---
sidebar_position: 4
title: Draft and explain automations with AI
description: Describe an automation and Aglyn AI drafts it switched off, from only the triggers and steps your plan includes. It can also explain an automation, and why one of its runs failed.
---

# Draft and explain automations with AI

On **Automation → Actions**, Aglyn AI can turn a sentence into an automation, such as
*"when someone submits the newsletter form, add them to the newsletter list, make them a lead
and send them a welcome email"*. It can also explain an automation you already have, and tell
you why one of its runs failed. None of these changes or runs an automation.

:::info Availability
Aglyn AI build jobs are released gradually. This page applies to automation jobs as they reach
your workspace.
:::

## Draft an automation {#draft}

1. Open **Automation → Actions** and choose **Describe it**, beside **Add action** and
   **Recipes**.
2. Describe what should happen, and when.
3. Choose **Draft the automation**.

Drafting usually takes a few minutes. You can close the window: the draft appears in the actions
list, switched off, when it is ready, and **AI jobs** in the Assist panel shows its progress. If
you keep the window open, it tells you what to fill in, and **Review it** opens the draft in the
actions editor.

## What a draft is made of {#what-a-draft-uses}

- **Only what your plan can run.** A draft uses the triggers and steps the actions editor offers,
  and only the ones your plan includes: a workspace without the CRM gets no CRM steps, and one
  without webhooks gets no webhook step. When a description needs something your plan does not
  include, nothing is drafted and the job says what is missing.
- **Your site's own records.** A list, campaign, workflow, webhook, dataset, form or deal stage
  that your description names is matched to the one your site has by that name.
- **Placeholders for anything missing.** When nothing on your site matches, or more than one
  thing could, the draft keeps your words in square brackets instead, such as **[newsletter]**.
  An email gets one wherever your description left out a fact, such as *call us on [your phone
  number]*. A draft never guesses which record you meant, and never makes up a phone number, an
  address or a price.
- **Switched off.** Nothing runs until you switch it on.

## Fill in placeholders, then switch it on {#placeholders}

In the actions list, a draft that still holds placeholders says how many, such as *2
placeholders to fill in*. Open it, and each field or picker holding one is highlighted with what
the draft asked for, such as *Pick the list — the draft asked for "newsletter"*. Pick the record
or type the value, then save.

A placeholder is harmless while it waits: a list name in square brackets matches no list, and a
condition value in square brackets matches no event, so the automation cannot act on the wrong
record. If you switch on an automation that still holds placeholders, you are asked to confirm
first, with each one named.

## Explain an automation {#explain}

Open a saved action or workflow and choose **Explain it** at the top of the editor. In a few
minutes you get a plain-words account of what it does, step by step, and anything worth checking,
such as a list your site no longer has or a placeholder nobody has filled in. It reads the
automation as it is saved, so save your changes first.

## Find out why a run failed {#why-a-run-failed}

In an automation's **Runs** log, a failed run has **Why did this fail?**. It reads what the
[run history](../marketing-and-automation/workflows-and-actions/overview.md#run-history) recorded
about that run, together with the automation's settings, and answers with the most likely cause
and how to fix it. Opening it again shows the same answer.

## What Aglyn AI is sent {#what-is-sent}

- **To draft:** your description, whether your plan includes the CRM, webhooks and bookings, the
  names and field names of your site's forms, and the names of its datasets. The names of your
  lists, campaigns, workflows, webhooks and deal stages are never sent: your words are matched to
  them after the answer comes back.
- **To explain an automation:** how it is set up, including the text of its emails and messages
  and the names of the records it uses. Email addresses are removed first, a teammate is
  described only as a teammate, and on-page code is left out.
- **To explain a failed run:** also when the run happened, what it did and the errors it recorded,
  with email addresses removed. What a visitor submitted, such as what they entered in a form, is
  never read.

No contact, lead, deal, form submission or list member is read for any of them.

## Who can use it {#who-can-use-it}

These jobs need the **Generate with AI** permission, on a site whose Automation plugin is on, and
drafting also needs a plan that includes actions. See
[who can use AI assist](../marketing-and-automation/ai-assist/overview.md#who-can-use-it). A site
that has switched AI off shows none of these controls. Each job uses AI credits; once an
automation is switched on, its runs count against your site's action runs, never your AI credits.

## Related

- [Actions builder](../marketing-and-automation/workflows-and-actions/actions-builder.md)
- [How Aglyn AI builds](./how-aglyn-ai-builds.md)

---
sidebar_position: 6
title: Report an issue
description: File a bug, an idea, or a question from any page in the console — on every plan, including Free.
---

# Report an issue

Found something broken? Open the **account menu** in the top right and choose
**Report an issue**. The dialog is available from every console page, and on
every plan — including Free.

## What to write

Three fields, none of them long.

**What kind of report is this?** — a dropdown with three choices:

- **Something is broken**
- **An idea or request**
- **A question**

**Summary** — one line, the way you would describe it to a colleague. The
placeholder shows the shape we are after: "The media picker forgets the folder
I chose".

**What happened?** — what you did, what you expected, and what happened
instead. If you can say how to make it happen again, say that.

**Send report** stays disabled until both **Summary** and **What happened?**
have something in them. The kind is preset to **Something is broken**, so a
bug report needs no choice at all.

### The two length caps {#length-caps}

**Summary** stops accepting text at **120 characters** and **What happened?**
at **5,000**. Both are hard stops in the field itself rather than an error on
submit, so what you can see is what gets filed — nothing is truncated later
without telling you.

Only **What happened?** carries a counter (`0 / 5000`, under the box, counting
as you type). **Summary** has none, so the first sign you have reached its cap
is that typing stops changing the field. It is the shorter of the two on
purpose: the summary becomes the filed issue's title, and a title a triager
cannot read at a glance is a title nobody reads.

## What gets attached for you

You do not need to describe your setup. The report already carries:

| Attached automatically | Why it helps |
| --- | --- |
| The page you were on | Points straight at the surface, without a screenshot |
| Your workspace and plan | Says which features and limits were in play |
| The app version and build | Says exactly which release you were running |
| Your browser and window size | Separates a layout problem from a logic one |

Your name and email come from the account you are signed in with — there is
nothing to fill in.

## Being contacted

The dialog ends with **"You can contact me about this report"**, ticked by
default. Untick it and we will still read and track the report; we just will
not reply to you about it. Leave it ticked if the answer might need a
back-and-forth — most bugs do.

## Where it goes

Reports land in Aglyn's issue tracker and are triaged by the team. You will
see a reference like `CUS-42` when it is filed; quote it if you follow up.

:::note This is not a support ticket
A report is a defect we track. A [support ticket](support-and-community.md) is
a conversation with the support team, carrying a first-response commitment on
your plan.

Use **Report an issue** for "this is broken" or "this should exist" — from any
plan. Use **Support** when you need an answer from a person about your own
account, and your plan includes tickets.
:::

## When it does not send {#when-it-does-not-send}

Whatever the reason, **the dialog stays open with your text intact.** A report
that fails never costs you what you wrote — fix the cause and press **Send
report** again, or close the dialog yourself.

### You are filing faster than the limit {#rate-limits}

Two limits apply, per person, and a report has to pass both:

| Window | Reports |
| --- | --- |
| Per minute | 2 |
| Per hour | 20 |

Exceeding either shows **"You have filed several reports just now — try again
shortly."** — as a warning rather than an error, because nothing is wrong with
the report, only with its timing. Wait out the window and send it again.

This is the message most often mistaken for a broken dialog. The two windows
exist together deliberately: a per-minute limit on its own can be spread into
a steady drip that still buries triage, so a burst and a drip are both capped.

### Your email address is not verified {#verified-email}

Filing needs a **verified** email address. An account that has not confirmed
its address is refused with "Verify your email to continue" and nothing is
filed — the dialog gives no hint that this is about your account rather than
about the report. [Manage account](manage-account.md) shows an **Email
verified** or **Email unverified** chip beside your address, which is where to
check. Once the address is verified, the dialog works straight away.

### Something went wrong on our side

A report we could not file answers "We could not file that report just now.
Please try again." and is never reported back to you as sent. Retrying is
safe.

:::info Self-hosting
Issue reporting is one of the optional integrations in a
[self-hosted install](../developers/self-hosting.md), switched on with
`LINEAR_API_KEY` and `LINEAR_CUSTOMER_REPORTS_TEAM_ID` — both listed in that
page's **Optional keys** table. It stays off until the operator supplies their
own tracker credentials, and it never files into Aglyn's tracker. Left
unconfigured, the dialog answers "Issue reporting is not configured on this
deployment" and names the two variables, rather than dropping the report
silently.
:::

## Related

- [Support & community](support-and-community.md)
- [Manage account](manage-account.md)
- [Console tour](../getting-started/console-tour.md)
- [Self-hosting](../developers/self-hosting.md)

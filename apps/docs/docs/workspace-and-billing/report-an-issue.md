---
sidebar_position: 6
title: Report an issue
description: File a bug, an idea, or a question from any page in the console — on every plan, including Free.
---

# Report an issue

Found something broken? Open the **account menu** in the top right and choose
**Report an issue**. The dialog is available from every console page, and on
every plan — including Free.

## Is it Aglyn, or your own site? {#is-it-us-or-your-site}

This channel is for problems with **Aglyn itself** — the editor, the console,
publishing, domains, billing. It is not the place to change something on a
site built with Aglyn.

The line is not simply "platform versus content", so here it is in cases:

| What you noticed | Where it belongs |
| --- | --- |
| The heading on your About page is the wrong color, or says the wrong thing | Your site. Change it in the editor, or ask whoever builds the site for you. |
| Headings render at the wrong size on **every** site you open | Aglyn. Report it. |
| A page returns 404 after you renamed it | Aglyn. Report it. |
| The contact form on your site emails the wrong address | Your site — that address is a setting on the form. |
| The contact form never delivers, whatever address you set | Aglyn. Report it. |

The pattern: if changing it means editing **your** content or settings, it is
yours. If it happens the same way regardless of what any one site contains, it
is ours.

If you did not build the site and cannot change it, the people who can are
whoever set the workspace up — an agency, a colleague, or whoever sent you
your invitation. Aglyn cannot edit a customer's site on their behalf. Some
workspaces put their own support link in the dialog; when one is configured,
it appears as **Get help with this site**.

Still unsure? Send it anyway. A report filed in the wrong place costs us a
moment; a problem nobody hears about costs everyone more.

## What to write

The dialog asks different things depending on what kind of report it is,
because a bug and an idea need different answers. Pick the kind first.

**Summary** — always required, one line, the way you would describe it to a
colleague. It becomes the filed issue's title.

### If something is broken {#a-bug}

Four questions, all required. They are what turn a report into a fix:

- **What were you doing when it broke?** — step by step, so we can follow
  along. This is the single most valuable thing you can write.
- **What did you expect to happen?**
- **What happened instead?** — quote any error message exactly.
- **Does it happen every time?** — one click: every time, sometimes, once, or
  you have not tried again. It changes what we do first, so it is not
  optional.

### If it is an idea {#an-idea}

One required question, and it is deliberately not "what should we build":

- **What are you trying to do that you can't?** — the problem, not the
  feature. There may already be a way to do it, and where there is not,
  knowing the goal gets you a better answer than a specification would.
- **How do you handle it today?** and **If you already have something in
  mind** are both optional.

### If it is a question {#a-question}

- **What do you need to know?** — required.
- **What have you already tried or read?** — optional, and it saves us
  sending you back to a page you have read.

Questions take one extra step: before anything is filed, we check whether the
documentation already answers you. If it does, the dialog shows the relevant
pages, word for word, under **This may already be answered** — and nothing is
filed. If that covers it you are done; if it does not, **This didn't answer it
— send anyway** files the question as normal.

**Send report** stays disabled until **Summary** and every required question
for that kind have something in them.

### The length caps {#length-caps}

**Summary** stops accepting text at **120 characters**; each of the other
boxes has its own cap, between **600** and **2,000** characters, sized to the
answer it asks for. They are hard stops in the field itself rather than an
error on submit, so what you can see is what gets filed — nothing is truncated
later without telling you.

Summary is the shortest on purpose: it becomes the filed issue's title, and a
title a triager cannot read at a glance is a title nobody reads.

## What gets attached for you

You do not need to describe your setup. The report already carries:

| Attached automatically | Why it helps |
| --- | --- |
| The page you were on | Points straight at the surface, without a screenshot |
| The site you were working on | Names the affected site, when you were on one |
| Your workspace and plan | Says which features and limits were in play |
| Your role | A bug that only bites one role is a different bug |
| Which features were switched on | Recognizes a report against a surface still rolling out |
| The app version and build | Says exactly which release you were running |
| Your browser and window size | Separates a layout problem from a logic one |
| A reference id | Ties your report to our server logs for that moment |

Your name and email come from the account you are signed in with — there is
nothing to fill in.

Nothing else is collected. No passwords, keys or session data are ever
attached, your IP address is not recorded, and the workspace and site named on
a report are only ever ones your own account can already reach.

## Being contacted

The dialog ends with **"You can contact me about this report"**, ticked by
default. Untick it and we will still read and track the report; we just will
not reply to you about it. Leave it ticked if the answer might need a
back-and-forth — most bugs do.

## Where it goes

Reports land in a dedicated intake in Aglyn's issue tracker, kept separate
from our own engineering backlog so that what customers report is read on its
own terms rather than buried in internal work. You will see a reference like
`AGL-42` when it is filed; quote it if you follow up.

A report is closed when you have an answer — not when the code merges. Those
are different moments, and you are owed the first one.

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

A report we could not file tells you so plainly, hands you a reference id you
can quote to support, and leaves everything you typed in the open dialog. It
is never reported back to you as sent. Retrying is safe.

:::info Self-hosting
Issue reporting is one of the optional integrations in a
[self-hosted install](../developers/self-hosting.md), switched on with
`LINEAR_API_KEY` and `LINEAR_CUSTOMER_REPORTS_TEAM_ID` — both listed in that
page's **Optional keys** table, plus an optional
`LINEAR_CUSTOMER_REPORTS_PROJECT_ID` if you separate intake by project rather
than by team. It stays off until the operator supplies their own tracker
credentials, and it never files into Aglyn's tracker. Left unconfigured, the
dialog answers "Issue reporting is not configured on this deployment" and
names the required variables, rather than dropping the report silently.
:::

## Related

- [Support & community](support-and-community.md)
- [Manage account](manage-account.md)
- [Console tour](../getting-started/console-tour.md)
- [Self-hosting](../developers/self-hosting.md)

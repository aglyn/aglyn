---
sidebar_position: 5
title: Support triage runbook (internal)
description: How Aglyn staff triage an incoming support ticket — priority, the billing answers, and every escalation route out of the queue.
---

# Support triage runbook (internal)

:::warning Aglyn staff only
Requires a staff claim. `/admin/*` returns a **404** for everyone else.
:::

[Support queue](support-queue.md) documents the *screen*. This documents the
*job*: what to do with a ticket once it is open, in what order, and — the part
that was missing entirely until AGL-2141 — how to recognise the tickets that
are not support tickets at all.

## Why this exists

The [breach runbook](https://github.com/aglyn/aglyn/blob/main/docs/BREACH_NOTIFICATION.md)
names this queue as its **primary detection system**:

> The most likely way we learn of a breach is a human telling us … Treat that
> inbox as a detection system, because it is the primary one.

A detection system nobody was told how to read is not one. Sections
[§2](#not-a-support-ticket) and [§5](#escalation) are the parts that make that
sentence true.

## 1. Order the queue

Notifications fire on **open** and on **customer reply**, and deep-link to the
ticket (`?ticketId=`) — the bell is the working queue and there is no separate
inbox. Within it, work in this order, and note that the first rule outranks the
plan ladder:

1. **Anything in [§2](#not-a-support-ticket)** — security, abuse, legal,
   a data-protection request. These have statutory or evidentiary clocks that
   do not care what the customer pays.
2. **Money that is wrong right now** — a customer charged twice, charged after
   cancelling, locked out of a plan they are paying for. Every hour here is an
   hour of someone paying for something they cannot use.
3. **Blocked from working** — the site is down, publishing fails, they cannot
   sign in.
4. **Everything else, by support tier.**

The tier is a *commitment*, not a priority order — it is the promise we made,
and the ladder is asserted monotonic in code
(`libs/aglyn/src/lib/app-utils/support-tiers.ts`, `SUPPORT_BY_PLAN`), so read
it from there rather than from memory:

| Plan | Tier | First response |
| -- | -- | -- |
| Free, Starter | Community | forum only — **no ticket commitment** |
| Pro | Standard | 7–14 business days |
| Business, Scale, Advanced | Business | 4–6 business days |
| Agency | Priority | 1–3 business days |
| Enterprise | Dedicated | **24–48 hours**, clock time, named manager |

Enterprise is quoted in **clock** hours on purpose: 24–48 hours runs through a
weekend where "1–3 business days" does not. Read as business hours it would be
slower than Agency and invert the ladder; `ladderIsMonotonic` in that module
fails the build if it ever does.

Free and Starter carry **no first-response commitment**. That is a commercial
decision, not permission to ignore them — it means an unanswered Starter ticket
is not an SLA breach, and it still churns the customer.

## 2. This is not a support ticket {#not-a-support-ticket}

Read every new ticket against this list **before** answering it. Each row is a
different runbook, and in each case answering as support is the wrong action.

| It reads like | Route it to |
| -- | -- |
| "I can see another customer's data", "this URL shows me someone else's site", any report of data exposure | **[Breach notification](https://github.com/aglyn/aglyn/blob/main/docs/BREACH_NOTIFICATION.md)**. Do not reply first. §1 of that runbook is *preserve evidence*, and the Vercel runtime log holds ~60 minutes. |
| A vulnerability report, "I found a bug in your auth" | [`SECURITY.md`](https://github.com/aglyn/aglyn/blob/main/SECURITY.md) — 3-day acknowledgement. Confirm receipt, do not discuss specifics in the ticket thread. |
| A takedown demand, a DMCA notice, a counter-notice, a police or court request | **[Abuse reports](abuse-reports.md)**. DMCA has its own statutory clock and its own form. |
| Child sexual abuse material, or any report of it | **[Abuse reports § CSAM](abuse-reports.md)** — immediately, and above everything else on this page. |
| "Delete all my data", "send me everything you hold on me", a GDPR/CCPA request | **[Privacy requests](https://github.com/aglyn/aglyn/blob/main/docs/PRIVACY_REQUESTS.md)** — statutory deadline from the date received, so record that date first. |
| Several customers reporting the same failure within a short window | **[Incident response](https://github.com/aglyn/aglyn/blob/main/docs/INCIDENT_RESPONSE.md)**. Two tickets about the same symptom is a signal, not a coincidence — check [Staff → Health](platform-health.md) before answering either. |

The tell for the first and last rows is the same: **stop typing and go look**.
The reply can wait ten minutes; the evidence cannot.

## 3. The billing answers

These are what a first paying customer actually writes in about. Every one is
answerable from the org's staff detail page (**Staff → Organizations →** the
org) without touching Stripe.

- **"What am I being charged for?"** — the **Billing insight** card shows the
  org's Stripe invoice history and default payment method. Read it there rather
  than in Stripe: it is the same data, scoped to the org, and it leaves no
  chance of quoting another customer's invoice.
- **"I want to cancel / downgrade / change plan."** Do not do it for them
  unless they cannot. Self-service covers all of it — the customer's own
  **Billing** page cancels, resumes and switches plans, and **Manage billing**
  opens the Stripe customer portal for card and address changes.
  A **downgrade takes effect at the end of the cycle**, deliberately: they keep
  what they paid for and no proration credit walks the money back out. Tell
  them that, because the plan card will keep showing the old plan until
  renewal and it looks like the change did not take.
- **"I was charged after I cancelled."** Cancel sets `cancel_at_period_end`;
  it does not refund the period in progress. Check the invoice date against the
  cancellation date on the billing card before agreeing that anything is wrong.
- **"My bill is higher than the plan price."** Metered overage. The Billing
  page shows a month-to-date estimate from the same function that produces the
  invoice, so the card and the invoice cannot disagree — open it with them.
  Free and Starter-tier orgs cannot accrue overage at all
  (`meteredInfraPassThrough: false`); if one appears to have, that is a bug,
  not a billing question.
- **"Can I have a discount / an extension?"** — **Organizations → Discount**
  attaches a Stripe coupon, and **Entitlement override** grants entitlements
  without changing what they are billed. Both are audited **with a reason**.
  Write the reason for the person who reads it in a year, not for the form.

**Never** issue a refund, change a price, or edit a subscription in the Stripe
dashboard to solve a support ticket. Everything the console does is mirrored
back through the webhook and recorded; a dashboard edit is not, and the two
disagree from that moment on.

## 4. Acting on the customer's account

- **Impersonation** requires a reason (AGL-2125) and the dialog will not submit
  without one. Write what you are reproducing or the ticket number — the audit
  entry is the only record of why that session happened, and "support" is not
  a reason.
- It **replaces your staff session in this browser**. The impersonation banner
  is the exit; use a separate window if you need the staff console at the same
  time.
- **Staff notes** on the org detail page are the right place for support and
  billing context that the next person will need. The ticket thread is visible
  to the customer; the note is not.

## 5. Escalation, and what we do not have {#escalation}

Be straight about this, because a runbook that implies capacity we lack is
worse than one that admits the gap:

- **There is no on-call rotation.** Support is one person, and the incident
  runbook records an 8-hour overnight floor. Nothing pages anyone.
- **There is no status page.** Incident communication is email only. If several
  customers are affected, the incident runbook's comms section is the only
  mechanism.
- **`security@`, `abuse@` and `dmca@` are not confirmed to deliver** (AGL-1973)
  — and `security@` is the declared primary breach-detection channel. Until
  that is closed, a report arriving through the support queue may be the only
  copy that reaches anyone. Treat §2 as load-bearing.

## Related

- [Support queue](support-queue.md) — the screen
- [Support & community](../workspace-and-billing/support-and-community.md) —
  what the customer sees
- [Support tiers](../enterprise/support-tiers.md) — the commercial commitment
- [Staff console overview](overview.md)

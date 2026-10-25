---
sidebar_position: 5
title: Support triage runbook (internal)
description: How Aglyn staff triage an incoming support ticket — priority, the billing answers, and every escalation route out of the queue.
---

# Support triage runbook (internal)

:::warning Aglyn staff only
Requires a staff claim. `/admin/*` returns a **404** for everyone else.
:::

[Support queue](support-queue.md) documents the *page*. This documents the
*job*: what to do with a ticket once it is open, in what order, and — the part
that was missing entirely until AGL-2141 — how to recognize the tickets that
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
   canceling, locked out of a plan they are paying for. Every hour here is an
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
| A vulnerability report, "I found a bug in your auth" | [`SECURITY.md`](https://github.com/aglyn/aglyn/blob/main/SECURITY.md) — 3-day acknowledgment. Confirm receipt, do not discuss specifics in the ticket thread. |
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
- **"I was charged after I canceled."** Cancel sets `cancel_at_period_end`;
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
- **`security@`, `abuse@` and `dmca@` deliver** — confirmed 2026-08-19
  (AGL-1911) from Google Workspace group configuration: each is a Google Group
  accepting posts from anyone on the web, unmoderated, with a single member
  subscribed to every message. What is *not* closed is that each has exactly one
  member and sends no auto-acknowledgment (AGL-2400) — so mail is accepted and
  archived whether or not anyone is reading. `security@` is the declared primary
  breach-detection channel, and the 72-hour clock runs from awareness, so a
  report arriving through the support queue may still be the copy someone
  actually sees. Treat §2 as load-bearing.

## 6. Site Care requests {#site-care}

A **Site Care** request is a support ticket from a workspace that has the Site Care
add-on. It arrives when a member presses **Request a change** on a site's dashboard,
or by email. Site Care has no email address of its own: owners write to the support
address, and a message from a member of a workspace with Site Care, sent from the
address they sign in with, files itself as a Site Care request on that workspace. A
reply to any Site Care email joins its own request. The queue marks it with a
**Site Care** chip and a clock: the promise is the change **done** within 2 business
days, so the clock runs until the request is closed, not until the first reply, and a
reply on the thread does not stop it.

- **Everything else stays as it was.** A message to the support address from anyone
  who is not a member of a workspace with Site Care is ordinary support mail, and
  nothing is sent back to its sender automatically. Out-of-office and other automatic
  replies are never filed, even from a member.
- **Answer on the request, not from the inbox.** A Site Care request that came by
  email is still in the support inbox too. Reply from the request's thread, so the
  owner's answer joins the same request instead of opening a new one.
- **A sender in more than one Site Care workspace.** An emailed request from someone
  who is a member of several workspaces with Site Care is filed on one of them, and
  the others are kept with the request. The staff notice for the new request names
  them, and the **Site Care** card says "Also a member of" with their names. If the
  request belongs to one of the others, use **Move to workspace** on the card (see
  below). Only staff see the other workspaces; the workspace the request is on does
  not.

### Working a request {#site-care-working}

The **Site Care** card in the ticket's thread is where every step is taken. Each step
writes a dated record that can never be edited, and a staff audit row beside it.

1. **Open it.** The timer starts the first time anyone opens the request, once.
2. **Make the change** on the site in the Besigner and **Save & publish**. The publish
   is linked to the request when you close it.
3. **Close with minutes**: one number. The box is filled from the timer, rounded
   up to 5 minutes; change it if the timer ran while you waited. Each request counts
   against the month's included hour in 15-minute blocks, rounded up.
4. **Past the included hour**, the close is refused until the owner has said yes.
   **Ask the owner first**: tell them the extra time it needs and wait. When they say
   yes (at the booth, by phone, by text or by email), choose **Record approval** and
   enter how and when they said it and the hours. Saving it emails them a
   confirmation, which is the written record. Or **Absorb it**: close with no charge;
   the minutes still count.
5. With an approval on file, the close adds the extra time to the workspace's next
   subscription invoice: whole hours, rounded up, never fewer than the hours
   approved. The owner is emailed what changed, the time and the time left.

**Corrections.** Every correction needs a reason, and the owner is emailed the before
and after.

- **Correct minutes** on a closed request until the invoice carrying it finalizes.
  The pending charge is changed or removed to match.
- **Correct approval** records a new version of the owner's yes; the first stays in
  the history.
- **Reverse charge** voids, credits or refunds the charge from the request: removed
  before the invoice finalizes, credited after, refunded once paid, tax included. Never change a Site
  Care charge in the Stripe dashboard; the request is the only door, and a change
  made anywhere else is reported by the reconciliation.
- **Retry charge** appears when Stripe refused or did not answer. It reuses the
  charge's own key, so it cannot bill twice.

**Bigger than Site Care covers.** When the work adds something new (a page, a form, a
redesign), use **Send quote** with one flat price and what it covers. The owner
replies to accept; the invoice is a separate step.

**Move to workspace.** For an emailed request whose sender is in several Site Care
workspaces, choose the workspace it belongs to from the ones the card lists. The
request, its thread and its history move there: its time counts against that
workspace's included hour for the month, and the summary goes to that workspace's
owner when you close it. A dated record of the move and a staff audit row are
written; nothing earlier is changed, and the owner is not emailed about the move. The
button stays on the card but is turned off, with the reason on hover, once the request
is closed, once the owner's approval of extra time is recorded on it, or once extra
time has been charged on it, because each of those belongs to the workspace it is on.
It can only move to a workspace the sender was a member of when they wrote, that still
has Site Care, and that they are still a member of.

### The month and the statement {#site-care-month}

The **Site Care** card on the staff page for the workspace shows the month: every
request with its minutes, billing and history, the totals, and the month's own
records. **Add goodwill minutes** (with a reason) raises that month's included time at
no charge. **Send statement** emails the owner the month: every request, the minutes,
the extra time and every correction.

### When the reconciliation alerts {#site-care-reconciliation}

Once a day each closed request's charge is compared with its Stripe invoice item, and
each month's total with Stripe's, for this month and the last. Each request is also
checked against its own record: the minutes logged, the included time they used and the
owner's recorded yes must come to the hours billed (every started hour past the included
time, never fewer than the owner approved), and nothing may bill without that yes unless
it was absorbed. The same check compares
each project's invoices with Stripe (see below). A difference raises **Site Care billing
does not match Stripe** (Should know) for that workspace and month, or for its projects.
It changes nothing on either side. Open the request or project it names: retry a charge
or invoice that is stuck or failed, use **Check payments** on a project whose invoice
was paid without being recorded, and fix anything edited in Stripe from the record.

### Charging for a project {#site-care-projects}

Work that adds something new (a page, a form, a redesign, logo or brand work, a
campaign) is a project with one flat price, never hourly. It is billed from **Charge
for work** on the staff page for the workspace, on its own invoice that the owner pays
on their phone. Never build a project invoice by hand in the Stripe dashboard.

1. **Quote it.** Press **Charge for work**. Name the project, list what the price
   covers (one deliverable per line), choose the kind and enter the hours you estimate.
   The quote is the hours rounded up to the whole hour at the extra-time rate, and never
   below the kind's starting price on aglyn.com/pricing. You can raise the price; you
   cannot lower it. **What the owner sees** shows the quote as they will read it.
2. **Get the owner's yes.** Tell them the price and what it covers. When they agree (at
   the booth, by phone, by text or by email), choose **Record the owner's yes** and enter
   how and when. Saving it emails them a confirmation of the scope and price, which is
   the written record. Nothing can be invoiced before this.
3. **Send the invoice.** A larger project is billed half up front and half at launch; a
   smaller one in full up front, and the quote says which. **Send deposit
   invoice** (or **Send invoice**) makes the invoice and emails the owner the pay link.
   The card shows the link and a QR code: the owner can scan it and pay on the spot.
4. **Paid.** The project records the payment by itself and emails the owner a receipt.
   If it still shows the invoice as waiting after they paid, press **Check payments**.
5. **Launch.** When the work is live, press **Mark launched**. A half-and-half project
   sends the balance invoice in the same step.

**Corrections.** Every correction needs a reason, is kept in the project's history and
emails the owner.

- **Edit quote** changes the name, scope or price until the first invoice is sent. The
  owner's yes must then be recorded again, for the new quote. After the first invoice
  is sent, the price is fixed: an overrun is ours. A different price is a new project.
- **Correct the yes** records a new version of how and when the owner agreed, and
  re-sends the corrected confirmation.
- **Void** cancels an unpaid invoice. **Credit note** clears what is owed on an unpaid
  invoice, with its tax. **Refund** returns a paid invoice, with its tax, to the card.
- **Retry invoice** appears when Stripe refused or did not answer. It finds and reuses
  what the first try made, so it cannot invoice twice.

## Related

- [Support queue](support-queue.md) — the page
- [Support & community](../workspace-and-billing/support-and-community.md) —
  what the customer sees
- [Support tiers](../enterprise/support-tiers.md) — the commercial commitment
- [Staff console overview](overview.md)

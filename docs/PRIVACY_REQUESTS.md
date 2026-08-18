<!--
 Copyright 2026 Aglyn LLC — Apache-2.0
-->

# Privacy requests (DSAR) runbook (AGL-1915)

How a data-subject request arrives, how we verify who sent it, where we look,
what we send back, and by when. Written to be executable by someone who was not
in the room when it was written.

Companions: `docs/DATA_RETENTION.md` (what we hold and for how long),
`docs/BREACH_NOTIFICATION.md`, `docs/INCIDENT_RESPONSE.md`.

**From 2026-09-01 a stranger can invoke these rights.** Nothing here is
hypothetical and the clock does not wait for us to be ready.

## 0. The one thing to get right first: are we the controller or the processor?

This decides everything downstream and it is decided by *whose* data it is, not
by who is asking.

| The data is | We are | What we do |
| --- | --- | --- |
| An Aglyn account holder's — their profile, email, phone, memberships, billing, support tickets, Assist questions | **Controller** | Answer it ourselves. The rest of this runbook. |
| A visitor to a **customer's published site** — a form submission, a contact record, an order, a booking, a site member | **Processor** | Refer them to the customer, then assist the customer. §6. |

Published Privacy Policy §7 states this split in terms:

> If your request concerns personal information we process on behalf of a
> customer (as processor), please contact that customer directly; we will
> assist them as required by the DPA.

A request that mixes both — a person who is both an Aglyn account holder and a
lead on someone else's site — is two requests. Split them and say so in the
reply; answering the controller half and silently dropping the processor half
is the failure mode.

## 1. How a request arrives

| Channel | Where it lands | Status |
| --- | --- | --- |
| `privacy@aglyn.com` | A Workspace mailbox | **The published intake. Existence unverified — AGL-1973.** Confirm this before Sept 1; a bounce does not stop the clock. |
| `security@aglyn.com` | Workspace | Vulnerability reports, per `docs.aglyn.com/trust`. Same unverified status. |
| Support ticket | `/admin/support` | Real and working. Staff see a `support.ticketOpened` notification with a deep link. |
| Phone opt-out ("stop calling me", "delete my number") | `/admin/contact-suppressions` | Real and working (AGL-1592). Its own path — §5. |
| In-product self-serve | the customer does it themselves | §4. Always offer this first. |

**The support queue is not a DSAR queue and must not be used as one.** A ticket
opened on Pro carries a first-response commitment of **7–14 business days**
(`libs/aglyn/src/lib/app-utils/support-tiers.ts`), which is most of a GDPR
month spent before anyone has read the request. If a DSAR arrives as a ticket,
take it out of the queue immediately and start the clock in §2 — do not let the
support SLA be mistaken for the statutory one.

## 2. The clock

**We publish no response deadline of our own**, deliberately, and that is the
right posture — a self-imposed window shorter than the statutory one is a
promise we can miss for free. Verified: no "30 days", "45 days" or "one month"
appears anywhere in the published Terms or Privacy Policy. The only 30-day
window in the Terms is the §18.5 arbitration opt-out, which is unrelated.

So the statutory clocks apply, and they start **on receipt**, not on
verification:

| Regime | Deadline | Extension |
| --- | --- | --- |
| GDPR / UK GDPR | **1 month** from receipt | +2 months for complex or numerous requests — you must **tell them inside the first month**, with reasons |
| CCPA / CPRA | **45 days** | +45 days, again with notice inside the first window |
| Confirmation of receipt | Not required by either, but **send one the same day** | — |

Under Option A the service is global, so treat every request as GDPR-clocked
unless you know otherwise. One month is the number to work to.

**Record the receipt date the moment the mail is read.** There is no DSAR
tracker today; until there is one, the record is an `adminAudit` row (§7) plus
the mail thread itself.

## 3. Verifying identity

Privacy Policy §7: *"We will verify your request as required by law."* Neither
GDPR nor CCPA prescribes a method; both require proportionality, and **both
treat over-collection as its own violation** — do not ask for a passport scan
to confirm an email address.

In descending order of strength, use the strongest available:

1. **The request comes from the account's own signed-in session.** Self-serve
   (§4) is this — the product already re-authenticated them within the last
   five minutes. Nothing further is needed.
2. **The request comes from the address on the account.** Confirm the sender
   matches an account: `/admin/users` → type the address → **Find exact email**
   → `GET /api/admin/users?email=…`, which searches the project pool **and
   every SSO tenant pool** (`findUserByEmailAcrossPools`, AGL-1122). A match is
   good verification for an access or deletion request about that account.
3. **The address does not match, or there is no account.** Send a
   confirmation link to the address **on the account**, not to the address that
   wrote in. If no account exists, say so — "we hold no account for this
   address" is a complete and correct answer to an access request, and it must
   not be preceded by asking them for identity documents to prove a negative.
4. **An authorised agent.** Privacy Policy §7 allows one. Ask for the
   subject's written authorisation, then verify the *subject* by (2) or (3).

⚠️ **Never verify by asking the requester to confirm data we hold.** "Is your
address still 12 Elm Street?" discloses the data to whoever is asking, which is
the attack this step exists to stop.

If verification fails, say what would satisfy it and keep the clock running.

## 4. Offer self-serve first — it is faster and it verifies itself

For an account holder who can still sign in, these are complete, audited,
reversible-where-it-matters, and need no staff involvement:

| Right | Where | Guards |
| --- | --- | --- |
| **Erasure — account** | `/manage/user` → "Close account" → **Close account permanently** | Password or re-auth popup, plus typing `DELETE`. Refuses while they solely own an org, **naming which** |
| **Erasure — workspace** | `/[orgSlug]/settings` → **Delete** tab → **Delete organization** | Owner only; type the org name; the retention funnel; then a **7-day reversible hold** with a **Cancel deletion** button |
| **Erasure — one site** | `/[orgSlug]/hosts/[host]/admin` → **Delete site** | Site admin. Immediate, no hold |
| **Rectification** | `/manage/user` and org settings | Self-service |
| **Call/text opt-out** | reply STOP, or ask us — §5 | |

Reply with the link and the exact button name. "Sign in and go to Settings →
Delete" is a complete answer to an erasure request from someone who can sign
in, and it is stronger than us doing it for them because it cannot act on the
wrong account.

## 5. Executing each right when staff must do it

### Access ("what do you hold about me")

There is **no export capability** — see AGL-1974. This is assembled by hand
today. Work the list in §"Where to look" below, in order, and paste the result
into the reply. Do not paste raw documents: strip internal ids that mean
nothing to the subject, and never include another person's data that happens to
sit in the same record (a members roster, a support thread with two authors).

### Erasure, when self-serve cannot reach them

**A person** — lost account, departed SSO user, request by email from someone
who will never sign in again:

```
POST /api/admin/users/manage
{ "action": "erase", "uid": "<uid>", "reason": "<DSAR ref>" }
Authorization: Bearer <super-staff ID token>
```

Requires `staffRole === 'super'`, a non-empty `reason`, and refuses
self-erasure. **There is no button for this** (AGL-1977) — and note that
`tools/scripts/lib/erase-org-cli.mjs` tells you there is one; there is not.

It refuses with `skippedReason: 'owns-orgs'` and a `blockers` list if they own
a workspace. That refusal is correct — deleting a workspace as a side effect of
closing a personal account is consent nobody gave. Tell them which orgs need
transferring or deleting first.

**A workspace** — staff console, and this is the surfaced path:

`/admin/orgs` → the org's row → **Erasure** (or `/admin/orgs/[orgId]` → Staff
actions card). It sets `erasureRequestedAt`, writes an `adminAudit` row and
emails the owner. It **deletes nothing**: the daily `run-erasures` cron
(04:00 UTC) executes it after the 7-day hold and emails a confirmation. The
button toggles to **Cancel erasure** for the whole hold.

To run it by hand — the cron is stuck, or the hold has elapsed and you need it
today:

```bash
set -a && source .env && set +a
# PLAN first. Without --confirm every sweep queries and nothing writes.
node tools/scripts/erase-tenant.mjs --org <orgId> --actor <your-uid>
# Then, having read the plan:
node tools/scripts/erase-tenant.mjs --org <orgId> --confirm --actor <your-uid>
```

The script **calls `eraseOrg`** rather than reimplementing it (AGL-1481), so
the manual path and the cron cannot drift. It refuses before the 7-day hold and
so does the function; there is deliberately no bypass on either.

### Rectification, restriction, objection

No mechanism beyond editing the record. `/admin/users/[uid]` →
`updateProfile`. Restriction and objection have no product representation at
all — handle them by correspondence and record what was agreed. Say so plainly
if asked; the honest answer is better than an implied capability.

### Portability

Same gap as access (AGL-1974). The site-export feature is **not** this: it is a
design backup, Pro+, and its own header comment says it *"never includes …
bookings/leads/submissions (PII)"*. Do not offer it as a portability answer.

### Phone: "stop calling me" vs "delete my number"

These are **different requests with opposite data outcomes** and the Privacy
Policy §11 offers both in one sentence, so the requester will often not have
distinguished them.

- *Stop contacting me* → record a suppression at
  `/admin/contact-suppressions`. This **keeps** the number, because
  recognising it is the only way to honour the request. §11 says so.
- *Delete the number you hold* → remove it from the account **and** record the
  suppression, which still keeps a hashed do-not-contact record. Explain this
  in the reply; a person who asked for deletion and later learns we kept a
  record will read it as a broken promise unless we said it first.

⚠️ **SSO re-asserts the number on the next sign-in.** `/api/auth/sso-jit`
takes the phone from the customer's IdP, so a naive delete on an SSO account
silently undoes itself. The suppression record is what survives it (AGL-1592).

## Where to look — the completeness checklist

**The blind spot to know about before you start:** walking `orgs/{orgId}` and
`users/{uid}` feels complete and is not. Firestore's cascade is path-scoped, so
every top-level collection that merely *carries* an org id or a uid is
invisible to it. That is a documented hazard for deletion
(`erase.ts:163`, AGL-1444/AGL-1448) and it is the **same** hazard for access —
an enumeration built by walking the tree omits exactly what an erasure would
have omitted, and nothing warns you.

Work this list, not the tree.

**Under the person**
- `users/{uid}` — profile, name, phone, postal address, `legalAcceptances`
- `users/{uid}/orgs`, `/hostMemberships`, `/notifications`, `/passkeys`
- Auth record — email, providers, GCIP pool, `phoneNumber`. Console:
  `/admin/users/[uid]` renders all of this, plus a 15-row audit slice.
  ⚠️ the Organizations card reads `users/{uid}/orgs` at **`limit(50)`** —
  a person in more than fifty workspaces is silently truncated.
- **`profiles/{uid}`** — world-readable handle, display name, Stripe Connect
  account. **Not reachable from the user tree**, so a walk still misses it on an
  ACCESS request; `eraseUser` deletes it explicitly (AGL-1970).
- Storage `users/{uid}/` — avatar

**Under each workspace they belong to**
- `orgs/{orgId}` and every subcollection: members, invites, roles, usage,
  apiUsage, analytics, datasets/records, contacts, contactSegments, lists,
  media, mediaFolders, installs, activity, `retention` (churn survey free text)
- **`orgs/{orgId}/assistExchanges`** — their Assist questions and the answers,
  **verbatim**, keyed by `uid`. Easy to forget; often the most personal thing
  we hold (AGL-1972)
- `hosts/{hostId}` trees for that org — screens, layouts, orders, webhooks,
  form submissions
- Storage `orgs/{orgId}/`, `hosts/{hostId}/`

**Top-level, keyed by field or id — the part a tree walk misses**
- `apiKeys` (creating uid, label, scopes)
- `ssoDomains`, `consoleDomains`, `orgSlugs` (including rename tombstones)
- `stripeCustomers`, `apiIdempotency`
- `supportTickets` + `messages` — subject, body, `authorEmail`. An **org**
  erasure destroys the thread; a **person** erasure redacts their `authorId`
  and `authorEmail` and leaves the org's thread standing, body included
  (AGL-1971). On an access request the body is still theirs to see.
- `publisherProfiles`, `publisherHandles` — swept by `eraseOrg` (AGL-1970), but
  still list them on an **access** request: an erasure reaching them says
  nothing about a tree walk finding them.
- `marketplacePurchases`, `marketplaceListings/{id}/reviews/{authorUid}`,
  `marketplaceReports`
- `contactSuppressions` — a hashed do-not-contact record, if any
- `adminAudit` — actions by and on them. `/admin/audit` → **Export CSV**

**Outside Firestore**
- Stripe — customer object, payment methods, invoices
- Resend — transactional email delivery logs
- Google Analytics — 14-month retention, not keyed to an account

**Deliberately excluded from erasure, and disclose them on an access request**
- `platformRevenue`, `storefrontTaxCollected` — statutory tax records
  (AGL-1811/AGL-1904). GDPR Art. 17(3)(b) exempts them from erasure; it does
  **not** exempt them from access. If a transaction of theirs is in there, it
  is disclosable.
- `contactSuppressions` — kept precisely so we can honour "stop contacting me".

## 6. When we are the processor

The requester is a visitor to a customer's site.

1. Reply to the requester: name the customer as the controller and point them
   there. Do not disclose anything about the customer's data to a third party
   verifying nothing — that would itself be a breach.
2. Tell the customer, via their support channel, that a request arrived.
3. Assist them under DPA §8. In practice that means showing them where the data
   lives in their own console — Contacts, form submissions, orders, bookings —
   and how to delete a record (`/api/resources/erase`, which recursive-deletes
   a resource and everything under it, AGL-945).
4. Do **not** delete a customer's data on a third party's say-so. The
   instruction has to come from the controller.

## 7. Logging the request

There is no DSAR register. Until AGL-1974 gives us one, write an `adminAudit`
row for every action taken and keep the mail thread. What the record must
contain: **when it arrived**, what was asked, how identity was verified, what
was done, and when the reply went out. That set is what an audit or a
supervisory-authority query will ask for, and reconstructing it later from
memory does not work.

Audit rows are retained ~15 months (90 days hot, then a 365-day archive), which
comfortably outlives the response window.

## What we cannot do today — say this plainly rather than improvising

| | Filed |
| --- | --- |
| We cannot export a person's data. Access and portability are answered by hand. | AGL-1974 |
| We do not know that `privacy@aglyn.com` receives mail. | AGL-1973 |
| A staff erasure of a **person** has no button. | AGL-1977 |
| ~~Erasure does not reach `profiles`, `publisherProfiles` or `publisherHandles`.~~ **Closed 2026-08-18 (AGL-1970)** — all three are swept, and a surviving marketplace listing leaves only a content-free tombstone. | AGL-1970 |
| ~~Erasure does not reach `supportTickets`.~~ **Closed 2026-08-18 (AGL-1971).** One caveat to say accurately if asked: erasing a **person** redacts their name and email from support threads but does not delete the threads — those belong to the workspace, and only the workspace can ask for them. | AGL-1971 |
| Assist Q&A has no retention period. | AGL-1972 |
| Restriction and objection have no product representation. | — |
| There is no DSAR register. | AGL-1974 |

Last reviewed **2026-08-18** against Privacy Policy **v4** and the live DPA.
Terms v5 and a privacy update were publishing the same day — re-read §7 and §5
of the published text before quoting a deadline or a right to anyone.

# AGL-1648 (b) — subprocessor change notification: the commitment now exists, and nothing can honour it

**Status: the commitment shipped on 2026-08-18 and is now the harder problem.**

The benchmark finding was *"change-notification is promised but has no mechanism."* Since
then the promise got **more specific**, not less: the published DPA and the published
Subprocessors page both now commit to **thirty (30) days advance notice**. Nothing was built
to honour it. A vague promise is soft; a dated one is a breach with a calendar attached.

**Do not publish from this file.** Google Docs are source of truth for the legal wording.
The build items in §5 are repo work and need no Doc edit.

---

## 1. What is live today

Read once from live on **2026-08-24** through a real browser. Both pages **Last updated:
August 18, 2026**.

**DPA §7.2**, verbatim:

> Aglyn will impose data-protection obligations on Sub-processors that are substantially
> similar to those in this DPA, and remains responsible for their performance. Aglyn may add
> or change Sub-processors. **Before a new Sub-processor begins processing Customer Personal
> Data, Aglyn will publish it in the change log on the Subprocessors page at least thirty (30)
> days in advance.** Customer may object to a new Sub-processor on reasonable data-protection
> grounds within that period by writing to support@aglyn.com, and Aglyn will work with Customer
> in good faith to address the objection. Where a change is required to protect the security or
> availability of the Services, or is imposed by an existing Sub-processor, Aglyn may make it on
> shorter notice and will publish it in the change log as soon as practicable.

`/legal/subprocessors` carries the matching intro paragraph and an **eleven-row** core table
(was seven on 08-14): Firebase Auth, Firestore, Cloud/Firebase Storage, Vercel, Stripe,
Resend, reCAPTCHA, **Google Analytics**, **Google Fonts**, **Google Cloud Logging**,
**Anthropic** — plus Google Workspace and Google Cloud DNS under *Related services*.
AGL-1659 (Anthropic) and AGL-1670 (Google Analytics) are both closed by that publish.

This is a real, well-drafted mechanism. Three things are wrong with it, in ascending order
of severity.

---

## 2. Problem 1 — the notice has no reader

Applying the *written but never read* test:

| | Today |
| --- | --- |
| **Who WRITES the change?** | A human, by hand, clicking the besigner page. There is no code path, no trigger, and no registry. `tools/scripts/lib/legal-doc-diff.mjs` says so in its own header: *"subprocessors → no registry exists."* |
| **Who READS the notification?** | **Nobody.** There is no email, no subscription list, no feed, no in-console notice, no webhook. A customer's only route is to remember, unprompted, to reload `aglyn.com/legal/subprocessors`. |

So the 30-day objection window and the SCC Clause 9 rights that hang off it depend entirely
on a customer voluntarily polling a static page. Publish-and-poll is a common DPA pattern
and is defensible **when it is paired with something to subscribe to.** Here there is
nothing to subscribe to, and — because the change log is besigner content with no feed and
no version history — Aglyn cannot afterwards prove *when* an entry was published either.
Under SCC Clause 9(a) the burden of showing the exporter was informed sits on the importer.

Compounding it: the objection route `support@aglyn.com` **sends no acknowledgement**
(AGL-2400 — none of the six published intakes do). So a customer who does object gets no
receipt, and neither party holds evidence the 30-day window was used.

## 3. Problem 2 — nothing detects that a new subprocessor arrived

The 30-day clock can only start if somebody *knows* a vendor is coming 30 days out. The
repo's only structural detector is **Anthropic-specific**:
`apps/console/specs/assist-anthropic-subprocessor-gate.spec.ts` pins the exact set of files
that read `ANTHROPIC_API_KEY`, on the explicit reasoning that *"a new reader is a new
Anthropic data flow, and it fails here until someone has looked at whether the published
subprocessor page and privacy disclosure still describe reality."* That is exactly the right
shape. It covers one vendor.

For every other vendor, disclosure happens when somebody remembers. That has already failed
twice, both found by audit rather than by a check:

* **AGL-1670** — GA4 ran on three properties from AGL-118 and was absent from the register
  for weeks. *"A correct fix to two documents left a third stale."*
* **Google Fonts and Google Cloud Logging** — both were live and processing visitor IPs
  before 2026-08-18. Their change-log entry is a **retroactive** disclosure, i.e. the
  opposite of 30 days advance notice. Not fixable now; it is the failure mode demonstrating
  itself.

### 3a. ⛔ Linear is a live subprocessor and is not on the published list

**This is the finding this pass exists to produce, and it is the third instance of the same
shape.** It is a *live* under-disclosure, not a capability question.

`apps/console/components/report-issue-dialog.component.tsx` — the console's shipped "Report
an issue" dialog — POSTs to `apps/console/app/api/issue-reports/route.ts`, which files the
report into **Linear** over `LINEAR_API_KEY`. The payload the route builds includes, at
lines 369–390:

```
reporterUid: decoded.uid,
reporterEmail: decoded.email ?? null,
orgId, orgName,
title, description: body,      // the free text the customer typed
```

So a customer's **email address**, their org's name, and whatever they write goes to
**Linear Orbit, Inc.** — a third-party US/EU SaaS that appears nowhere on
`/legal/subprocessors`, nowhere in the Privacy Policy, and nowhere in the DPA.

Evidence it is live, not dormant:

* `docs/SECRET_ROTATION.md` row 7 lists `LINEAR_API_KEY` with scope **"project, console"** and
  grant *"read/write on the Aglyn Linear workspace"* — i.e. it is set on the production
  console project. Unset, the route 501s (AGL-2185); it is not unset.
* `tools/deploy/verify-env-isolation.mjs:218` tracks it as a real deployed secret (AGL-2403).
* The dialog ships in the console; `apps/console/specs/issue-report-route.spec.ts` exercises
  the filing path.
* `docs/SELF_HOSTING.md:427` documents it as a first-class integration, and explicitly warns
  self-hosters to point it at *their own* workspace — which is precisely an acknowledgement
  that customer reports are personal data leaving to a tracker.

Why every existing check missed it: Linear is reached by a **server-side `fetch` to
`api.linear.app`**, so it is in no package's source and the dependency-egress scan cannot
see it (`tools/scripts/dependency-egress-register.json` covers hosts found *in packages on
disk*, and says so). It sets no cookie, so `cookie-inventory.ts` cannot see it. It is not
`ANTHROPIC_API_KEY`, so the one subprocessor guard that exists cannot see it. And
`check:legal-drift` compares prose to prose, so it is structurally blind by design. **Four
green checks, one undisclosed processor.**

This is why Tier 0's trigger set must include **outbound vendor hosts reached by
server-side `fetch`**, not only env vars and package hosts. `api.linear.app` is the
regression test.

**Needs a decision, and it is the one item here that cannot wait for the notice period:**
Linear is already processing. The 30-day advance-notice rule does not apply retroactively —
the fix is to publish the row now and record it in the change log as a correction, exactly
as GA/Fonts/Cloud Logging were handled on 08-18. Draft row, matching the live table's five
columns:

> `| **Linear** | Linear Orbit, Inc. | Filing and triage of issue reports submitted by users through the console's "Report an issue" dialog | Reporter's email address and account identifier, organization name and identifier, and the report text and metadata the reporter submits | United States |`

Change-log line:

> `- **[DATE]** — Added Linear (issue reports submitted through the console). Correction: this subprocessor was in use before this entry; the thirty-day advance notice in DPA Section 7.2 applies to new subprocessors and could not be given retroactively.`

Alternatively, if the exposure is judged not worth the disclosure, the other honest fix is to
**unset `LINEAR_API_KEY` in production** — the route 501s cleanly and the dialog says so.
That is a one-line env change and it is the cheaper option if "Report an issue" is not
load-bearing for the beta.

### 3b. Two smaller code-vs-published gaps on vendors already listed

Neither adds a legal entity, so neither is a missing subprocessor. Both are the published
*description* being narrower than the code.

**(i) The GA row does not disclose the server-side Measurement Protocol path.** The
published cell says GA is *"configured for measurement only — Google Signals off, ads
personalization disabled in every region, … no user-provided data collection."* True of the
browser tags. But `libs/tenant/data/admin/src/lib/server/ga4-measurement-protocol.ts` POSTs
`purchase`, `refund`, `subscription_cancelled` and `site_published` to
`https://www.google-analytics.com/mp/collect` from the **server**, on `GA4_MEASUREMENT_ID` +
`GA4_API_SECRET` — both present on all three Vercel projects since 2026-08-17 per
`docs/ANALYTICS.md`. That path has **no browser consent gate**, because there is no browser
in it. And where the real `ga_client_id` was not carried on the Stripe metadata, the
`client_id` is **synthesized from the Stripe customer id** — a stable pseudonymous
identifier derived from a paying individual, which is a stronger identifier than the cookie
the row describes. `sanitizeEventParams` does strip email-shaped values and reduce URLs, so
the mitigation is real; it is the disclosure that is behind. One sentence added to the
Purpose or Data-processed cell closes it.

**(ii) Firebase Realtime Database is used and no row names it.** `apps/console/hooks/use-presence.ts`
plus `cloud/firebase-database.rules.json` — editor presence, i.e. which user is in which org
and site, live. Same legal entity as the Firestore row (Google LLC), so the transfer analysis
is unchanged, but the register names products and RTDB is a distinct one. Cheapest fix is to
widen the existing cell rather than add a row.

Adjacent gap worth a decision, not yet a defect: `libs/aglyn/src/lib/app-utils/advertising-tags.ts`
declares `ADVERTISING_VENDORS = [META_PIXEL_VENDOR, GOOGLE_ADS_VENDOR]`, gated to the
platform marketing host and consent. The module comment records that **no host document
carries `adTags` today** — so nothing is processing. But per the standing rule that legal
docs track *capability, not rollout*, and given GA (also Aglyn's own properties, not the
Services) did get a row, Meta and Google Ads arguably owe one too. The 30-day rule makes
this easy rather than awkward: **publish them now with the notice period running, so the
capability can be switched on the day it is wanted.** Publishing late is the expensive
option.

*(Two smaller repo-vs-reality notes, neither a disclosure gap: the register's
`cdn.jsdelivr.net` entry still says the Raw JSON editor pulls Monaco from jsDelivr at
runtime — AGL-1779 self-hosted it under `/monaco/vs` and the build fails if the copy is
missing, so the note is stale. And the published row says "Google Cloud Logging" where
`error-beacon.ts` says "Google Cloud Error Reporting"; same GCP stack, but the register
should use the name the code uses.)*

## 4. Problem 3 — the first test of the 30-day rule is a launch conflict ⚠

**Anthropic was published to the change log on 2026-08-18. Thirty days later is 2026-09-17.**

The published DPA now says Anthropic may not begin processing Customer Personal Data before
that date. But:

* `libs/plugins/marketplace/src/lib/server/ai-assist.ts` — the besigner copy assistant at
  `/api/ai/assist` — **carries no release flag**. Per the AGL-1909 guard's own analysis,
  *"setting that key in production makes Anthropic a subprocessor whether or not the Assist
  flag is ever flipped."* The gate is `ANTHROPIC_API_KEY` + a Pro entitlement, nothing else.
* Public beta launches **2026-09-01**, sixteen days early.

So: **if `ANTHROPIC_API_KEY` is set on the production Vercel projects before 2026-09-17,
Aglyn breaches its own DPA §7.2 on the first subprocessor it ever noticed.** The repo record
(AGL-1555's note in `apps/console/constants/legal-documents.ts`) says the key is absent from
production and the route 501s — that needs confirming against the live Vercel env key list,
not assumed.

Three ways out, and this is a decision only Zach can take:

1. **Hold the key until 2026-09-17.** Free. Costs sixteen days of Assist at launch.
2. **Re-publish the change-log entry with an explicit effective date** and treat 08-18 as the
   notice for a Sept-1 start — only honest if the 30 days are then measured from a *new*
   entry, which lands on 2026-09-23 and is worse.
3. **Accept and document.** Aglyn has no EEA customers under an SCC-backed DPA today, so the
   practical exposure is near zero. But writing "we breached it and nobody noticed" into the
   record on day one of the mechanism is precisely the habit this issue exists to prevent.

**Recommendation: (1).** Sixteen days.

---

## 5. What has to be BUILT

Three tiers. Tier 0 is the one that makes the commitment honourable; Tier 1 is what gives
the notice a reader. Estimates are agent-days on this codebase.

### Tier 0 — a subprocessor registry with a guard *(≈1 day — do this one)*

`apps/console/constants/subprocessor-inventory.ts` + `subprocessor-inventory.spec.ts`,
modelled directly on `cookie-inventory.ts` / `assist-anthropic-subprocessor-gate.spec.ts`,
which already solve the identical problem for cookies and for one AI vendor.

Each entry declares:

```ts
{
  id: 'anthropic',
  legalEntity: 'Anthropic, PBC',
  publishedRow: '…',                 // must match the live page's cell text
  changeLogPublishedOn: '2026-08-18',
  mayBeginProcessingOn: '2026-09-17', // = changeLogPublishedOn + 30d, asserted
  trigger: { kind: 'env', name: 'ANTHROPIC_API_KEY' },
  readers: ['libs/plugins/marketplace/src/lib/server/ai-assist.ts', …],
}
```

The spec asserts four things, each able to go red alone:

1. `mayBeginProcessingOn === changeLogPublishedOn + 30d` — the 30-day promise becomes
   arithmetic instead of prose.
2. Every declared `trigger` — env var, vendor host, SDK import — is read only by the
   declared `readers`. This is the `ANTHROPIC_API_KEY` scan generalised, and it is the
   load-bearing assertion: **a new reader means a new data flow and fails the build.**
3. Every `decision: "disclosed"` vendor host in `tools/scripts/dependency-egress-register.json`
   maps to exactly one registry entry. That file already carries the mapping in prose —
   entries literally say *"an Annex III subprocessor already"* — so this makes an existing,
   unread annotation into a check.
4. Every `ADVERTISING_VENDORS` member has an entry, in whichever posture Zach picks (§3).

**Deliberately NOT in scope:** the spec cannot read the published page (network, ISR cache,
offline flake — the same reasoning as `published-legal-pages.ts`). `publishedRow` is a
transcription a human verifies once, exactly as `PUBLISHED_LEGAL_PATHS` is.

### Tier 1 — give the notice a reader *(≈2 days total; pick a and/or b)*

**(a) Email the org owners — ≈1.5 days.** Resend is already a subprocessor and already sends
usage summaries; the send path and the templates exist. What is new is a staff-triggered
"subprocessor change" send to org owners/billing contacts, **and a Firestore record of who
was notified and when.** That record is the whole point — it is what discharges the SCC
Clause 9(a) burden of proof. Without it Aglyn cannot show notice was given even if it was.

**(b) A machine-readable feed — ≈0.5 day.** `/legal/subprocessors.json` and an Atom feed,
generated from the Tier 0 registry rather than from the besigner page (the page is
click-built and has nothing to generate from). Serve from the console or docs app at a
stable URL and link it from the besigner page. Cheap, but on its own it is *another thing
nobody is subscribed to* — it only earns its keep alongside (a) or (c).

**(c) In-console banner — ≈0.5 day.** Reuse the shape of
`apps/console/components/legal-reacceptance-banner.component.tsx`, dismissible rather than
blocking: Subprocessors is not clickwrapped (`apps/console/constants/legal/` holds Terms and
Privacy only), so it must not gate anything.

### Tier 2 — public opt-in subscription list *(≈1 day; not before launch)*

For prospects and non-customer auditors. Nice for enterprise sales, not owed by the DPA.

### Recommended minimum before 2026-09-01

**Tier 0 + Tier 1(a).** ≈2.5 days. That is the smallest thing that makes §7.2 both true
and *provable* — Tier 0 guarantees the publish happens before the data flow starts, and
Tier 1(a) produces the evidence that it did. Tier 1(b) and (c) are launch-week polish.

Also fold in the AGL-2400 auto-acknowledgement for `support@` (a Google Groups auto-reply,
already drafted in `docs/EMAIL_SETUP.md`) — an objection route that issues no receipt is the
cheapest thing on this page to fix and the most embarrassing to be caught without.

---

## 6. Decision needed from Zach

| # | Decision | Cost of yes |
| --- | --- | --- |
| **B1** | ⚠ Hold `ANTHROPIC_API_KEY` out of production until **2026-09-17**? | 16 days without Assist at launch |
| **B2** | Build Tier 0 (registry + guard)? | ≈1 agent-day |
| **B3** | Build Tier 1(a) (owner email + notification record)? Or is publish-and-poll accepted as sufficient — recorded as a decision, not a gap? | ≈1.5 agent-days |
| **B0** | ⛔ **Linear**: publish the row now as a correction, **or** unset `LINEAR_API_KEY` in production and let the dialog 501 | one besigner edit, or one env change |
| **B4** | Publish Meta Pixel / Google Ads rows now (capability, not rollout), or hold? | one besigner edit |
| **B5** | Single objection route — see companion draft R2, recommend `privacy@` | one besigner edit ×2 |
| **B6** | Widen the GA cell to cover the server-side Measurement Protocol, and the Firestore cell to cover Realtime Database (§3b) | folds into any other besigner edit |
| **B7** | Add the self-host sentence below? | one besigner edit |

**Proposed self-host sentence** (B7) — worth having because it is true, it is favourable, and
enterprise buyers ask. `.env.selfhost.example` ships `ANTHROPIC_API_KEY`, `RESEND_API_KEY`,
`LINEAR_API_KEY`, `NEXT_PUBLIC_RECAPTCHA_PUBLIC_KEY` and `DOCS_GA_TRACKING_ID` all **unset**,
and every consumer fails closed with an explicit "not configured" rather than a silent
fallback:

> This list describes the Aglyn-operated Services. A self-hosted deployment engages only the
> subprocessors its operator configures; Aglyn Assist, email delivery, issue reporting,
> bot protection and analytics are each off unless the operator supplies their own credential.

**No published legal text needs to change for B2, B3 or B5's build half.** The wording that
shipped on 08-18 is good. What is missing is the machinery that makes it true, and the
question is only whether that machinery is worth 2.5 days before launch.

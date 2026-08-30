# Email overhaul — competitive position, audience model, sending domains, metering, abuse

Status: **specification only. No code changed.** Written 2026-08-29 against `main` at
`9315267be`, from the repository and from the operator's report of production
environment state. Nothing here has been decided by the account owner; §8 is the
list of things that need him.

> ⚠️ **House convention note.** Existing design specs live in `docs/design/` and
> are named `agl-####-slug.md`. This file is at `docs/specs/email-overhaul.md`
> because that path was specified. If it is adopted rather than discarded it
> should move to `docs/design/` and take an issue number, so
> `npm run check:linear-ids` and the rest of the doc guards see it where they
> expect it.

> ⛔ **No Linear issue was opened or read while writing this.** Where an `AGL-`
> id appears below it is being quoted from a code comment as provenance for a
> file, never asserted as a description of an issue. The
> [issue-creation freeze](#) is respected: this document proposes work, it does
> not file it.

---

## Verdict up front

**The email feature is not half built. It is roughly 80% built and about 40%
switched on, and the missing 20% is the part that keeps a shared sending domain
alive.** That distinction changes what to do first.

Three findings dominate everything else in this document:

1. **The feedback loop was UNREACHABLE, for a different reason than first
   reported.** `POST /api/email/events` is the *only* writer of bounce and
   complaint suppressions, so if it never runs, every hard bounce and spam
   complaint is discarded and those addresses stay fully mailable — on one
   shared domain, under `p=reject`.

   ⚠️ **Correction, 2026-08-29.** The original claim here — that
   `RESEND_WEBHOOK_SECRET` is unset — was WRONG, and it was wrong because of
   how the value was read, not what it is. The variable is Vercel type
   **`sensitive`**, which is write-only: `vercel env pull` returns it as an
   empty string whatever its real value. It was read as "present but empty"
   and reported as unset. `RESEND_API_KEY` beside it is type `encrypted`,
   which does pull back, which is exactly why one looked set and the other
   did not.

   The endpoint's own behaviour settles it: it answers **401 `Bad signature`**
   to an unsigned POST, and the handler returns `501` before signature
   verification when the secret is falsy. So the secret IS set.

   What was genuinely broken was the edge: the path returned **429 Vercel
   Security Checkpoint** to everything, because `/api/email/events` was absent
   from the firewall's machine-traffic bypass while `/api/billing/webhook`
   (Stripe) had been in it all along. Resend's deliveries were challenged and
   dropped before reaching the function. Fixed 2026-08-29; bot protection
   itself is unchanged and still `challenge`.

   ⚠️ Still unverified: whether a webhook exists **in Resend** pointing at that
   URL, and whether it is enabled. The production `RESEND_API_KEY` is a
   send-only restricted key and cannot list webhooks, so this can only be
   confirmed in the Resend dashboard. Given the edge rejected deliveries until
   now, suppressions may be empty in practice even though the wiring is right.

   **The general lesson, which is the reason this correction is written out in
   full: a read that cannot see a value reports the same thing as a value that
   is absent.** `vercel env ls` truncating (117 shown of 152) is the same trap;
   so is `git grep` honouring `.gitignore`. Distrust any "it is not set" that
   came from a reader rather than from the running system.
2. **Consent is captured and never read.** `marketingConsent` is written by six
   call sites and consulted by **zero senders**. `campaign-send.ts` filters an
   audience against the suppression lists and nothing else. The shipped
   consent/opt-in arc built the input and never wired the output.
3. **Custom sending domains do not exist in any form.** Not a stub, not a
   disabled button — zero product code mentions SPF, DKIM or DMARC. Everything
   the platform sends leaves as `noreply@aglyn.com`, and the only white-label
   affordance is the display name in front of that address.

The first is a configuration change measured in minutes. The second is a policy
decision the owner has to make. The third is the real build.

---

## 1. Current state, cited to files

### 1a. Built and working

| Capability | Where | Notes |
| --- | --- | --- |
| One send chokepoint | `libs/shared/util/email/src/lib/send-email.ts` | `sendEmail` never throws; every outcome is a `SendEmailResult`. All 39 senders pass through it. |
| **HTML part on every message** | `libs/shared/util/email/src/lib/text-email-html.ts`, wired at `send-email.ts` in the payload builder | ✅ **The click-tracking defect is FIXED and wired.** `sendEmail` synthesizes an HTML part from `text` when the caller supplies none, so the structural 0% click rate is closed at the one place all senders share. A caller with real HTML still wins. |
| Platform hourly send governor | `libs/shared/util/email/src/lib/send-rate.ts` (pure policy), `libs/tenant/data/admin/src/lib/server/email-send-rate.ts` (durable counter) | Default 2,000/hour, live value at `rateLimits/sendRateConfig`, editable from staff console. Fails **open**. Cannot refuse transactional mail — enforced twice, independently. |
| Two meters, one call | `libs/tenant/data/admin/src/lib/server/email-metering.ts` | `emailSends` = cost, counts everything, gates nothing. `campaignEmailSends` = the only meter `emailSendsPerMonth` may refuse. |
| Atomic monthly claim | `reserveCampaignEmailSends` / `reconcileCampaignSendReservation` | Claim taken late, reconciled in a `finally`, so a campaign that sent 300 of 500 spends 300. |
| Campaign composer, end to end | `libs/plugins/email/src/lib/components/campaigns-card.tsx` → `POST /api/campaigns/send` | Send, `test`, `preview` (a real dry run of the send path that stops before the first write), `schedule`, `cancel`. The Send button's `disabled` is form validation, not a feature gate. |
| Scheduled campaigns | `libs/plugins/marketing/src/lib/server/campaign-process-scheduled.ts` | Cloud Scheduler `*/15`, transaction flips `scheduled → sending` so overlapping runs cannot double-send, writes a health beat with a 45-minute grace. Scheduled on **exactly one runner** — verified, GitHub lists it under `workflow_dispatch` only. |
| Unsubscribe | `libs/plugins/email/src/lib/server.ts` | HMAC-signed link; safe `GET` confirmation page and mutating `POST`, so a mail-client prescanner cannot silently unsubscribe someone. RFC 8058 `List-Unsubscribe` + `List-Unsubscribe-Post` pair is sent on every campaign. |
| Resubscribe | same file | Reuses the unsubscribe signature; refuses to reverse a `bounce` or `complaint`. |
| Designed emails | `hosts/{hostId}/emailTemplates/{key}`, rendered by `libs/shared/util/email/src/lib/email-render.ts` | Built in besigner, versioned, per-recipient merge, media resolved against the site origin. |
| A/B on email | `campaign-send.ts` + `hosts/{hostId}/experiments` | Deterministic per-address variant assignment; sends are exposures. |
| Delivery log store | `libs/tenant/data/admin/src/lib/server/email-delivery-log.ts` | `emailDeliveries/{sha256(address)}/messages/{providerMessageId}`. Provider-agnostic by construction — only `normalizeResendDeliveryEvents` knows a vendor wire format. |
| Two suppression lists | `emailSuppressions/{sha256}` (platform) and `hosts/{hostId}/suppressions/{sha256}` (per site) | Platform list revokes with a `releasedAt` **field, not a delete** — the record is the evidence the suppression was honored. |
| Staff operations surface | `apps/console/app/(app)/admin/emails/page.tsx` and siblings | System-email catalog driven from code (so every email the product can send is always listed), test-send drawer, send-rate ramp card, delivery-history import, per-user delivery card, credential probe at `/api/admin/email-health`. |

### 1b. Built and inert — this is where the product actually is

| What | Why it is dark | Consequence |
| --- | --- | --- |
| **`POST /api/email/events`** (the Resend webhook) | ⚠️ **Corrected 2026-08-29.** `RESEND_WEBHOOK_SECRET` IS set — it is a `sensitive`-typed variable, which pulls back empty and was misread as unset. The real block was the edge: the path answered `429` (Vercel bot protection) because it was missing from the machine-traffic bypass. Fixed. | Whether any delivery has ever succeeded is still unknown: the send-only production key cannot list Resend webhooks, so the webhook's existence needs checking in the dashboard. |
| Bounce/complaint suppression | Written *only* by that webhook | Every hard bounce and every "report spam" the platform has received is lost. Those addresses are still mailed. |
| Campaign statistics | `delivered`/`opened`/`clicked` counters incremented only by that webhook | Every campaign's stats read zero. A merchant sees a feature that appears to do nothing. |
| **All outbound mail, until 2026-08-28** | `USAGE_EMAIL_FROM` empty in production (operator-reported; verifiable at `GET /api/admin/email-health`) | `sendEmail` returned `{sent:false, reason:'unconfigured'}` and warned to the log. Because mail is best-effort everywhere, **nothing errored and no user-facing surface said anything was wrong.** |
| History import + message reader | `RESEND_READ_API_KEY` unset → `501` | `/api/admin/emails/import-history` and `/api/admin/emails/message` are built and unusable. |
| **`marketingConsent`** | Written by six call sites; read by **no sender** | See §1d. The consent arc's output is not connected. |
| List membership UI | `lists-card.tsx` creates, deletes and counts lists | There is **no UI to add, view or remove an individual list member.** Members arrive only from newsletter capture or the `enrollList` automation step. A merchant cannot inspect the list they are about to mail. |
| `emailSends` cost meter | Populated on every send; the file states it is *"RECORDED, NOT PRICED"* | Enters no invoice, no COGS rate, no `ORG_COGS_UNIT_RATES_USD` entry. Email is the one significant cost the platform measures and does not bill. |

### 1c. Absent

- **Custom or per-org sending domains.** Zero product code matches `dkim|dmarc|spf`. The only reference to Resend's domains API is `RESEND_DOMAINS_ENDPOINT` in `email-health.ts`, used as a read-only credential probe *because it cannot create anything*. Domain setup is a human runbook: `docs/EMAIL_SETUP.md`.
- **Dynamic lists.** Nothing re-evaluates membership from a rule. The only rule-shaped audience is `orgs/{orgId}/contactSegments` — tags and sources, contacts only, evaluated once at send time.
- **Any credit or balance concept.** Searched repo-wide: no prepaid ledger, no top-up, no balance on an org. "Credit" in this codebase means Stripe proration, merchant gift cards, or attribution.
- **Manual suppression entry.** The suppressions card views and removes; it cannot add.
- **Cross-silo identity.** See §1e.
- **Per-tenant reputation controls.** No complaint-rate monitor, no per-org share of the send window, no circuit breaker.
- **`mailto:` unsubscribe fallback** — deliberately absent, documented in `libs/plugins/email/src/lib/server.ts` as requiring a monitored mailbox that does not exist. Do not add one without the mailbox.

### 1d. The consent gap, stated precisely

`marketingConsent: true` (plus `marketingConsentAtMs`) is written by:
`libs/tenant/data/admin/src/lib/server/upsert-contact.ts`,
`libs/tenant/data/admin/src/lib/server/host-visitor-records.ts`,
`libs/plugins/commerce/src/lib/server/newsletter.ts`,
`libs/plugins/commerce/src/lib/server/membership-register.ts`,
`libs/plugins/commerce/src/lib/server/billing-webhook.ts`,
`libs/plugins/bookings/src/lib/server.ts`, and
`apps/console/utils/api-v1-resources.ts` (the only writer that can set it to `false`).

It is read by **no send path**. Three further facts make this worse than a
missing `if`:

- **`hosts/{hostId}/siteMembers` has no consent field at all.** The signup
  checkbox is forwarded to the lead and the contact and is *not* persisted on
  the member document. So `audience: 'members'` has no consent signal to read
  even after the check is added.
- **List members have no consent field either.** `orgs/{orgId}/lists/{id}/members`
  carries `email`, `name`, `source`, `addedAt`.
- **The flag is only ever written when true**, so a `false` filter matches
  nobody rather than everybody — noted in `contact-filters.ts`, which supports
  `isNotEmpty` only.

⛔ **This must not be "fixed" by widening consent.** The standing platform rule
is that `implied` consent grants advertising outside the EEA/UK, and that policy
documents move *before* capability. That rule is about **tracking tags for an
anonymous website visitor** and it does not transfer to email. Email marketing to
a named address is a different legal instrument — opt-in under GDPR/PECR and
CASL, opt-out-with-conditions under CAN-SPAM. **Nothing in this spec relaxes any
consent posture, and §3 keeps the email rule strictly tighter than the tracking
rule.**

### 1e. Four person silos, no join

| Silo | Path | Scope | Dedupes? | Consent field |
| --- | --- | --- | --- | --- |
| Contacts | `orgs/{orgId}/contacts/{id}` | **org** | yes, by normalized email | `marketingConsent` |
| Leads | `hosts/{hostId}/leads/{id}` | host | **no** — appends every time | `marketingConsent` |
| Site members | `hosts/{hostId}/siteMembers/{id}` | host | yes, in a transaction | **none** |
| List members | `orgs/{orgId}/lists/{id}/members/{id}` | org | by document id — **two incompatible derivations**, see below | **none** |

One human who signs up as a site member produces three documents in three
collections. The only thing tying them together is the lowercase email string,
and that is only deduped *within* a collection. `normalizeContactEmail`
(`libs/aglyn/src/lib/app-utils/contacts.ts`) is the canonical normalizer.

There is also no TypeScript interface for `siteMembers` and no schema file for
lists — lists are created by an inline untyped `setDoc` in a React component
(`lists-card.tsx`).

### 1f. Defects found while establishing the above

These are not part of the proposal; they are things that are wrong now.

- **D1 — `limit()` with no `orderBy` on every audience read.** ✅ **CLOSED.**
  `campaign-send.ts` read `leads` and `siteMembers` at `limit(1000)`, and
  `contacts` and list members at `limit(5000)`, with no ordering. Firestore
  returns document-ID order, so a site with 3,000 leads mailed an **arbitrary
  and unstable subset**.

  All four now go through one `sweepAudience`, which pages with a cursor in
  `__name__` order under a single 5,000-document read budget — the largest
  window the file already spent, so no audience got more expensive and `leads`
  and `siteMembers` stopped being told their audience was 1,000.

  Two things the fix had to get right:

  - **The ordering is the document NAME, not a date**, because `orderBy(field)`
    drops every document lacking that field and no field is universal here.
    The provable case is list members: `enrollListMember` stamps `addedAt` only
    when it CREATES the row, and the newsletter handler that wrote the
    collection before it stored `{ email, name, source }` and no date at all —
    so `orderBy('addedAt')` would have dropped every newsletter subscriber from
    every list campaign.
  - **Nothing is short silently.** The result carries `audienceSize` beside
    `recipients`, plus `audienceTruncated` when even the audience is a floor.
    The composer reads `Recipients 500 of 3,200 in this audience`, the confirm
    dialog names the shortfall before the button, and the History row records
    `stats.audienceSize`. The 500-recipient cap itself is unchanged (D2) — what
    changed is that it now takes the first 500 of a stable order, so two sends
    of an unchanged audience reach the same people and which people is
    answerable.
- **D2 — `MAX_RECIPIENTS_PER_SEND = 500` versus what the plans sell.** Agency
  includes 1,000,000 campaign emails a month. At 500 per send that is 2,000
  separate manual sends. The documented behavior ("a larger audience is counted
  at the cap") is honest about the number and silent about *which* 500, which is
  D1 again.
- **D3 — the three ceilings are not dimensioned against each other.** Platform
  default is 2,000/hour *for all tenants combined*. Business includes
  50,000/month — 25 platform-hours. Agency includes 1,000,000 — about 500
  platform-hours, roughly three weeks of the entire platform sending nothing
  else. One org's campaign can also consume the whole hourly window, denying
  every other tenant's campaigns (transactional is protected by priority;
  campaigns are not).
- **D4 — list member ids use two derivations.** ✅ **CLOSED.** `newsletter.ts`
  used full `sha256(email)`; `run-event-actions.ts` used
  `hmac('aglyn-list-member', email).slice(0, 20)`, so the same address enrolled
  by both paths became two members of one list. Both now go through
  `enrollListMember` (`libs/tenant/data/admin/src/lib/server/list-members.ts`),
  which keys on `personKey` and is the only writer of the collection.

  Two corrections to what this entry originally claimed, both established by
  reading the send path rather than the write path:

  - **It was not a double send.** `performCampaignSend` builds its audience
    from each member's `email` FIELD and dedupes it through a `Set` of
    lowercased addresses before sending, so two documents have always produced
    one message. What the split actually cost was inflated counts, two of the
    5,000 documents the audience read is capped at, and enrollment metadata
    (`addedAt`, `source`) split across two rows.
  - **Casing was never the fork it looked like.** Neither derivation
    normalized, but both call sites lowercased at their own entry point, so
    every row already written was keyed from a lowercased address. The
    normalization now sits inside the key rather than in two callers that
    happen to agree, which is what makes a third caller safe.
- **D5 — two suppression key derivations.** `emailSuppressionKey` trims before
  hashing; `suppressionId` and `suppressionKey` (two identical local copies) do
  not. They agree today only because callers trim upstream.
- **D6 — campaigns do not consult the platform suppression list.** ✅
  **CLOSED.** `performCampaignSend` read `hosts/{hostId}/suppressions` only, so
  an address learned to be dead on another site, or on transactional mail
  carrying no `hostId` tag, was still mailed by this site's campaign — the
  cross-tenant leak the platform list was built to close.

  Both lists now go through `filterSendableForHost`
  (`libs/tenant/data/admin/src/lib/server/email-suppression.ts`), which
  composes the existing `filterSuppressedEmails` for the platform half rather
  than growing a second copy of its normalization and its fail-closed posture,
  then reads the per-site half in one keyed `getAll`. Both halves fail closed.

  The per-site read changed shape as well as gaining a sibling: it was a
  `limit(5000)` scan of the whole collection, so a site with more suppressions
  than the window failed OPEN on the remainder — the people most certain not to
  want the mail were the ones a truncated read dropped. It is now a lookup of
  exactly the addresses being mailed.
- **D7 — stale customer documentation.** `apps/docs/.../email-campaigns/overview.md`
  says the send cap is "counted **per site**". The code moved it to per-org.

---

## 2. Competitive analysis

### 2a. The table

| Product | Shape | **Steal this** | **Do not copy this** |
| --- | --- | --- | --- |
| **Mailchimp** | Standalone ESP, SMB, contact-priced | **The audience-versus-segment-versus-tag distinction, and the discipline of one audience per brand.** Their hard-won lesson is that people model lists as folders and then pay for the same person five times. Aglyn should present *one* org audience with saved views over it. | **Contact-count pricing.** It taught a decade of users to delete unengaged contacts — i.e. to destroy their own data to save money. It also collides directly with the platform rule that a limit must never refuse a person or their data. |
| **HubSpot** | CRM-first suite; email is an output of the CRM | **Email as a view over the CRM, not a parallel database.** A HubSpot list is a saved query over contacts; there is no second copy of the person. This is exactly the answer to "integrate with contacts, leads, forms and site users without duplicating them". | **The pricing cliff and the packaging maze.** Marketing Hub's tier jumps and its separate "marketing contacts" meter are the most complained-about part of the product. |
| **Salesforce Marketing Cloud** | Enterprise, Journey Builder, SQL-defined data extensions | **Journeys as first-class objects with entry criteria, wait states and exit criteria**, and the rigor that a person can be in exactly one journey instance. Aglyn already has `run-event-actions.ts`; this is the model it grows into. | **Everything about the surface area.** SFMC requires a trained specialist. A site-builder customer will not learn a query language to send a newsletter. |
| **Klaviyo** ⭐ *added* | Ecommerce-native ESP | **Purchase-behavior segmentation as the default primitive** — "spent over $X", "bought in the last 90 days", "hasn't ordered in 6 months". **Aglyn already stores the exact fields**: `ltvCents`, `ordersCount`, `lastPurchaseAtMs`, `firstPurchaseAtMs`, `refundedCents` on every contact. Klaviyo's whole business is built on data Aglyn is already collecting and not using. | Their flow-builder complexity at the low end, and per-contact-*and*-per-send double pricing. |
| **Squarespace / Wix / Shopify Email** ⭐ *added* | Site-builder-native email | **This is the true shape-competitor and the bar to clear.** Steal the ruthless reduction: pick a template that already matches the site's brand, pick an audience, send. Squarespace's consent posture is already this codebase's stated reference model. Shopify Email's *pricing* is the one to study — free monthly allowance, then a flat per-send rate, no contact tax. | Their audience models are thin (essentially one list), and none of them survives an agency managing 40 client brands. That is where Aglyn wins, not by matching feature counts. |
| **SendGrid / Twilio (subusers)** ⭐ *added* | Sending infrastructure | **The subuser model — the single most important thing in this table for Aglyn.** Each tenant is a subuser with its own sending identity, its own reputation, its own suppression list, and per-subuser IP assignment. It is the only mature answer to "how does one customer's behavior not damage everyone else's mail". | Their console, their docs, and the deliverability of their shared IP pools. The *architecture* is the lesson, not the service. |
| **Brevo** ⭐ *added* | SMB ESP, Europe | **Pricing by sends, not contacts.** Unlimited contacts, buy volume. Directly relevant to the owner's "credits" brief and the friendlier half of the model Aglyn should adopt. | Deliverability on the low tiers, and a shared-pool reputation with essentially no tenant vetting — the exact failure mode Aglyn must avoid. |
| **Customer.io** ⭐ *added* | Event-triggered messaging | **Events as the trigger vocabulary**, with the message as a consequence of a behavior rather than a scheduled blast. Aglyn already emits `memberSignUp`, `lead`, order and booking events. | Their developer-first setup. It assumes an engineer on staff. |

### 2b. Why the four additions

- **Klaviyo** — Aglyn has commerce in the same product. The RFM fields on `contacts` are already Klaviyo's data model; ignoring this competitor would mean writing a segmentation spec that omits the most valuable dimension already sitting in the database.
- **Squarespace / Wix / Shopify Email** — Mailchimp, HubSpot and Salesforce are what a customer *leaves* for Aglyn. These are what a customer *chooses instead of* Aglyn. They set the usability bar and, more importantly, the price expectation: site-builder-native email is expected to be cheap or bundled.
- **SendGrid subusers** — the only entrant in this table that has actually solved multi-tenant sending reputation. Every other product on the list is single-brand by construction and has never had to answer the question the owner's brief raises.
- **Brevo** — the reference implementation of send-based rather than contact-based pricing, which is the model that is compatible with this platform's rule against limits that refuse a person.

### 2c. What Aglyn's customer needs that none of them provides

The differentiator is not features; it is **shape**. An Aglyn customer is
frequently an agency or a multi-brand operator with an org containing many
`hosts`. Nothing in the table above handles that natively.

1. **One org, many sending identities.** An agency's 40 clients each need mail
   that comes *from the client's domain*, not from the agency's and not from
   Aglyn's. Mailchimp's answer is 40 accounts and 40 invoices.
2. **Audience scoping that is already enforced.** `contacts` are org-scoped with
   a `visibleTo` token, and `campaign-send.ts` already refuses to let one site's
   campaign reach another site's audience. That is a real, shipped agency
   feature the standalone ESPs charge extra for and implement as separate
   accounts.
3. **The audience is a by-product of the site.** Forms, bookings, orders,
   member signups and newsletter captures already write contacts. No import, no
   CSV, no Zapier. This is the single strongest position Aglyn has and it is
   currently undercut by the fact that consent is not enforced and lists cannot
   be inspected.
4. **Blast-radius isolation.** In a single-brand tool, a bad send hurts the
   sender. Here it hurts every other tenant. **That is the risk no competitor in
   the table has had to design for, and §6 is the answer.**

---

## 3. The proposed model — lists, audiences, segments

### 3a. Definitions, chosen so nothing is duplicated

| Term | What it is | Where it lives |
| --- | --- | --- |
| **Person** | Stays exactly where it is today, in one of the four silos. **Nothing in this spec creates a fifth copy of a person.** | `contacts`, `leads`, `siteMembers`, `formSubmissions` |
| **List** | A named, *materialized* membership set. Manual or dynamic. | `orgs/{orgId}/lists/{listId}` + `members` subcollection (extends what exists) |
| **Segment** | A saved *filter over contacts*. Already exists — keep it, do not build a second filter language. | `orgs/{orgId}/contactSegments/{id}` |
| **Audience** | The resolved recipient set for one send. **Derived, never stored.** | computed in `performCampaignSend` |

### 3b. Lists gain a kind

```
orgs/{orgId}/lists/{listId}
  name           string
  kind           'manual' | 'dynamic'
  rule           <present only when kind === 'dynamic'>
  memberCount    number          // maintained, so the composer reads one field
  lastEvaluated  timestamp       // dynamic only
  createdAt      timestamp
```

A **manual** list behaves as today: members are added explicitly and stay until
removed.

A **dynamic** list stores a rule and **materializes into the same `members`
subcollection**. It does not resolve at send time. Three reasons, and they are
the load-bearing design decision in this section:

1. **The send path must not run an unbounded scan.** D1's fix made the existing
   audiences paged and deterministic by document id under a fixed read budget,
   which is the floor rather than the destination: a dynamic list resolved at
   send time would put a rule evaluation inside that budget, and the budget is
   what stops the composer's preview from costing more the bigger the customer
   gets. Materialized membership keeps the resolution a paged read of a
   collection.
2. **The composer needs a cheap count.** A merchant deciding whether to send
   needs `memberCount`, not a 5,000-document scan per keystroke. This codebase
   has a standing rule against unrequested expensive reads.
3. **A send must be reproducible.** "Who did this campaign go to" is a support
   question and a compliance question. A materialized membership answers it; a
   rule re-evaluated later does not.

### 3c. The rule language — extend, do not invent

The rule reuses `contactMatchesSegment`'s vocabulary and adds a **source**
dimension so a dynamic list can draw from silos other than contacts:

```
rule:
  sources: ['contacts' | 'leads' | 'siteMembers']   // which silos to draw from
  segmentId?: string                                 // reuse an existing saved segment
  tags?:      string[]                               // contacts only
  captureSources?: ContactSource[]                   // form | member | order | booking | newsletter | api
  behavior?:                                         // contacts only — the Klaviyo dimension
    ordersCountAtLeast?:  number
    ltvCentsAtLeast?:     number
    lastPurchaseWithinDays?: number
    noPurchaseForDays?:   number
```

Every field above maps to a value **already written** on the contact document.
Nothing new is collected.

### 3d. The membership document holds a pointer, not a person

```
orgs/{orgId}/lists/{listId}/members/{memberKey}
  email          string     // denormalized: it is the send key, it must be here
  name           string     // denormalized for merge tags
  origin         { silo: 'contacts'|'leads'|'siteMembers'|'manual', path: string }
  via            'manual' | 'rule' | 'capture' | 'automation'
  consentAtMs    number | null    // copied at enrollment — see 3f
  addedAt        timestamp
```

`memberKey` is **one** derivation — `emailSuppressionKey`'s trimmed
`sha256(lower(email))` — which closes D4 and D5 in the same move.

**Shipped, as `personKey`.** It lives in
`libs/aglyn/src/lib/app-utils/person-key.ts` and is reached through
`@aglyn/aglyn/server`. It is the function `docs/specs/reusable-forms.md` §4
specifies for leads: one derivation, both meanings, as both specs required.

⚠️ It is NOT in `app-utils/contacts.ts` where both specs originally put it, and
that placement should not be restored. `contacts.ts` is re-exported by
`app-utils/server` → `app-utils/index` → the full `@aglyn/aglyn` barrel that
client code bundles, and the helper imports `node:crypto`. Three modules beside
it (`api-adapter`, `api-idempotency`, `plugin-bundle-checks`) are held out of
that barrel for exactly this reason — the third was measured at 39 KB gzipped
off every published customer page. `normalizeContactEmail` has no Node builtin
and stays in `contacts.ts`, which is what the helper composes.

**Existing members are reconciled by the write path, not by rewriting ids.**
`enrollListMember` resolves the canonical id and both legacy ids in one
`getAll` and writes to whichever row already exists, so a person enrolled under
a legacy id keeps their one document — including the consent-bearing fields on
it — and no re-subscribe creates a second. `tools/scripts/backfill-list-member-keys.mjs`
reports the people who hold BOTH rows and, under `--apply`, completes the
canonical row from the legacy one (earliest `addedAt` wins) and marks the
legacy row `supersededBy`. **It deletes nothing**, so a split person still
counts twice on the console's list card until a separate, deliberate pass
removes superseded rows — a wrong count being the recoverable failure and a
deleted enrollment not being one.

### 3e. Evaluation cadence for dynamic lists

Two triggers, both needed:

- **Scheduled sweep** on the existing `*/15` Cloud Scheduler fast-cron, chunked
  and cursor-resumable in the shape `import-history` already uses. This is the
  floor: a dynamic list is never more than ~15 minutes stale.
- **Event-driven invalidation** on contact/lead/member write — mark the affected
  lists dirty, do **not** re-evaluate inline. Coupling every contact write to N
  rule evaluations is exactly the expensive-read shape this codebase has a
  standing rule against.

⚠️ A campaign must materialize-then-send, and **record the membership snapshot
id it sent to**. A dynamic list that changes between "Schedule" and "Send" is
otherwise an unanswerable support question.

### 3f. Consent is a join condition, not a list property

**An address is mailable for marketing only when a consent record for it exists.**
It is checked at send time, in `performCampaignSend`, after suppression and
before the cap — and it applies to every audience kind, including `manual`.

Ordering matters: check consent *before* the meter claim, so a filtered-out
recipient is never charged against the org's allowance.

Two things must be built before that check can be turned on:

1. **Persist consent on `siteMembers`.** The checkbox value already arrives at
   `membership-register.ts` and is dropped on the floor for that document.
2. **Decide the retroactive question.** Every address captured before the
   checkbox shipped has no consent record. Turning the check on will shrink
   existing audiences — possibly to near zero. **This is an owner decision, not
   an implementation detail** (§8, Q1), and the policy documents move first.

⛔ **Explicitly not proposed:** inferring consent from a purchase, a booking, a
form submission, or an account signup. Those are the exact inferences the
shipped arc refused to make, and the checkboxes default unchecked on all three
surfaces on purpose.

### 3g. What this does not do

- It does not unify the four silos or introduce a `personId`. That is a much
  larger migration and email does not need it — email needs a deduplicated
  *address*, which `memberKey` gives.
- It does not deduplicate across silos at capture time. A campaign to one
  audience already dedupes; a person on a list and in a segment is a
  cross-audience concern only if multi-audience sends are added later.

---

## 4. Sending domains

### 4a. Two modes

**Provided (default).** The platform's own verified domain. **Change required:
bulk mail must move off the transactional domain.** Today campaigns and password
resets share `aglyn.com` under `p=reject`. One merchant's complaint rate can
therefore degrade every customer's authentication mail. Splitting bulk onto its
own domain (or a dedicated subdomain with its own DKIM selector and its own
reputation) is the cheapest large risk reduction available and it does not
require any customer to do anything.

**Custom.** A per-org (or per-site — §8 Q4) verified sending identity, so an
agency's client mail comes from the client's own domain.

### 4b. What the customer must complete

| Record | Host | Value | Why |
| --- | --- | --- | --- |
| **SPF** | `send.<their-domain>` | `v=spf1 include:amazonses.com ~all` (Resend's current include) | Authorizes the sending infrastructure for the envelope sender. Lives on the `send.` subdomain so it cannot disturb their existing root SPF or consume its 10-lookup budget. |
| **DKIM** | `resend._domainkey.<their-domain>` (or a per-org selector) | the public key we display | Cryptographic proof. **This is the one that must align** with the `From:` domain for DMARC to pass. |
| **MX** *(return path)* | `send.<their-domain>` | Resend's feedback host | Bounce and complaint routing for the custom identity. |
| **DMARC** | `_dmarc.<their-domain>` | **theirs, not ours** | We must **read** it and warn, never write it. |

### 4c. The DMARC read is not optional

We cannot set a customer's DMARC policy and must not ask them to weaken it. But
we must read it, because it changes what an unverified domain does:

- Their `_dmarc` is `p=reject` and our DKIM is unverified → **every message hard
  fails.** Not "goes to spam" — refused.
- `p=quarantine` → silent spam-foldering, which reads as low engagement.
- No record → messages deliver, and the customer has no protection.

Surface all three states in the domain card with the consequence named, not the
record dumped.

### 4d. Failure must be loud

⛔ **An unverified sending domain must refuse the send, with a named reason, at
the composer.** It must never silently fall back to the platform domain. Silent
fallback is wrong three ways: the customer believes their DNS is done; the mail
carries a `From:` the recipient does not recognize; and it moves a tenant's
reputation risk back onto the shared domain that the custom domain existed to
protect.

Concretely, matching how the product already refuses an unconfigured feature:

- Composer shows the verification state and blocks Send when the selected
  identity is not `verified`.
- `performCampaignSend` re-checks server-side and returns a `409` naming the
  domain and the failing record. The composer's dry-run `preview` action already
  exists and is the right place to surface it before anyone writes copy.
- The `from` address is resolved **server-side from the org document**, never
  from the request body.

### 4e. Reuse, do not reimplement

The product already runs a DNS-verification state machine for custom *site*
domains: `apps/console/app/api/domains/{attach,verify,status,detach}`, the
`custom-domain-card` component, and `finish-domain-attachments` re-checking on
the same `*/15` Cloud Scheduler job that drives campaigns. Sending-domain
verification is the same state machine over different records
(`pending → records-published → verified → failed`) and should extend that
machinery, consistent with the standing rule to extend shared libraries rather
than reimplement.

Note the seam constraint: self-hosting has `AGLYN_DOMAIN_PROVIDER` with a `none`
setting. A self-host operator with no provider must get a clear "not configured"
answer, in the shape `RESEND_API_KEY`-absent already produces, not a broken
screen.

### 4f. What this does not do

- No dedicated IPs. An IP needs consistent volume to warm and will damage
  deliverability below it. Revisit only at measured volume.
- No BIMI, no VMC. Requires DMARC enforcement plus a registered trademark; it is
  a later phase and belongs to the customer's brand, not ours.
- We do not sell or manage the customer's domain registration. `buy_domain`-style
  flows are out of scope.

---

## 5. Metering, credits, per-plan limits

### 5a. The house rule, and where email genuinely differs

The platform rule is that **capacity is enforced at the reduction, never at
use** — `apps/console/utils/over-limit.ts` is the one comparison, and
`apps/console/utils/server/capacity-in-use.ts` states the principle: re-checking
at use time "would mean ejecting a teammate or locking a dataset".

**Email sends do not fall under that rule, and the reason is precise:** the rule
protects **held capacity** — a person, a site, a dataset — a thing that already
exists and would be destroyed, ejected or hidden. A send is a **flow**, not a
holding. Refusing one strands nobody's data; the campaign stays a draft and the
audience is untouched. `email-metering.ts` already reasons exactly this way and
already gets the important half right: **only campaigns are refusable,
transactional mail never is**, enforced independently in two places.

⚑ **But the rule binds hard on two email-adjacent capacities, and both must be
respected:**

- **Contacts and list membership are held capacity.** Already correct: paid
  plans always create and meter the overage, free hard-bands at the included
  count (`upsert-contact.ts`). **A dynamic list must never drop a person for
  quota** — it may refuse to *grow*, but the identical rule applies as to
  contacts, and the answer is metered overage on paid plans.
- **Suppressions and delivery history must never be dropped for quota, on any
  plan, ever.** They are the evidence that a suppression was honored.

### 5b. Where email is inconsistent with the house pattern

`emailSendsPerMonth` is a **hard `403` on every plan**. Every other comparable
dimension meters: contacts, form submissions, data storage, API requests and
bandwidth all accept and bill the excess when `planMetersInfraOverage(org)` is
true, and hard-cap only on free (which has no subscription to bill).

The campaign cap is currently the product's only paid-plan hard wall.
**Recommendation: align it.** Paid plans meter campaign sends past the included
band; free stays at 0. This is the same shape `docs/design/agl-1370-unenforced-plan-caps.md`
settled for bandwidth — "neither answer is 'add a wall'".

### 5c. Credits

**There is no credit or balance concept anywhere in the codebase.** A prepaid
credit ledger would be greenfield.

**Recommendation: do not build one in the first phases.** The existing machinery
already answers the questions credits are usually bought to answer:

- "How much have I used?" → `campaignEmailSends`, already per-org and per-month,
  already displayed in the composer and on Billing.
- "Don't let me spend more than $X" → `orgs/{orgId}.usageBudget` and
  `/api/billing/usage-budget`, already built.
- "Bill me for the excess" → the `report-usage` → Stripe `meter_events` path,
  one event per org-month, with an ask-before-you-post guard so unbillable usage
  stays recoverable rather than forfeited.

The seam that *is* ready is `emailSends` — the cost meter that is populated on
every send and deliberately unpriced. `emailSendsOverage()` already exists in
`email-metering.ts`. Pricing it is one rate and one line in the estimator.

⚠️ **But pricing it changes an invoice**, and the Sept-1 launch price set is
locked; a charged price may not change. Any rate is therefore either post-lock
or a new SKU, and it is a **six-place move** — `PLAN_PRICING`/`PLAN_ENTITLEMENTS`,
`setup-stripe.mjs` re-run, Figma, `aglyn.com/pricing`, the generated tables, and
the Drive-resident Pricing Decision Log — guarded by `check:pricing-drift`,
`check:pricing-tables`, `check:feature-matrix` and `check:decision-log`. See §8 Q3.

### 5d. Dimensioning the three ceilings

They must be made consistent (D3). Proposed:

- **Per-send cap** — replace the flat 500 with batching, so a send is a job that
  drains across windows rather than a truncation. The interim half is **done**
  with D1: the composer says `Recipients 500 of 3,200 in this audience` rather
  than reporting 500 as the audience, the confirm dialog names the shortfall,
  and the History row records it. What is left is the batching itself — a
  merchant with 3,200 people still has no way to reach the other 2,700 except
  by removing the first 500 from the audience, because the cap takes the first
  N of a fixed order and a second send addresses the same people.
- **Per-org share of the hourly window** — a new control. No single org may
  consume more than a configured fraction (start at 25%) of the platform hour
  for campaigns. Transactional mail is exempt, as everywhere else. This closes
  the tenant-versus-tenant denial of service.
- **Platform ceiling** — keep the staff ramp exactly as built. It is the right
  design: a value, not a deploy, with an author and a note.

⚠️ Any new quota crossing the wire must send **a finite number plus an explicit
boolean flag**, never `UNLIMITED` — `JSON.stringify(Infinity)` is `null`,
`Number(null)` is `0`, and `Number.isFinite(0)` is `true`, so the sentinel
sails through every guard and renders a cap of zero on the most expensive plan.

---

## 6. Security and abuse

### 6a. Anti-spoofing

- SPF, DKIM, DMARC per §4, with **DKIM alignment to the `From:` domain** as the
  property that actually matters.
- **Close the `from` override.** `SendEmailOptions.from` bypasses the configured
  sender entirely. The docblock says "almost nothing should set this" — that is
  a comment, not a guard. A campaign's `From` must be resolved server-side from
  the org's verified identities, and no tenant-reachable path may set `from`
  from request input.
- `applyFromName` is correct as built: it replaces the display name only and
  cannot move the address off the verified domain. Keep that invariant when
  custom domains land — the address must come from a verified identity record,
  never from user input.

### 6b. Anti-spam

- **Turn the feedback loop on.** This is the whole ballgame; see §7 Phase 0.
- ~~Consult both suppression lists on every campaign~~ **done** (D6).
- **Consent join at send time** (§3f), once policy has moved.
- **No import path exists yet.** When one is added, it must require a declared
  source per address and must not accept a bare CSV as consent. A bulk import of
  a purchased list is the fastest way to destroy a shared sending domain.
- Reuse the existing popup honeypot for any new capture surface.

### 6c. Per-tenant reputation controls — the multi-tenant answer

This is the section with no competitor precedent outside SendGrid's subuser
model, and nothing here exists today.

1. **Per-org complaint and bounce rate**, computed from the delivery log on a
   rolling window. Mailbox providers' published bulk-sender guidance puts the
   complaint threshold at well under 0.3%, and treats sustained rates above that
   as grounds for filtering.
2. **A circuit breaker that pauses the org, never the platform.** Above
   threshold, that org's *campaigns* pause and staff are notified.
   ⚑ **Transactional mail is exempt, at every threshold** — the same rule the
   quota and the governor already enforce twice each. A merchant with a bad list
   still gets their password resets.
3. **Staff review queue** for a paused org, using the existing admin-audit
   pattern so a pause and an unpause both have an author.
4. **Reputation isolation, in increasing cost:**
   - separate the bulk domain from the transactional domain (cheap, do first);
   - custom per-org domains, which move reputation to the tenant that earns it
     and is the correct long-run incentive;
   - dedicated IPs, only at volume that can warm one.
5. **New-tenant ramp.** A brand-new org on the shared domain should have a lower
   campaign ceiling for its first weeks. Public signups open Sept 1; the first
   unvetted account to import a bought list is the event to design against.

### 6d. Rate limits

Keep the platform governor as built — its fail-open posture and its inability to
refuse transactional mail are both correct and both enforced twice. Add only the
per-org share of the window (§5d).

### 6e. Data protection

The delivery log is per-recipient PII. Reads stay staff-only through the audited
admin route, client reads stay closed in Firestore rules, and `eraseUser`
continues to delete it by address. All of that is already built correctly; the
requirement is not to regress it.

---

## 7. Phased plan

### Phase 0 — Turn on what is already built *(configuration only, ~1 day)*

Confirm a webhook exists in Resend pointing at `/api/email/events` and is
enabled — `RESEND_WEBHOOK_SECRET` is already set, and the firewall bypass that
was blocking delivery is in place as of 2026-08-29. Set
`RESEND_READ_API_KEY`. Confirm `USAGE_EMAIL_FROM` via `GET /api/admin/email-health`.
Confirm open tracking is enabled on the Resend domain.

**Does not:** change any code, any limit, any price, or any customer-visible
behavior beyond statistics appearing and bounces beginning to suppress.

**Why first:** it converts the largest live risk (bounces and complaints
discarded forever) into a solved problem for the price of an environment
variable, and everything in Phase 2 needs the data it starts collecting.

### Phase 1 — Make a campaign reach the people it says it will *(correctness)*

~~D1~~ **done** — ordered and paged audience resolution, on the document name
because no date is universal; ~~D6~~ **done** — campaigns consult both
suppression lists through one shared helper; ~~D4~~ **done** — one list-member
key derivation, reconciled by the write path rather than by a collapsing
backfill (§3d says why the collapse is not automatic); ~~a composer that
distinguishes audience size from send size~~ **done** — it landed with D1,
because a window that stops truncating silently is a window that has to say
what it left out. Still open: D5 one suppression key derivation; D7
documentation corrected to per-org.

**Does not:** add consent enforcement, domains, dynamic lists, or credits. Does
not change any limit.

### Phase 2 — Protect the shared reputation

Split the bulk sending domain from the transactional domain. Add the per-org
share of the hourly window. Add per-org complaint/bounce rate from the
now-flowing delivery log, and the org-scoped circuit breaker with staff review.
New-tenant campaign ramp.

**Does not:** touch transactional mail, at any threshold. Does not introduce
custom domains yet.

### Phase 3 — Consent enforcement *(policy first)*

Policy documents move first. Then persist consent on `siteMembers`. Then the
send-time consent join, shipped **behind a per-org switch with a preview** that
shows each audience's before and after size, so no merchant discovers the change
by sending to nobody.

**Does not:** change the visitor tracking/advertising consent posture in any
way. Does not infer consent from any transaction.

### Phase 4 — Custom sending domains

Sending-identity records on the org, verification reusing the site-domain state
machine and its `*/15` re-check, the DMARC read-and-warn, the composer identity
picker, and the loud refusal for an unverified identity.

**Does not:** dedicated IPs, BIMI, domain registration, or per-message From
overrides.

### Phase 5 — Dynamic lists

`kind` and `rule` on the list document, the materializer, the scheduled sweep
and dirty-marking invalidation, the membership snapshot recorded per send, and
the composer's list picker showing rule and freshness.

**Does not:** introduce a second filter language — it extends `contactSegments`.
Does not resolve rules at send time.

### Phase 6 — Metering alignment and, only then, credits

Align paid plans to metered overage on campaign sends. Price `emailSends` if and
when the pricing lock permits, as a six-place move with a Decision Log entry.
Revisit prepaid credits only if the metered model proves insufficient.

**Does not:** change any charged price while the Sept-1 lock stands.

---

## 8. Open questions for the owner

**Q1 — Does consent enforcement apply retroactively?**
Enforcing it on addresses captured before the checkbox shipped will shrink
existing audiences, possibly to near zero, and customers will experience that as
data loss. Not enforcing it means continuing to mail people who never opted in,
from a shared domain, which is the exposure the consent arc was built to close.
A middle path — enforce for new sends, grandfather addresses with a recorded
pre-existing relationship — needs a definition of "relationship" that the
policy documents can stand behind.

**Q2 — Do bulk and transactional split onto separate domains before Sept 1?**
Splitting costs a new domain and a warm-up period measured in weeks, and it must
happen before volume, not after. Not splitting means one merchant's complaint
rate can hard-fail every customer's password resets under `p=reject`.

**Q3 — Is `emailSends` priced, and when?**
Pricing it makes email pay for itself and matches the metered-overage pattern
used everywhere else. But the Sept-1 price set is locked and a charged price may
not change, so this is either a post-lock change or a new SKU — and either way a
six-place move with a Decision Log entry.

**Q4 — Are custom sending domains per-org or per-site?**
Per-org is fewer DNS chores and matches how lists and contacts are already
scoped. Per-site is what an agency's client actually wants — their own brand in
the From line — and matches how `hosts` already own their public domain. Per-site
is more work and more support surface; per-org will not satisfy the agency case.

**Q5 — What happens to a legitimate 50,000-recipient campaign?**
Batching it across hourly windows makes a large send take most of a day, which
merchants will report as a bug. Not batching means one tenant monopolizes the
platform window. There is no third answer that keeps both the plan ceilings and
the platform ceiling honest.

**Q6 — Raise `MAX_RECIPIENTS_PER_SEND`, or batch?**
Raising it makes one send a long-running invocation that can time out mid-batch,
leaving a partial send that is hard to resume safely. Batching is more machinery
but is the only shape consistent with the volumes the plans already sell.

**Q7 — Refuse to send on a hostile DMARC, or send and let it fail?**
If a customer's `_dmarc` is `p=reject` and our DKIM is unverified, every message
hard-fails. Refusing up front is a support ticket. Sending anyway is a guaranteed
failure that will read as our bug.

**Q8 — Should the free plan get any campaign sends?**
Today it is 0, so the feature is invisible until someone pays. A small allowance
demonstrates value, but it also hands unvetted Sept-1 signups a sending surface
on the shared domain.

**Q9 — Dynamic list evaluation: scheduled, on-write, or both?**
On-write is instant but couples every contact write to N rule evaluations, which
is the expensive-read shape this codebase has a standing rule against. Scheduled
is cheap and predictable but a person who just signed up misses today's send.
This spec proposes both (scheduled sweep plus dirty-marking) and the trade-off is
implementation cost.

---

## Appendix — what was not verified

- **Production environment values.** No browser was used (other agents share one
  Chrome). `USAGE_EMAIL_FROM` being empty until 2026-08-28 and
  `RESEND_WEBHOOK_SECRET` still being empty are the operator's report, not a
  measurement taken here. Both are verifiable at `GET /api/admin/email-health`
  and by a single `POST` to `/api/email/events` returning `501`.
- **Deliverability figures.** No message was sent and no Resend dashboard was
  read. The claim that campaign statistics read zero is inferred from the webhook
  being the only writer of those counters, which is verified in code.
- **No Linear issue was opened.** No claim here describes the contents of any
  issue.

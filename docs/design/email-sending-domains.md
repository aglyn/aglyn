# Custom email sending domains

Status: **partly built.** This document states precisely which parts are code
and which parts are specification, because the standing complaint about this
feature area is that it shipped half built and said it was finished.

> **House convention note.** Sibling files here are named `agl-####-slug.md`.
> This one carries no issue number: the issue-creation freeze stands, the
> highest existing identifier is `AGL-2501`, and citing an id that was never
> assigned is the defect `tools/scripts/linear-ids.mjs` exists to catch. If an
> issue is opened for this work the file should be renamed to match it.

---

## The problem this solves

Every tenant's mail leaves on one platform identity — `USAGE_EMAIL_FROM`, on
one domain, under `p=reject`. A campaign from one merchant and a password reset
from another share a DKIM `d=` and therefore share a reputation. One merchant's
complaint rate is charged against every merchant's authentication mail.

A custom sending domain moves a tenant's DKIM alignment onto a domain that
tenant owns, so their sending reputation accrues to them.

### What it does NOT fix

**Domain reputation separates; IP reputation does not.** The provider's shared
IP pool is still shared. A tenant on a verified custom domain no longer
contributes to `aglyn.com`'s domain reputation, but they still send from the
same addresses as every other tenant, and a mailbox provider that throttles
those addresses throttles everyone.

**And it only helps the tenants who use it.** Every org without a verified
custom domain — which is all of them today — stays on the shared identity, so
the multi-tenant risk is reduced for adopters and unchanged for everyone else.
The cheap, universal mitigation is still the one the overhaul spec names as
Q2: split bulk mail off the transactional domain, which needs no customer to do
anything. **This feature is not a substitute for that, and does not implement
it.**

---

## Per-org record, per-host selection

The overhaul spec's Q4 asks whether custom sending domains are per-org or
per-site. The answer taken here is **both, split by what each half is for**:

| Thing | Scope | Why |
| --- | --- | --- |
| The verified domain record | **Per-org**, `orgs/{orgId}/sendingDomains/{domain}` | Proving control of a zone is a property of the org that proved it. An agency running four sites on `client.com` publishes the DKIM record once. This is where `ssoDomains` already lives, for the same reason. |
| Which identity a site sends on | **Per-host**, `hosts/{hostId}.sendingDomain` + `.sendingLocalPart` | The `From:` a recipient sees belongs to the site, not to the agency that operates it. This is how `hosts` already own their public domain. |

Per-org alone would not satisfy the agency case, which is the half of Q4 that
matters commercially. Per-site alone would make an agency repeat the same DNS
chore for every site on one client's domain. Splitting them costs one extra
field and answers both.

Two orgs verifying the same name is not a takeover vector, because each must
publish a DKIM record in that zone under a **per-org selector**
(`aglyn-{orgId}._domainkey.<domain>`). A selector shared between orgs would let
whichever verified second inherit the first's proof; per-org selectors make
each verification independent.

---

## The records a customer publishes

Issued by one function, `sendingDnsRecords`, which is also what the verifier
compares against — so what a surface prints and what we accept cannot drift.
`apps/console/utils/tenant-dns.ts` carries the same invariant for site domains
and documents the three separate issues that came from breaking it.

| Record | Host | Value | Required |
| --- | --- | --- | --- |
| **SPF** | `send.<domain>` | `v=spf1 include:amazonses.com ~all` | yes |
| **DKIM** | `aglyn-{orgId}._domainkey.<domain>` | `p=<issued public key>` | yes |
| **Return path** | `send.<domain>` | `MX 10 feedback-smtp.us-east-1.amazonses.com` | yes |
| **DMARC** | `_dmarc.<domain>` | **read, never written** — `v=DMARC1; p=none; rua=…` offered as a suggestion | no |

SPF and the return path sit on the `send.` subdomain deliberately: the
customer's existing root SPF keeps authenticating their Workspace or Microsoft
mail, and this record spends none of the root's ten-lookup budget, which fails
closed and is easy to exhaust.

The SPF include and return-path host are configurable
(`AGLYN_EMAIL_SPF_INCLUDE`, `AGLYN_EMAIL_RETURN_PATH_HOST`) so a self-host
operator fronting a different provider is not stuck with ours.

### DMARC is read, never written

A customer's DMARC policy is theirs. We read it because it changes what an
unverified domain does to their mail, and the consequence is what the surface
states — not the record:

- `p=reject` + our DKIM missing → **every message is refused.** Not spam-filed.
- `p=quarantine` → silently spam-foldered, which reads as low engagement.
- absent → delivers, and the customer has no protection at all.

An unreachable `_dmarc` lookup returns null rather than `absent`. Reporting
`absent` would tell a customer under `p=reject` that they have no protection,
which is both wrong and the opposite of the truth.

---

## An unverified domain fails visibly

This is the requirement everything else is arranged around, and it is enforced
in **three** places, each of which is reachable when the others are skipped.

1. **`resolveSendingIdentity`** (pure) has no arm that reaches a platform
   address from a selected-but-unverified domain. There is no configuration,
   no flag and no caller that produces a silent fallback.
2. **`performCampaignSend`** re-checks server-side and throws a **`409`**
   naming the domain and the records still missing — above the dry-run return,
   so `preview` refuses too and a merchant finds out before writing copy.
3. **`sendEmail`** refuses again with `reason: 'unverified-domain'`, which is
   the backstop for a caller that skipped the route.

`409`, not `501`: an unconfigured deployment is the operator's problem and an
unfinished DNS record is the customer's, and collapsing the two hands each the
other's message.

The address is resolved from the **host document**, never from the request
body. `campaignSendHandler` builds its options from request input, so a field
read off `options` is one an authenticated site editor chooses — and would let
them send as any domain they can name.

### Why this is stated so emphatically

`USAGE_EMAIL_FROM` was empty in production for weeks. Every send returned
`{sent: false, reason: 'unconfigured'}`, nothing threw, and no user-facing
surface said anything, because outbound mail is best-effort at all 39 call
sites. A refusal that is only a log line is that same defect with a new reason
string.

---

## What is BUILT

| Piece | Where |
| --- | --- |
| The record and its lifecycle (`requested → records-issued → verified / failed`) | `libs/shared/util/email/src/lib/sending-domain.ts` |
| The DNS records, issued by one function shared with the verifier | same |
| DMARC read and the report-only suggestion | same |
| The identity decision and the refusal | same (`resolveSendingIdentity`) |
| The record-vs-live comparison, three-outcome | same (`assessSendingRecords`) |
| Firestore store, DNS verification, per-org selector | `libs/tenant/data/admin/src/lib/server/sending-domains.ts` |
| Pinned-resolver TXT/MX lookup, extracted from two inline copies | `libs/tenant/data/admin/src/lib/server/dns-probe.ts` |
| The send path's refusal and custom-address send | `libs/shared/util/email/src/lib/send-email.ts` |
| The campaign `409`, and `preview` reporting which identity is in use | `libs/plugins/marketing/src/lib/server/campaign-send.ts` |
| Request / list / verify / release, with the records in the response | `apps/console/app/api/email/sending-domains/route.ts` |
| Client-deny rules for the subcollection, with a rules test | `cloud/firebase-firestore.rules` |

## What is SPECIFIED, not built

Each of these is a deliberate boundary, not an oversight.

### 1. Issuing the DKIM key needs a credential that does not exist

`recordIssuedSendingDomain` is the seam that moves a domain from `requested` to
`records-issued`, and **nothing calls the provider to fill it.** Creating a
domain at Resend is `POST /domains`, and the production `RESEND_API_KEY` is
**send-only restricted** — that restriction is exactly why `email-health.ts`
uses the domains endpoint as a read-only credential probe, "because it cannot
create anything".

**A separate full-access credential is required** — call it
`RESEND_DOMAINS_API_KEY` — held only by the console, never by the tenant
runtime. It is a different key from `RESEND_READ_API_KEY`, which is scoped for
message history and also unset.

Until such a key exists, a domain stops at `requested`, has no records to
publish, and therefore refuses sends. That is the correct behavior for a domain
with no signing key, and the route says `pendingProvider: true` rather than
rendering an empty records table that reads as our bug.

**No Resend domain was created and no credential was provisioned by this work.**

### 2. Nothing re-checks a verified domain

Verification happens when someone asks for it. A customer who removes their
DKIM record months later keeps sending until somebody verifies again.

The re-check belongs on the existing `*/15` `consoleFastCrons` job, beside
`finish-domain-attachments`, and the machinery it needs is already built:
`verifySendingDomain` is idempotent, never throws, and already holds the
`inconclusive` arm that stops a resolver outage from un-verifying every
customer at once. What remains is the sweep route, its `CRON_SECRET` and
`recordCronBeat` preamble, a bounded query, and registration in
`CONSOLE_FAST_CRON_ROUTES` plus `health-report.ts`.

It should also carry the drift discipline `sso-drift-logic.ts` already
implements — N consecutive conclusive failures **and** a wall-clock floor
before acting — rather than un-verifying on a single bad sweep.

### 3. There is no console card

The route returns the records, the DMARC read and the verification state; no UI
renders them. The model is `custom-domain-card.component.tsx`: `CardDisplay`,
monospace `Typography` record lines on `action.hover`, a state `Chip`, and a
verify button. It also needs the per-host selector that writes
`hosts/{hostId}.sendingDomain`, without which the per-host half of the model
above has no way to be set.

**The composer does not yet show the identity in the UI.** `preview` returns
`identity` and `identitySource` and nothing renders them.

### 4. The `from` override is still open

`SendEmailOptions.from` remains reachable. A resolved identity now outranks it,
so a campaign cannot be moved off a verified domain — but a caller that passes
`from` and no identity still bypasses the configured sender. Closing it means
auditing all 39 senders and is its own change.

### 5. Not attempted

Dedicated IPs (need consistent volume to warm, and damage deliverability
below it), BIMI/VMC (needs DMARC enforcement plus a registered trademark),
domain registration, and per-message `From` overrides.

---

## Verification of the tests

Every assertion added was broken deliberately and watched fail. Notably: making
an unverified domain fall back to the platform identity turns **6** assertions
red while leaving the other 20 in that file green — which is the argument for
naming the property in a test, since nothing else detects it.

Two gaps were found this way and closed: an explicit `from` outranking a
verified identity on the allowing path, and the campaign reading its selected
domain from request options rather than the host document.

One real defect was found by a test before any mutation: a domain with no
issued DKIM key satisfied SPF and the return path alone and reached `verified`
— a sending identity that could not sign anything.

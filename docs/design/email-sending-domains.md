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

Two orgs verifying the same name was to be kept independent by a **per-org
selector** (`aglyn-{orgId}._domainkey.<domain>`): a selector shared between
orgs lets whichever verified second inherit the first's proof.

⚠️ **The provider does not honor that.** Resend signs on a selector of its own
choosing and holds one domain object per name for the whole account, so once a
key is issued the stored selector is the provider's and two orgs on one name
share it. `sendingDkimSelector` now proposes rather than decides. Each org must
still publish the record in that zone, so a domain nobody controls cannot be
taken over — but an org that claims a name a second time inherits a
verification the first org's DNS satisfies. See "Issuing the key" below.

---

## The records a customer publishes

Issued by one function, `sendingDnsRecords`, which is also what the verifier
compares against — so what a surface prints and what we accept cannot drift.
`apps/console/utils/tenant-dns.ts` carries the same invariant for site domains
and documents the three separate issues that came from breaking it.

| Record | Host | Value | Required |
| --- | --- | --- | --- |
| **SPF** | `send.<domain>` | `v=spf1 include:amazonses.com ~all` | yes |
| **DKIM** | `<issued selector>._domainkey.<domain>` — `aglyn-{orgId}` until a provider names its own | `p=<issued public key>` | yes |
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
| Firestore store, DNS verification, the proposed per-org selector | `libs/tenant/data/admin/src/lib/server/sending-domains.ts` |
| Recording an issued key, and recording a provider refusal without a status | same (`recordIssuedSendingDomain`, `recordSendingDomainIssueFailure`) |
| Pinned-resolver TXT/MX lookup, extracted from two inline copies | `libs/tenant/data/admin/src/lib/server/dns-probe.ts` |
| The send path's refusal and custom-address send | `libs/shared/util/email/src/lib/send-email.ts` |
| The campaign `409`, and `preview` reporting which identity is in use | `libs/plugins/marketing/src/lib/server/campaign-send.ts` |
| Request / list / verify / release, with the records in the response | `apps/console/app/api/email/sending-domains/route.ts` |
| Client-deny rules for the subcollection, with a rules test | `cloud/firebase-firestore.rules` |
| The provider seam that issues the key, plus a `resend` driver and a `none` | `apps/console/utils/server/sending-domain-provider.ts` |
| The join from that driver to the record | `apps/console/utils/server/issue-sending-domain.ts` |
| The credential's isolation from the tenant runtime, asserted by a tree sweep | `apps/console/specs/sending-domain-credential-isolation.spec.ts` |

---

## Issuing the key: built, and inert until a credential exists

The provider call is now written, behind the same kind of seam as
`AGLYN_DOMAIN_PROVIDER`: `AGLYN_SENDING_DOMAIN_PROVIDER` selects `resend` or
`none`, and with the variable unset the driver is chosen by whether the
credential is present. **One real driver and a `none` is the whole set.** A
self-host operator fronting a different mail provider writes a third; imagining
it now would be design against a provider nobody has.

`recordIssuedSendingDomain` is still the seam that moves a domain from
`requested` to `records-issued`, and it still takes what it was given rather
than calling anything — an operator can complete the step by hand on a
deployment that has no key at all.

### The credential is the console's, and structurally so

Creating a domain needs a key that can create things. `RESEND_API_KEY` cannot:
it is **send-only restricted**, which is exactly why `email-health.ts` can use
the domains endpoint as a read-only credential probe, "because it cannot create
anything". So the driver reads a separate **`RESEND_DOMAINS_API_KEY`**, and a
key that can create a domain can also list every domain in the account and mint
further keys.

That key must never be reachable from the tenant runtime, which serves
published sites to the public internet. The isolation is a property of where
the file lives rather than a convention:

- the driver is in `apps/console/utils/server/`, and `tsconfig.base.json` maps
  `@aglyn/*` to `libs/*` and nothing to an app, so the tenant app has no
  specifier for it; nx's `enforce-module-boundaries` forbids app→app besides;
- the seam it feeds, `recordIssuedSendingDomain`, is in
  `@aglyn/tenant-data-admin` — which the tenant runtime **does** import — and
  takes the key as an argument, reading no environment at all;
- a spec sweeps `apps`, `libs`, `tools` and `cloud` and fails if the variable
  is read anywhere but that one file, or named anywhere outside the console.

### What the driver does and does not take from the provider

**Only the DKIM record.** SPF and the return path come from
`sendingSpfInclude()` and `sendingReturnPathHost()`, which is what
`sendingDnsRecords` prints and what the verifier compares against; taking them
from a response would put a second source of truth behind the one function that
exists so there is only one.

The DKIM **selector** comes from the provider too, not just the key. Resend
signs on a selector of its own choosing, so `sendingDkimSelector` now
*proposes* the per-org name and the issued one is what is stored — printing our
proposal against the provider's key would give the customer a record at a name
nothing ever signs from, which is a verification that can never pass.

⚠️ **That re-opens the collision the per-org selector was written to close.**
Resend holds one domain object per name for the whole account, so two orgs
claiming the same name share a key and a selector. Each still has to publish
that record in the zone to verify, so it is not a takeover of a domain nobody
controls; it does mean the second org inherits a verification the first org's
DNS satisfies. Closing it needs a provider that accepts a selector, or an
org-level claim on the name. Neither is built.

### A failure leaves the record alone

There is no path from a provider error to `records-issued`. A `4xx`/`5xx`
writes `lastIssueError` — a short code from a fixed vocabulary, never the
provider's prose and never a credential — and the domain stays `requested`,
where it has nothing to publish and refuses sends. `recordIssuedSendingDomain`
refuses outright to reach `records-issued` unless
`sendingDomainRequiredRecords` yields a DKIM record with a value, so **a domain
that reports `records-issued` has records.**

Idempotency is resolved against our own record before the network: a domain
that already has a key never reaches the provider, so a second click creates no
second domain and cannot overwrite a key the customer may already have
published. A `422` duplicate is adopted rather than failed, but only after the
account listing and the fetched object both confirm the name.

**No Resend domain was created and no credential was provisioned by this work.**
See "What a human must still do" below.

---

## What is SPECIFIED, not built

Each of these is a deliberate boundary, not an oversight.

### 1. ~~Nothing re-checks a verified domain~~ — BUILT

`sending-domain-recheck.ts` re-reads the DNS for verified domains whose last
check has gone stale, and un-verifies the ones whose records are conclusively
gone.

It carries the drift discipline this section asked for. An `inconclusive`
probe maps to `unreachable`, which HOLDS — it neither counts the failure nor
clears a run already gathered, so an outage cannot un-verify every customer at
once and cannot launder away evidence either. A conclusive miss is counted
rather than acted on: `SENDING_DOMAIN_FAILURES_BEFORE_REVOKE` in a row **and**
`SENDING_DOMAIN_DRIFT_MIN_AGE_MS` since the first, so a beat firing too often
cannot compress the wait.

The probe is `probeSendingRecords`, extracted from `verifySendingDomain` and
shared with it, so the sweep and the console's Verify button ask the same
question of the same resolvers and cannot form two opinions about whether the
records are published. What differs is only how much evidence each acts on:
the button's caller is watching and can retry, the sweep's caller is nobody.

**Not a `consoleFastCrons` route, as this section proposed.** It rides the
existing platform job beat through `registerPluginJob`, under the `core`
namespace `publish-schedule-job.ts` established, which is a registration
rather than a route plus a scheduler entry plus an inventory row plus a
monitor. `core` also passes the release filter untouched — a workspace with
the email plugin switched off still has hosts pointed at these records, and a
domain's trust must not outlive its DNS because of a plugin flag.

The staleness bound is in the query, so a beat with nothing due bills one empty
read. Ordering by `lastCheckedAtMs` is what makes it resumable without a
cursor: each pass stamps the field and moves the domain to the back of the
queue. That ordering also decides what is VISIBLE — Firestore drops a document
missing the field — so `verifySendingDomain` stamping it on the verified
transition is an invariant the spec pins, because a second writer of that
status would otherwise make its domains silently untouchable.

**Needs the `(status, lastCheckedAtMs)` collection-group index on
`sendingDomains`**, added to `cloud/firebase-firestore.indexes.json` and not
yet deployed. Until it is, the sweep's query throws, the runner isolates the
failure, and the beat retries.

### 2. ~~There is no console card~~ — BUILT

`Emails → Sending` is the surface. `sending-domains-card.tsx` lists the org's
domains beside what THIS site currently sends as, and
`sending-domain-detail.tsx` is one domain's own route: its state, the records
to publish, the DMARC read, Check DNS, the per-host selector and Remove.

The five states are described once, in
`libs/plugins/email/src/lib/model/sending-domain-status.ts`, so the list and
the detail page cannot disagree. Four of them are stored;
**`inconclusive` is deliberately not one of them** — it is held as transient
surface state BESIDE whatever the record still says, because a lookup nobody
answered changed nothing and rendering it as `failed` sends a customer whose
DNS is correct to go and edit a zone that is fine.

The per-host selector writes through `/api/email/sending-identity`, which is
`org.settings`-gated on write and admin-or-editor on read — the composer has to
be able to SEE the identity without being able to change it. The two host keys
are Admin-SDK-only in the rules, because a site `admin` may be a site-scoped
collaborator with no org standing at all.

**The composer shows the identity, and refuses on it.** The choice rides the
dry run, so a domain whose DNS is unfinished is refused at the composer with
the records named — before any copy is written — rather than as a 409 after
the click.

### 3. The `from` override is still open

`SendEmailOptions.from` remains reachable. A resolved identity now outranks it,
so a campaign cannot be moved off a verified domain — but a caller that passes
`from` and no identity still bypasses the configured sender. Closing it means
auditing all 39 senders and is its own change.

The COMPOSER's identity choice is not this hazard and deliberately does not
resemble it: `sendingIdentity` has exactly two values, empty and `platform`,
reduced to those at the route's edge. It can only DROP the site's selection,
never introduce one, so no domain name from a request ever reaches the
resolver — which is what keeps an editor of one site in an agency org from
sending as another client's verified domain.

### 4. Not attempted

Dedicated IPs (need consistent volume to warm, and damage deliverability
below it), BIMI/VMC (needs DMARC enforcement plus a registered trademark),
domain registration, and per-message `From` overrides — a message may choose
between the identities its SITE already holds, and cannot name one.

**Several custom identities per site.** The model gives a site one selection,
so the composer offers that or the shared domain. An agency wanting two
`From:` addresses on one site would need a per-host allow-list over the org's
verified set, which is a scope that does not exist yet.

---

## DMARC alignment: what actually holds, measured

`_dmarc.aglyn.app` publishes, as of 2026-08-31:

```
v=DMARC1; p=reject; sp=reject; adkim=s; aspf=r; rua=mailto:webmaster@aglyn.com
```

`sp=reject` extends the policy to every subdomain, so it governs every sending
name in the mail apex. There is no `_dmarc` record on `mail.aglyn.app` or on any
name below it, so every one of them inherits this record.

**The `aspf=r` half is the one that matters and the one previously overlooked.**
DMARC passes when EITHER identifier aligns. Strict DKIM means the signature's
`d=` must equal the `From:` domain exactly; relaxed SPF means only the
organizational domains must match, and every name under `aglyn.app` shares an
organizational domain. So a shape can fail DKIM alignment completely and still
pass DMARC on SPF alone.

Evaluated against the live record:

| Shape | `From:` | DKIM `d=` | Direct | Forwarded |
| --- | --- | --- | --- | --- |
| Shared pool member | `shared1.mail.aglyn.app` | same | pass | **pass** |
| Dedicated per-site | `northwind.mail.aglyn.app` | same | pass | **pass** |
| Per-host `From:` over ONE apex key | `northwind.mail.aglyn.app` | `mail.aglyn.app` | pass | **FAIL → reject** |
| Customer-owned | `acme.com` | same | pass | **pass** |

Row three is the tempting design — one provider domain object for the whole
platform, and the site's name still in the header. An earlier version of this
document said it "fails DMARC and is rejected". That was the right conclusion
for the wrong reason, and the wrong reason makes it dangerous: it **passes** on
direct delivery, because relaxed SPF rescues it. It fails only once a recipient
forwards the message, because forwarding breaks SPF and the DKIM signature that
would have survived is the one that does not align.

A shape that tests green to one mailbox and fails in the field is worse than one
that refuses outright. **The rule that follows is the whole constraint on the
design: the `From:` domain must be exactly the domain whose key signs it.**
Every sending identity here obeys it — a pool member sends as itself, a
dedicated domain sends as itself, a customer domain sends as itself — and there
is deliberately no configuration that can produce row three.

## What a sending domain costs, and where it stops being possible

Measured 2026-08-31 against published vendor documentation. The previous
version of this section concluded that one domain per site "reads like the
expensive choice and is not". **That conclusion was wrong**, and it was wrong
because it counted only the provider's price list. A per-host sending domain is
`O(hosts)` in three resources, and the money is the one that matters least.

| Resource | Per dedicated domain | Per customer-owned domain | Per pool member |
| --- | --- | --- | --- |
| Provider domain object | 1 | 1 | 1, for the whole platform |
| **Records in OUR DNS zone** | **3** | **0** — the customer publishes them | 3, for the whole platform |
| Place in the re-verification sweep | forever | forever | 4 total |

The middle column is the asymmetry the old analysis missed. A customer-owned
`acme.com` and a platform `northwind.mail.aglyn.app` look like one feature and
do not scale alike: only one of them writes into a zone we have to hold.

### The vendor numbers

| Constraint | Value | Source |
| --- | --- | --- |
| Resend verified domains | Free 3, Pro 10, Scale 1,000 | resend.com/pricing |
| Resend domain add-on | **a toggle**: +100 for $20/mo, Pro and Scale | resend.com/docs/knowledge-base/how-to-add-more-domains |
| Self-serve ceiling | **1,100** (Scale + the one add-on). Past that, "chat with support" | same |
| Resend API rate limit | **10 req/s per TEAM**, shared across every key **and with `POST /emails`** | resend.com/docs/api-reference/rate-limit |
| Records Resend requires per domain | **3** (MX `send`, TXT `send`, TXT `resend._domainkey`) | resend.com/docs/add-a-domain |
| Vercel DNS record creation | **50 per minute**, scoped to the `owner` | vercel.com/docs/limits |
| Vercel records per zone | **not published anywhere** | — |

Two things follow immediately, and both were assumptions before:

- **The add-on does not stack into a quantity.** It is a toggle that adds one
  hundred. There is no self-serve configuration that holds ten thousand
  domains, so "90 add-ons at $20" is not a purchase anyone can make — it is a
  contract negotiation. **No add-on is purchased today**, so the real ceiling
  right now is the plan's own allowance, which is what
  `AGLYN_SENDING_DOMAIN_CAPACITY` defaults to.
- **Vercel publishes no per-zone record limit.** That is not permission; it is
  the absence of a commitment. The nearest anchors are Route 53's 10,000 per
  hosted zone (raisable, and billed above the default) and Cloudflare's 3,500
  on Pro and Business.

### One domain per site, at four scales

Three records per domain, so zone records are `3 × sites`. Creation time is
`records ÷ 50` minutes of continuously saturated Vercel DNS API — an API
scoped to the whole team, and shared with tenant web-domain attachment.

| Sites | Domains | Zone records | One-time creation | Provider | Verdict |
| --- | --- | --- | --- | --- | --- |
| 100 | 100 | 300 | 6 min | Pro + add-on = **$40/mo** | Fine |
| 1,000 | 1,000 | 3,000 | 60 min | Scale + add-on = **$110/mo** | Works, and is already at Cloudflare's per-zone figure |
| 10,000 | 10,000 | 30,000 | **10 hours** | **past self-serve entirely** | Infeasible |
| 100,000 | 100,000 | 300,000 | **100 hours** | negotiated only | Impossible |

The re-verification sweep is the cost the price list never shows, because it
**recurs**. Every dedicated domain must be re-checked on a schedule against
DNS and against the provider, forever. At 100,000 domains one pass is 300,000
DNS lookups, and any provider call in it draws on an account-wide limit of ten
requests a second **that the sends share** — 100,000 domains is roughly 2.8
hours of fully saturated rate limit during which the platform cannot send.

So the wall is not the money. At 10,000 sites the zone is three times Route 53's
default quota and the provider allowance is off the self-serve price list
altogether; the dollars would have been the least of it.

### Would NS delegation rescue it? No — checked, not assumed.

If a sending subdomain could be delegated to the provider's nameservers, every
per-host record would live in THEIR zone and ours would hold a handful of `NS`
records forever. SendGrid and Mailgun support variants of this, so it is the
obvious thing to reach for.

**Resend does not support it.** Across the complete documentation corpus
(`resend.com/docs/llms-full.txt`, 356 pages) `delegat*`, `hosted zone` and
`automated security` return zero matches, and the decisive detail is in the
API: `POST /domains` returns `records[]` whose `type` enum is `MX | TXT |
CNAME`. **`NS` is not representable in the response**, so this is a structural
absence rather than a documentation gap. Resend's own multi-tenant guide offers
exactly two options — one domain object per tenant, or separate accounts — and
no wildcard sending domain exists.

Vercel DNS *can* create `NS` records, so our side is not the blocker. If NS
delegation ever becomes a hard requirement it selects the ESP, not the design.

### What the model is instead

Domain count is `O(1) + O(customers who want isolation)`, never `O(hosts)`:

| Shape | Reputation | Provider slots | Our zone records | Who |
| --- | --- | --- | --- | --- |
| **Shared pool** | Pooled across the sites on one member | 4 | **12** | Every site with no domain of its own. Transactional ONLY. |
| **Customer-owned** | Fully the customer's | 1 each | **0** | Pro and above (`customSendingDomain`), for anyone who wants isolation and a name recipients recognize |
| **Dedicated platform subdomain** | Fully the site's | 1 each | 3 each | Pro and above, provisioned on upgrade, **best-effort** |

The pool is flat at every scale — twelve records whether the platform has
twelve sites or a hundred thousand. Customer-owned domains scale with
willingness to pay and cost our zone nothing, which is what makes them the
right isolation *product* rather than a concession.

The dedicated platform subdomain is the one that must stay bounded. It is
genuinely useful — reputation isolation with no DNS work for the merchant —
and it is the only shape whose cost lands in our zone. It is therefore a
**capacity-managed resource**, not an entitlement that scales: gated to Pro and
above, claimed at the upgrade rather than at signup, and capped by
`AGLYN_SENDING_DOMAIN_CAPACITY`. Past roughly a thousand of them the honest
answer is to move merchants who want isolation onto their own domains, which is
why customer-owned domains start at Pro rather than at Agency: they are the
cheap shape, and gating the cheap shape most tightly made the expensive one the
default at every tier that can send.

**The subdomain is an optimization; the pool is the guarantee.** A site whose
subdomain has not been provisioned — the ceiling reached, a zone write failed,
the sweep not yet run — sends its transactional mail on the pool and keeps
sending it. That is what makes a platform-wide ceiling a safe thing to enforce
rather than a fatal one: hitting it costs delivery *isolation*, never receipts.
`resolveSendingIdentity` draws the line at whose domain it is, not at whether
one is verified — a customer's own unverified domain still refuses, because
there the merchant told us what their recipients would see.

### Dedicated IPs

Still out, for the reason section 4 gives, and the price agrees: $30/mo, Scale
only, and harmful below roughly 90,000 messages a month.

## What a human must still do

The code is finished and inert. Nothing below can be done from a repository.

### 0. Create the shared pool. This is the one that unblocks every site.

Until these exist, every site without a domain of its own refuses every message
— receipts and password resets included — with
`tenant-identity-unprovisioned`. It is four domains, once, and it does not grow
again:

1. In Resend, create a domain object for each of `shared1.mail.aglyn.app`
   through `shared4.mail.aglyn.app`. Four is `DEFAULT_SHARED_POOL_SIZE`; a
   deployment that wants a different number sets
   `AGLYN_TENANT_SHARED_POOL_SIZE` **and creates exactly that many**, because
   the code derives the pool from the number and will otherwise hand sites an
   address nothing signs for.
2. Publish each one's three records into `aglyn.app`: `TXT send.shared{n}.mail`,
   `MX send.shared{n}.mail`, and the issued `TXT
   {selector}._domainkey.shared{n}.mail`. Twelve records total, and this is the
   entire DNS footprint of every unprovisioned site on the platform.
3. Verify all four in Resend before any traffic arrives. A pool member that is
   not verified is a domain the provider will refuse to send from, and the
   refusal will land on a merchant's receipt.

Do NOT create a domain object for the bare mail apex. Nothing sends from it —
the pool members are one label deeper, each signing for itself, which is what
satisfies `adkim=s`.

Growing the pool later is safe: the assignment is rendezvous-hashed, so adding a
member moves only the sites that land on the new one and never shuffles sites
between existing members. Shrinking it moves only the removed member's sites.

### 1. The dedicated-domain credential

1. **Mint a Resend API key with full access.** Resend dashboard → API Keys →
   Create, permission **Full access**. It cannot be a sending key: a
   sending-scoped key answers `POST /domains` with `restricted_api_key`, which
   the driver reports as `http-403:restricted_api_key` and which leaves the
   domain at `requested`. Domain-scoping the key to one domain is also wrong —
   it has to create domains that do not exist yet.
2. **Put it in `RESEND_DOMAINS_API_KEY` on the CONSOLE Vercel project only.**
   Not the tenant project, and not a shared/team-level record that would link
   to both. The console is the only app whose code reads it, and the isolation
   spec exists so that stays true; a shared record would hand the key to the
   runtime that serves published sites, where nothing reads it and everything
   could.
3. **Environments: production and preview.** Development can stay unset — with
   no key the flow is the honest `pendingProvider` path, which is what a
   developer should be looking at anyway. Set it on preview only if sending
   domains are to be exercised there, and understand that a preview deployment
   then creates real domain objects in the live Resend account.
4. **Redeploy the console.** Vercel injects environment at build; an added
   variable does not reach a running deployment.
5. **Add it to `SECRET_ROTATION.md`'s inventory** in the same tier as
   `RESEND_API_KEY` or above — it is strictly more powerful than the sending
   key, since it can enumerate the account and create further keys.

Verify with a request for a domain in the console: `pendingProvider` should
become `false` and the DKIM row should carry a `p=` value. If it stays true,
`lastIssueError` on the record names why, as a code — `http-403:…`,
`duplicate-mismatch`, `timeout`.

### Deploying the sweep is what starts spending slots

`/api/admin/provision-sending-domains` is a route on the `consoleFastCrons`
Cloud Scheduler job. It is idempotent and safe to run at any time, but the
first tick after `cloud/functions` is deployed is the one that turns every
outstanding claim into a real domain object at the provider — so the plan's
allowance has to cover the site count BEFORE that deploy, not after.

`AGLYN_SENDING_DOMAIN_CAPACITY` is the backstop if it does not: the sweep
stops at the ceiling, stores `at-capacity` on the records it could not
provision, and logs the count. Nothing is lost, and a later tick finishes the
remainder once the allowance is raised. A `GET` of the same route reports
`held`, `capacity` and `atCapacity` without writing anything, which is how to
tell a queue waiting on vendor work from a queue waiting on a purchase.

Sites in that queue keep sending on the pool throughout, so the ceiling is a
purchasing decision and not an incident. The two levers pull on different
resources and are worth keeping apart:

- **To raise the count** — buy the provider's domain add-on and set
  `AGLYN_SENDING_DOMAIN_CAPACITY` to the new allowance. A tier upgrade buys
  the same domains for considerably more; choose the tier by send volume.
- **To stop the demand growing** — move merchants onto domains they own. A
  provider slot is spent either way, but a customer's domain costs nothing in
  our zone and nothing in the re-verification sweep we run against it.

Neither lever is a customer plan change, and the at-capacity log says so.
Growing `AGLYN_TENANT_SHARED_POOL_SIZE` (capped at 64) is a third, unrelated
knob: it does not relieve the dedicated ceiling, it widens the floor beneath
it, so that the sites parked on the pool are spread across more reputations.
Rendezvous hashing means growing the pool moves a site only onto a member that
did not exist before, so it is safe to do at any time.

### Could `RESEND_READ_API_KEY` serve instead?

It could. It is specified as full-access for the delivery-history import, and a
full-access key can create domains, so pointing the driver at it would work
today with no new secret to mint. There is a real argument each way.

**For reusing it.** Two full-access keys are two things to rotate, two things
to leak and two things to forget. `SECRET_ROTATION.md` already records that a
shared record linked to no project is inert and that duplicate records are how
rotation goes half-done. And `RESEND_READ_API_KEY` is *also* unset today, so
reusing it is one key to provision rather than two.

**Against, and this is the side to take.** The two keys have different blast
radii and, more importantly, different *homes*. The read key is documented as
`Runtime` and is consumed by a staff action; the domains key must be
console-only, and the isolation spec asserts that its NAME appears nowhere
outside `apps/console`. Sharing one variable between a staff read path and the
domain-creation path means either widening where the read key may live —
undoing the isolation — or narrowing the read key to the console and moving the
import action, which is a bigger change than minting a key.

The sharper argument is the one `RESEND_READ_API_KEY`'s own documentation makes
about `RESEND_API_KEY`: a key is scoped to the smallest thing that needs it so
that a leak is bounded by what that thing does. A read key that can also create
sending domains is exactly the widening that rule exists to prevent. Two keys
with one job each is the cheaper mistake.

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

### The provider seam, mutation by mutation

Fourteen mutations, each applied alone, run, and reverted. Every one turned its
spec red. Two did not on the first attempt, and both were defects in the guard
rather than in the test:

- Making the `none` driver return `issued` with a fabricated key left the
  route's spec green, because the orchestrator refuses on `configured()` before
  it ever calls `issue()`. Flipping `configured()` too — an unconfigured
  deployment claiming to have issued something — turns 3 and 2 assertions red
  across the two files. The layered check is correct; the first mutation simply
  did not reach it.
- The "`records-issued` must have records" guard was a **tautology**. It sat
  behind an earlier `!key` early return, so no input could reach it with a
  blank key, and deleting it changed nothing. The early return's key check was
  removed and the records check made the only gate — so the guard is now what
  actually refuses, and deleting it lets a blank key reach `records-issued`.

A guard that cannot fail is worth less than no guard, because it reads as
protection. Only the mutation found it.

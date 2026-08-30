# Email — competitive analysis and gap register

Status: **research and a register**, with a **closed** marker on the rows that
have since been built. The register itself proposes work and does not do it;
each ✅ below names the commit subject that closed the row, so a reader planning
from this document does not re-propose something shipped.

**Closed since this was written:** [P1](#p1), [G9](#g9), [G10](#g10)/[P6](#p6),
and the D5 and D7 rows of [G11](#g11). Everything else stands.
Written 2026-08-30 against `main` at `39f979587`. Competitor facts were gathered live
from vendor documentation on 2026-08-30; every claim carries the source it came from,
and the appendix lists what could not be verified.

> ⛔ **No Linear issue was created or read.** The [issue-creation freeze] stands. This
> document proposes work; it does not file it. No `AGL-` identifier above the ceiling
> (`AGL-2502`) appears anywhere below.

> ⚠️ **Pricing is locked for Sept 1.** Three findings here imply a packaging change.
> Each is recorded in [§6](#6-decisions-that-belong-to-the-owner) as a decision for the
> owner and **stops there**. Nothing in this document recommends changing a charged price.

---

## 0. Read this first — the existing spec is substantially out of date

`docs/specs/email-overhaul.md` was written against `9315267be`. **One hundred commits
have landed since**, most of them email work, and three of that document's headline
claims are now false. Anyone planning from it will plan the wrong thing.

| `email-overhaul.md` says | Actually, today |
| --- | --- |
| §1c "**Dynamic lists.** Nothing re-evaluates membership from a rule." | **Built and shipped.** `libs/aglyn/src/lib/app-utils/dynamic-list-rule.ts` defines a nine-field rule; `libs/tenant/data/admin/src/lib/server/dynamic-list-materialize.ts` (441 lines) materializes it on a `*/15` sweep with a scan budget and a resume cursor; the Firestore index is deployed. The console exposes **all nine**, on the audience's own edit page. |
| §1c/§1d "`marketingConsent` … is read by **no send path**" | **Built and shipped.** `campaign-send.ts` collects a basis per person while sweeping each silo and joins it through `splitByMarketingConsent`. A basis additionally records **whose act it was** (`assertedBy: 'person' \| 'operator'`), and the composer reports the split before you send. |
| §1c "Custom sending domains **do not exist in any form.** Not a stub, not a disabled button" | **Server-side complete.** `sending-domains.ts` (417 lines) holds the record, the DNS instructions, the DMARC read and a `requested → records-issued → verified/failed` state machine with an `inconclusive` arm; the send path answers **409** for an unverified identity. Two things are missing: the provider credential that issues the DKIM key, and any console UI at all. |
| §1b "Campaign statistics … Every campaign's stats read zero" | The webhook edge block was fixed on 2026-08-29 and opens/clicks now increment behind a replay guard. **But see [G2](#g2)** — `delivered`, `bounced`, `complained` and `unsubscribed` are still never aggregated onto a campaign, so the statistics that exist are the two least useful ones. |

Two of the spec's defects remain open and are confirmed live:

- **D5 — two suppression key derivations.** ~~`libs/plugins/email/src/lib/server.ts:81`
  hashes the address **without lowercasing or trimming**;
  `campaign-send.ts:160` lowercases.~~ The link routes now key through
  `personKey`, which normalizes and refuses a value that is not an address, so
  the variant that hashed the raw string is gone. Two derivations remain —
  `suppressionId` and `emailSuppressionKey` — and both normalize identically,
  so the trap the entry describes is closed.
- **D7 — stale customer documentation.**
  `apps/docs/docs/marketing-and-automation/email-campaigns/overview.md` still says the
  send cap is "counted **per site**, so each site in your organization has its own
  allowance" (lines 48 and 50). The cap moved to per-org. This is a live, published,
  customer-facing inaccuracy.

### Work already in flight — not re-proposed here

Three sibling worktrees are building the three biggest known gaps. This register treats
their territory as taken and ranks around it, but **[G2](#g2) and [G9](#g9) are data
gaps that will block two of them**, which is why they still appear.

| Branch | Scope |
| --- | --- |
| `feature/campaign-reporting` | The campaign statistics console surface |
| `feature/email-list-management` | List member view/add/remove |
| `feature/sending-domain-provider` | The provider credential that issues a DKIM key (2 commits ahead) |

---

## 1. The comparison table

Legend: **MC** Mailchimp · **HS** HubSpot Marketing Hub · **PD** Salesforce Account
Engagement (Pardot) · **KL** Klaviyo · **BV** Brevo · **CIO** Customer.io.
✅ has it · ➖ partial or heavily qualified · ❌ absent · *tier name* = gated to that tier.

Aglyn state is one of:

- **(A) Missing entirely** — no server, no UI.
- **(B) Built server-side, no console surface** — the expensive part is done.
- **(C) Partial** — exists but half-built; the row says which half.
- **(D) Deliberately out of scope** — the row says why.
- **(✔) Shipped** — and, where marked **★**, ahead of every product compared.

### 1a. Audience and segmentation

| Capability | MC | HS | PD | KL | BV | CIO | Aglyn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Filter a list by contact tag or capture source | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(C)** `contactSegments` holds tags + sources; the UI writes **one** source and cannot edit a saved segment |
| Filter by an **event in a time window** ("opened in the last 30 days") | ➖ fixed picklist: 7d / 1mo / 3mo / last 5 campaigns | ✅ | ✅ | ✅ arbitrary | ✅ arbitrary | ✅ arbitrary | **(A)** no engagement data is rolled onto any person record |
| Filter by **purchase behavior** (orders ≥ N, LTV ≥ $X, lapsed N days) | ✅ | ✅ | ➖ | ✅ core primitive | ✅ *Professional* | ➖ undocumented | **(B)** all four filters built and materialized; **zero** console surface |
| **Aggregate event math** (`count`/`sum` over a window) | ➖ | ➖ | ➖ | ✅ published `count`/`sum` schema | ➖ | ❓ undocumented | **(C)** `ordersCountAtLeast` / `ltvCentsAtLeast` only; no general math |
| Nested AND/OR groups, negation, "not in list X" | ✅ *Standard+* | ✅ up to 250 filters | ✅ | ✅ groups AND'd, conditions OR'd | ❌ flat 100-condition chain | ✅ | **(A)** `DynamicListRule` ANDs everything |
| Membership updates **continuously** | ❌ re-evaluated at send time | ✅ active lists | ✅ dynamic lists | ✅ | ✅ | ✅ real-time | **(C)** materialized on a `*/15` sweep; freshness is shown in the UI |
| Predictive scoring (CLV, churn, likelihood to buy) | ✅ *Standard+* | ✅ | ✅ scoring + grading | ✅ | ✅ *Professional* | ➖ | **(D)** see [§5.6](#5-what-not-to-build) |
| Audience drawn from **bookings** | ❌ | ➖ | ❌ | ❌ | ❌ | ➖ | **(A)** bookings write contacts, but no booking rule field exists |
| Audience is a **by-product of the product itself** | ❌ integration | ➖ CRM-native | ➖ | ❌ integration | ❌ | ❌ | **(✔★)** 14 writers through one `upsertHostContact` — forms, bookings, orders, POS, refunds, membership, newsletter, visitors, REST API |

### 1b. Composition

| Capability | MC | HS | PD | KL | BV | CIO | Aglyn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Drag-and-drop email designer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(✔)** the **same besigner as the site**, 9 email blocks |
| Starter template gallery | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(A)** `createEmailScreen` always scaffolds one blank document |
| Reusable saved blocks / sections | ❓ | ✅ | ✅ | ✅ | ✅ whole sections, even on Free | ✅ components | **(A)** |
| Merge tags with a fallback | ✅ | ✅ | ✅ | ✅ Django | ✅ | ✅ Liquid | **(C)** `{{firstName\|there}}` works; no loops, no conditionals |
| Conditional content per segment | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(A)** |
| **Loop over cart line items** in a template | ➖ | ➖ | ❌ | ✅ | ➖ | ✅ | **(A)** |
| Dynamic product block from the catalog | ✅ | ➖ | ❌ | ✅ hydrates from a synced catalog | ✅ *Professional* | ❌ | **(C)** `emailProduct` resolves by id, capped at 20 per send |
| Plain-text alternative generated | ❓ | ✅ | ✅ | ✅ | ✅ auto + editable | ✅ | **(✔)** synthesized at the one chokepoint for every sender |
| **Rendered preview of the email before sending** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(A)** the composer's "preview" counts recipients and renders nothing |
| Cross-client inbox rendering preview | ✅ *Standard+* | ✅ | ➖ | ✅ | ✅ *Starter+* | ➖ | **(A)** |
| AI subject line / content generation | ✅ | ✅ | ➖ | ✅ | ✅ Aura | ✅ | **(A)** Aglyn Assist exists elsewhere and is not wired to the composer |
| From-name / reply-to / preheader in the composer | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(A)** `fromName` resolves from branding; no field exists |

### 1c. Sending

| Capability | MC | HS | PD | KL | BV | CIO | Aglyn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Send to an audience of **any size** in one action | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(A)** hard cap of **500 recipients per send**, no batching — see [G1](#g1) |
| Schedule a send, and cancel it | ✅ *not on Free* | ✅ | ✅ | ✅ | ✅ | ✅ | **(✔)** `datetime-local` picker, cancel from the History row |
| Recurring or RSS-driven campaigns | ✅ | ✅ | ✅ | ➖ | ➖ | ✅ | **(A)** scheduling is one-shot |
| Send in the **recipient's** timezone | ✅ Timewarp *Standard+* | ✅ *Pro+*, not with A/B | ❌ none | ➖ | ❌ | ✅ time windows | **(A)** |
| Send-time optimization | ✅ *Standard+*, not in automations | ✅ per-contact *Enterprise* | ✅ Einstein, enhanced builder only | ✅ needs ≥12,000 recipients | ✅ *Standard+*, works in automations | ➖ | **(A)** |
| **Frequency capping** (max N per contact per period) | ❌ not documented | ✅ *Enterprise only*, rolling, skips | ❌ **none** — a filterable field, not a governor | ✅ Smart Sending, 16h email default | ✅ global across campaigns + automations | ✅ composable shared + per-channel, 48h retry | **(✔)** rolling 24h per person per site, on every plan; a refused message is deferred and retried, not dropped — see [G10](#g10) |
| Quiet hours / business-hours-only sending | ❌ | ✅ workflow time windows | ✅ per program | ✅ SMS flows only | ❌ | ✅ delivery windows | **(A)** |
| Throttled / batched delivery | ✅ *Standard+* | ✅ | ➖ | ➖ | ❌ | ✅ per-channel rate limits | **(A)** |
| Rate-limit deferral that auto-retries | ➖ | ➖ | ➖ | ➖ | ➖ | ✅ | **(✔)** `CampaignSendDeferredError` returns the campaign to `scheduled`; nothing is counted |

### 1d. Automation and journeys

| Capability | MC | HS | PD | KL | BV | CIO | Aglyn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Trigger → action automations | ✅ | ✅ *Professional+* | ✅ | ✅ | ✅ | ✅ | **(C)** a **form**, not a canvas: one trigger + one condition group + an ordered step list |
| **Wait / delay step** | ✅ | ✅ | ✅ | ✅ | ✅ min 1 minute | ✅ delay, window, **wait-until** | **(A)** — no delay step exists, so no sequence can exist. See [G6](#g6) |
| Branching inside a flow | ✅ splits *Standard+* | ✅ | ✅ | ✅ up to 20 paths | ✅ conditional + percentage | ✅ true/false, multi-split, random cohort | **(A)** conditions gate the whole action, not a step |
| Wait until an event happens | ✅ up to 10 | ✅ | ✅ | ❌ | ✅ with a timeout branch | ✅ | **(A)** |
| Update a contact field mid-flow | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(C)** `updateDataset` exists; no contact-property write |
| Call a webhook from a flow | ✅ *Standard+* | ✅ | ✅ | ✅ | ✅ | ✅ bidirectional | **(✔)** `webhookPost` step |
| **Purchase / order as a trigger** | ✅ | ✅ | ➖ | ✅ | ✅ needs their tracker | ✅ | **(A)** `HOST_EVENT_TYPES` has no order event |
| Abandoned cart | ✅ | ✅ | ➖ | ✅ | ✅ | ➖ build it yourself | **(C)** a single reminder, Pro-gated, on the job beat — not a series |
| Back-in-stock | ✅ | ➖ | ❌ | ✅ | ✅ *Professional* | ➖ | **(C)** a single alert |
| Welcome / win-back / post-purchase series | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(A)** blocked entirely by the missing wait step |

### 1e. Reporting

| Capability | MC | HS | PD | KL | BV | CIO | Aglyn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Opens and clicks per campaign | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ human/machine split | **(✔)** raw counts, replay-guarded; no unique-vs-total split |
| **Delivered / bounced / complained / unsubscribed per campaign** | ✅ | ✅ | ✅ | ✅ | ✅ a whole Deliverability tab | ✅ | **(A)** never aggregated — see [G2](#g2) |
| Per-link click stats or a click map | ✅ | ✅ | ✅ | ✅ | ✅ heatmaps *Standard+* | ✅ per-link | **(B)** `clickedLinks` stored per recipient (max 10); nothing aggregates it, nothing reads it |
| A per-campaign detail view | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(A)** History rows are not clickable |
| Compare campaigns side by side | ✅ *Standard+* | ✅ | ✅ | ✅ | ➖ | ✅ two at a time | **(A)** |
| **Revenue attribution** | ✅ | ✅ multi-touch | ✅ | ✅ last-touch, 1–30d per channel | ✅ Revenue tab | ❌ | **(A)** — see [G8](#g8) |
| Export a report | ✅ | ✅ | ✅ | ✅ | ✅ CSV + PDF | ✅ | **(A)** for campaigns; contacts do export |
| Merchant-facing per-recipient delivery log | ➖ | ✅ | ✅ | ✅ | ✅ | ✅ | **(B)** `email-delivery-log.ts` is complete and has only a **staff** per-user card |
| Peer benchmarks | ➖ | ➖ | ❌ | ✅ ~100 matched companies | ❌ | ❌ | **(D)** needs a customer base we do not have |

### 1f. Consent, compliance and deliverability

| Capability | MC | HS | PD | KL | BV | CIO | Aglyn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RFC 8058 one-click unsubscribe | ✅ | ✅ | ✅ | ✅ | ✅ campaigns + transactional | ✅ | **(✔)** on every marketing send, added at the one chokepoint with a visible link on both parts. Whether it is inert is still unchecked — see [§4 P3](#p3) |
| Safe `GET` / mutating `POST` unsubscribe split | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | **(✔★)** a prescanner cannot silently unsubscribe anyone |
| A recorded consent basis consulted at send | ➖ | ✅ | ✅ | ➖ | ➖ | ➖ | **(✔)** `splitByMarketingConsent` on the send path |
| Consent **provenance** — person vs operator assertion | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **(✔★)** `assertedBy: 'person' \| 'operator'` travels with the basis |
| **Pre-send consent preview** of who will be dropped and why | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **(✔★)** consented / by-operator / grandfathered / withheld / suppressed, before you press send |
| Double opt-in | ✅ optional, off by default | ✅ | ✅ | ✅ | ✅ recommended, not forced | ➖ DIY recipe | **(A)** — no vendor *requires* it either |
| Preference center / subscription topics | ✅ | ✅ up to 1,000 types | ✅ | ✅ | ✅ | ✅ topics | **(✔)** org-shared topics, four built in; the footer link opens a hosted preference page with per-topic opt-out and an unsubscribe-from-everything button |
| **Frequency opt-down** ("send me less", chosen by the recipient) | ➖ | ❌ emulated with granular types | ➖ | ➖ | ➖ | ➖ | **(A)** — genuinely thin across the field; see [G10](#g10) |
| Resubscribe that refuses to reverse a bounce or complaint | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | **(✔★)** correctly modeled as sender protection, not a user preference |
| Suppression is an **evidence record**, not a delete | ❓ | ❓ | ❓ | ❓ | ❓ | ❓ | **(✔)** `releasedAt` field; the record is the proof it was honored |
| Add a suppression by hand | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **(✔)** a drawer on the Suppressions card, recorded as its own reason with a note; the platform list has a staff reader and an audited release |
| Tenant sends from **their own** verified domain | ✅ | ✅ | ✅ | ✅ | ✅ automatic DNS write | ✅ | **(C)** server complete, **no UI**, and the DKIM key cannot be issued yet |
| Engagement-based sunsetting | ➖ playbook | ➖ | ➖ | ➖ playbook, manual bulk action | ➖ primitives | ➖ playbook | **(A)** — and note **no vendor automates this either** |
| Import an existing list | ✅ | ✅ | ✅ | ✅ | ✅ with an opt-in attestation | ✅ | **(A)** export only — see [G5](#g5) |

### 1g. Platform shape

| Capability | MC | HS | PD | KL | BV | CIO | Aglyn |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Many brands under one account, isolated at send | ❌ one account each | ➖ | ➖ | ❌ | ➖ *Enterprise* | ➖ workspaces | **(✔★)** org-scoped contacts with `visibleTo`; the send path **refuses** cross-site reach |
| Many sending identities under one account | ➖ | ✅ | ✅ | ➖ | ➖ | ➖ | **(C)** the model is per-org with a per-host selector; blocked on the credential |
| **Self-hostable** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ US/EU regions only | **(C)** SPF and return-path are configurable; **sending is hardcoded to Resend's HTTP API** |
| Runs on the customer's **own** payment account | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **(✔★)** commerce is Stripe Connect |
| Provider-agnostic delivery record | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | **(✔)** only `normalizeResendDeliveryEvents` knows a vendor wire format |
| A ceiling never deletes a person or their data | ❌ contact-tier pricing teaches list deletion | ➖ | ➖ | ❌ | ➖ | ➖ | **(✔★)** enforced at the reduction; the send is refused, the audience is never trimmed |

> **A note on the three named competitors.** Mailchimp and Klaviyo are what a customer
> *leaves* for Aglyn. HubSpot and Pardot are a different purchase entirely — a CRM with
> email attached, bought by a sales organization.
>
> **HubSpot's workflows are Professional and Enterprise only, at $800/month annual
> ($890 monthly) plus a required $3,000 one-time onboarding fee**; Enterprise is
> $3,600/month plus $7,000 onboarding. Frequency capping, send-time optimization, deal
> and revenue attribution and custom objects are **Enterprise-only**. Salesforce
> Account Engagement was repackaged into **Growth+ / Plus+ / Advanced+ / Premium+ at
> $1,250 / $2,750 / $4,400 / $15,000 per org per month**, all with 10,000 contacts
> (75,000 at Premium+), with dedicated IP at $500/month on Plus+ and custom objects at
> $400/month on Plus+.
>
> An Aglyn customer is not choosing between Aglyn and a $9,600-a-year commitment, still
> less a $15,000-a-month one. They are choosing between Aglyn and Squarespace Email or
> Mailchimp Standard. **These two belong in the table as an architecture reference, not
> as a feature target** — which is exactly why [§3](#3-table-stakes-versus-differentiator)
> matters more than closing rows.
>
> Two facts from them are worth borrowing regardless of price. **HubSpot permits sending
> from its own shared domain** — *"Any marketing emails with an unverified from address
> will be sent from a HubSpot-managed domain, such as `hs-domain.com`"* — so our shared
> domain is not an aberration; what matters is what sits around it ([§4](#4-security-and-abuse)).
> And **Pardot evaluates every time-based rule once a day at midnight**, which is a useful
> reminder that our `*/15` dynamic-list sweep is already 96× fresher than a $15,000/month
> enterprise product.

---

## 2. The gap register, ranked

Ranked by **what a paying customer meets first and feels worst**, not by cost to build.
Sizes are rough: **S** days · **M** a week or two · **L** longer, or needs a decision first.

### G1 — A campaign cannot reach an audience larger than 500 people {#g1}

**What it is.** `EMAIL_MAX_RECIPIENTS_PER_SEND = 500`. There is no batching: an audience
of 3,000 is mailed 500 at a time by a human pressing Send six times, and the composer
truthfully reports `Recipients 500 of 3,000`. The send loop is a strictly sequential
`for` over `sendable` with one awaited HTTP POST per recipient, so **raising the number
is not the fix** — 500 messages already occupy most of a function invocation.

**Who has it.** All six. This is not a feature, it is the definition of the product.

**Our state.** **(A)** for batching. The cap itself is deliberate and correctly
dimensioned against the other two ceilings in `send-ceilings.ts`.

**Size.** **L.** It is the resumable-sweep shape the codebase already uses elsewhere
(the delivery-history import, the dynamic-list sweep), applied to sending. The hard part
is exactly-once: a partial batch must never re-send what already went. The reservation
and reconciliation machinery for that is already built.

**What it blocks.** Every plan above Starter. Business is $139/month for 50,000 campaign
emails and 100,000 included contacts; delivering one newsletter to the audience that plan
*includes* is 200 manual sends. Agency is $799/month for 250,000. **We are selling volumes
the product cannot physically deliver through its own UI.** This is the gap most likely
to produce a refund request.

### G2 — A campaign never records whether it was delivered {#g2}

**What it is.** `performCampaignSend` writes `stats: { recipients, sent, audienceSize,
deferred, variantSends }`, and the webhook increments `stats.opens` and `stats.clicks`.
Nothing ever writes `delivered`, `bounced`, `complained` or `unsubscribed` onto a
campaign. So the first question anyone asks after pressing Send — *did it arrive?* — has
no answer, and neither does the second — *how many bounced?*

**Who has it.** All six. Brevo gives it a dedicated Deliverability tab.

**Our state.** **(A)** as an aggregate — but the raw material is already there.
`recordEmailDeliveryEvents` runs **first and for every event type**, and each
`EmailDeliveryEvent` carries `tags` including `hostId` and `campaignId`. The events are
being written today; only the roll-up is missing.

**Size.** **S–M.** The counters are four more dotted-path increments in the branch that
already exists, behind the same replay guard.

**What it blocks.** **`feature/campaign-reporting` cannot succeed without it.** A
reporting surface built now can only display opens and clicks — the two metrics Apple's
Mail Privacy Protection has made least trustworthy — while omitting every metric that
would tell a merchant, or us, that a list is bad. It also blocks [§4 P2](#p2): a
per-tenant complaint rate has to be summed from somewhere.

### G3 — Nobody can see the email before it goes to the whole list {#g3}

**What it is.** The composer's "preview" is a dry run of the *send path* that returns
recipient counts. It renders nothing. A merchant composing in the besigner can open the
designer, but from the composer — the screen with the Send button on it — there is no way
to see the message. `emails-console-page.tsx` has no preview pane and no test-render.

**Who has it.** All six, and four of them additionally render across mail clients.

**Our state.** **(A)** for a rendered preview. **(C)** overall: the test send exists but
delivers **only to the requesting user's own account address** — you cannot type an
address, so you cannot show a colleague or check a second client.

**Size.** **S.** `renderEmailHtml` already produces the exact HTML the send will use, and
`resolveMergeTags` already resolves per-recipient. A preview is that pipeline pointed at
an iframe instead of at Resend.

**What it blocks.** Confidence at the moment of maximum anxiety. It is also the cheapest
defense against the class of defect that has already bitten twice here — a designed
campaign that reached real inboxes with its product blocks missing, and merge tags that
rendered as empty strings for an entire member audience. **Both would have been visible in
a preview.**

### G4 — ~~Every purchase-behavior filter is built, and none of it is reachable~~ ✅ SHIPPED {#g4}

**What it was.** `DynamicListRule` carries nine fields. The console form in
`lists-card.tsx` exposed four: sources, tags, form names, created-after. The five it did
not expose were `segmentId`, `captureSources`, `createdBeforeMs`, and the entire
`behavior` block — **`ordersCountAtLeast`, `ltvCentsAtLeast`, `lastPurchaseWithinDays`,
`noPurchaseForDays`**. The matcher was written, the materializer ran them and the
Firestore index was deployed, so the gap was never engine work: it was a form with
nowhere to grow, wedged above the table that listed the audiences.

**What shipped.** `dynamic-list-rule-fields.tsx` authors all nine, on the audience's own
edit page. Lifetime spend is entered in whole currency units and converted to cents in
one place — a field labeled for the stored unit turns "spent over 500" into five dollars,
and the audience looks plausible either way. The filters are read back as sentences above
the controls, because a merchant can check a paragraph against their intent and cannot
check eleven boxes.

The same builder serves a **fixed** list, which is the other half of this gap: its
filters FIND people rather than deciding membership, and `email/list-rule-preview`
answers who they select without writing anything. What it finds goes through the same
`resolveAddresses` the typed path uses, so a suppressed address comes back refused and
somebody with no opt-in on record still needs the operator's attestation — see §4 P1,
which this deliberately does not become a fifth entry in.

**Who has it.** Klaviyo built a company on it. Mailchimp, HubSpot and Brevo all have it;
Brevo gates equivalent scoring to a **$499/month** tier.

**Our state.** ✅ Shipped.

**Size.** **S**, as estimated — four number inputs and a date input over a shipped
engine, plus the page that had room for them.

**What it blocks.** The single clearest differentiator we have. "Everyone who has spent
over $500 and hasn't ordered in 90 days" is the sentence that sells an ecommerce ESP, we
already store `ltvCents`, `ordersCount` and `lastPurchaseAtMs` on every contact, in the
same database as the orders — and a merchant cannot express it. Nothing else in this
register converts so little work into so much product.

### G5 — A customer cannot bring their existing list {#g5}

**What it is.** There is no CSV import for contacts or lists anywhere in the product.
`contacts-console-page.tsx` exports; nothing imports. Members reach a list only through
newsletter capture, the `enrollList` automation step, or a dynamic rule.

**Who has it.** All six.

**Our state.** **(A)** — and, uncomfortably, this is *why the platform has not yet been
poisoned*. It is simultaneously the biggest onboarding blocker and the biggest abuse
vector, which is precisely why it must ship **with** its controls rather than before them.

**Size.** **M** for the importer, **L** with the controls that have to accompany it.

**What it blocks.** Migration. Every customer arriving from Mailchimp on Sept 1 has a
list and no way to bring it. The counterweight is real: M3AAWG's guidance is that a bulk
import is the fastest way to destroy a shared sending domain, and the controls are
specified in [§4 P4](#p4). **Do not ship the importer without them.**

### G6 — There is no wait step, so there are no sequences {#g6}

**What it is.** `HostActionStep` has 30-odd step types and not one of them is a delay.
(`showElement`/`hideElement` carry a `delayMs`, but that is a browser-side animation.)
An automation is therefore always trigger → immediate actions. No welcome series, no
win-back, no post-purchase follow-up, no "wait three days then ask for a review."

**Who has it.** All six. It is the reason the category is called *marketing automation*.

**Our state.** **(A)**.

**Size.** **L.** A delay needs durable scheduled resumption, which is a genuinely new
mechanism — though `campaign-process-scheduled.ts` already demonstrates the pattern
(a `*/15` sweep over due work with a transaction that prevents double-execution).

**What it blocks.** An entire product category. Note the shape of the fix, though: the
gap is **the wait step**, not a visual canvas. See [§5.2](#5-what-not-to-build).

### G7 — Engagement is recorded per message and never rolled up {#g7}

**What it is.** `emailDeliveries/{sha256(address)}/messages/{id}` stores `openCount`,
`clickedLinks` and `lastEventAtMs` per recipient per message. Nothing aggregates that
onto a person, so "opened something in the last 30 days" is unanswerable without walking
every message subcollection — the expensive-read shape this codebase refuses.

**Who has it.** All six, with arbitrary windows in four of them.

**Our state.** **(A)** for the roll-up; the underlying events exist.

**Size.** **M.** One `lastEngagedAtMs` (and ideally `lastClickedAtMs`) maintained on the
person record by the same webhook that already writes the delivery row.

**What it blocks.** Two things at once, which is why it is worth its rank: a table-stakes
segment type, **and** engagement-based sunsetting ([§4 P5](#p5)). Build the roll-up once.
Note the industry lesson: sunset on **clicks and site activity, not opens** — Apple's
Mail Privacy Protection inflated network-wide open rates by roughly 15%, and Klaviyo's own
guidance says to treat clicks as the primary engagement metric.

### G8 — No revenue attribution, in a product that owns the checkout {#g8}

**What it is.** No campaign, flow or email records revenue. The only "attribution" in the
send path is Resend event tagging.

**Who has it.** Five of six. Klaviyo's is last-touch with a configurable 1–30 day window
per channel; ActiveCampaign's is a fixed, unadjustable 7 days.

**Our state.** **(A)**.

**Size.** **M**, and structurally easier for us than for any of them.

**What it blocks.** The commerce merchant's second question, and a differentiator hiding
inside a gap: **every compared product reconstructs revenue probabilistically because it
does not own the order.** Aglyn does. We can join a campaign to an order exactly, in one
database, with no attribution window and no tracking script. That is a claim none of them
can make, and it is the natural companion to [G4](#g4).

### G9 — Suppression management is half a feature {#g9} — ✅ CLOSED

> ✅ **Closed.** All three holes. *"a merchant can put an address on the
> suppression list by hand"* added the Add control — a drawer, through a route
> because the document id is `sha256` of the normalized address and a browser
> computing it would be a second derivation — recording `reason: 'manual'` as
> its own value rather than claiming somebody clicked a link. *"the platform
> suppression list has a reader, a release and an explanation"* gave
> `listEmailSuppressions` and `releaseEmail` their first callers: a staff card
> with cursor paging and an audited, reason-required release; and the
> merchant's Remove confirmation now says, before the click, when the address
> is also blocked platform-wide. The description below is the state it was
> written in.

**What it is.** Three related holes. The suppressions card **views and removes but cannot
add**, so a merchant asked to stop mailing someone cannot comply from the console. The
**platform-wide** list is invisible: `listEmailSuppressions` and `releaseEmail` in
`email-suppression.ts` have **zero callers anywhere in the repo**, so a platform
suppression can be created by the webhook and never seen or lifted by anyone. And a
merchant who removes a per-site row may still be blocked by the invisible platform row,
with no explanation.

**Who has it.** All six allow manual suppression entry.

**Our state.** **(C)** for the card, **(B)** for the platform list — the read and release
functions are written and unwired.

**Size.** **S** for the add control and a staff surface over the platform list.

**What it blocks.** `feature/email-list-management` runs straight into this. It is also a
compliance exposure: CAN-SPAM requires honoring an opt-out received by any means within
10 business days, and a merchant forwarding "please stop emailing me" has no button.

### G10 — A contact can receive five different emails with no ceiling {#g10} — ➖ HALF CLOSED

> ➖ **The cap half is closed; the preference-center half is not.** *"bulk mail
> carries an unsubscribe, a suppression check and a ceiling"* added a rolling
> ceiling of five marketing messages per person per site per day, enforced at
> the SEND — nobody is unsubscribed, no audience is trimmed, no contact is
> removed. It is the same number on every plan, because it protects a shared
> sending domain rather than anything a customer buys. A campaign counts toward
> it and is exempt from its refusal: a cap that silently removed people from a
> reviewed one-shot send would make the recipient count on screen a lie.
>
> **The preference center is still (A)**, and this register's own judgement —
> that it is the better investment of the two — stands unchanged.

**What it is.** No frequency capping of any kind. A single person can receive a campaign,
an abandoned-cart reminder, a restock alert, a member post and an automation email in one
day. Unsubscribe is also all-or-nothing per site — there is no preference center and no
topic, so a recipient who wants *less* has only two options, and one of them is the spam
button.

**Who has it.** Five of six. Brevo caps globally across campaigns and automations;
Customer.io composes shared and per-channel limits with a 48-hour retry window rather than
a silent drop. Mailchimp is the one that does not document it.

**Our state.** **(A)** for both halves.

**Size.** **M** for a cap, **M** for a preference center.

**What it blocks.** Complaint rate — which makes this a platform control as much as a
customer feature, and it reappears at [§4 P6](#p6). The preference-center half is the
better investment of the two: the alternative to letting someone choose "monthly" is
letting them choose "report spam", and on a shared domain under `p=reject` that choice is
charged to every other tenant.

### G11 — Smaller and structural, in rough order {#g11}

| Gap | State | Size | Note |
| --- | --- | --- | --- |
| No starter email templates | **(A)** | S | `createEmailScreen` always scaffolds one blank document; every competitor ships a gallery |
| A/B has no automatic winner | **(C)** | M | Variant assignment and conversion counting are built; nothing picks a winner or sends it to the remainder |
| Campaign history is 30 documents in **document-id order** | **(C)** | S | The same defect class closed everywhere else; the file documents and warns about it, which makes it honest but still wrong |
| No `manual` audience in the UI | **(B)** | S | The server accepts `emails[]` up to 500; only the internal test send uses it |
| `toField` on the automation email step is not exposed | **(B)** | S | The type carries it; the form shows Subject and Body only |
| No from-name / reply-to / preheader field | **(A)** | S | `fromName` resolves from branding, so there is no way to send as anything else |
| Segments cannot be edited, and take one source | **(C)** | S | Save-new and delete only; the chip reads `sources[0]` |
| Contact-property write from an automation | **(A)** | M | `updateDataset` exists; tagging a contact from a workflow does not |
| ~~Two suppression key derivations (**D5**)~~ | ✅ | — | Closed. `server.ts` now keys through `emailSuppressionKey`, and the unsubscribe signer and verifier are one module rather than two implementations of the same HMAC subject — the marketing gate would have been a third |
| ~~Docs say the send cap is per site (**D7**)~~ | ✅ | — | Closed by `f6480558f`, before this register's work began. The page reads "per workspace" |
| Docs describe adding list members by hand | — | S | There is no such control |
| Self-host cannot use SMTP | **(C)** | M | Sending is hardcoded to `RESEND_SEND_ENDPOINT`; an operator must have a Resend account, which contradicts "every dependency configurable" |

---

## 3. Table stakes versus differentiator

### 3a. Table stakes — required, and worth nothing on their own

[G1](#g1), [G2](#g2), [G3](#g3), [G5](#g5), [G6](#g6), [G7](#g7), [G9](#g9) and
[G10](#g10) all exist in all six compared products. Shipping every one of them makes
Aglyn a credible ESP and **makes nobody choose Aglyn**. They are the entry fee, and the
register ranks them highly for exactly that reason: an entry fee is what you pay first.

The trap to avoid is the one the existing spec names — a product with every HubSpot
feature and none of its own is not a plan. So the question that decides the roadmap is
not "what are we missing", it is "what can we do that they structurally cannot".

### 3b. Four positions no compared product can copy

**1. The audience is a by-product, and the consent basis travels with it.**

Fourteen call sites write a contact through one `upsertHostContact` — forms, bookings,
paid bookings, orders, POS, refunds, membership registration, newsletter capture, visitor
records, the REST API. Every capture surface records a marketing basis, and the basis
records **whose act it was**.

Mailchimp, Klaviyo and Brevo must ingest this across an integration, and the consent
signal is the first thing an integration loses. Klaviyo's own billing definition proves
it: an "active profile" is **"any profile, regardless of consent status, that can be
emailed"**, and their documentation says explicitly that this includes someone who left
an email at checkout without opting in. Klaviyo bills for that person and cannot tell you
they never asked. **Aglyn can, at the point of capture, and already does.**

The composer's pre-send split — consented, by-operator, grandfathered, withheld,
suppressed — is a feature **no product researched has**, and it is shipped. It is
currently framed as an internal correctness detail. It is the strongest marketing asset
in the email product: *the only ESP that tells you, before you press send, which of these
people actually asked — and who says so.*

**2. Commerce data with no integration, and therefore attribution with no window.**

Klaviyo's moat is `count`/`sum` over `Placed Order` in a time window, plus last-touch
revenue attribution. To get there it needs a Shopify app, a catalog sync, an on-site
tracking snippet and a configurable attribution window, and it still only knows what the
last touch was.

Aglyn stores `ltvCents`, `ordersCount`, `lastPurchaseAtMs`, `firstPurchaseAtMs` and
`refundedCents` on every contact, in the same database as the orders, in the same product
as the store. The behavior matcher and materializer are written ([G4](#g4)). And because
we own the checkout, [G8](#g8) is not an attribution problem for us — it is a join.

**3. One organization, many brands, enforced at the send.**

`contacts` are org-scoped with a `visibleTo` token, and `performCampaignSend` already
refuses to let one site's campaign reach another site's audience. Mailchimp's answer for
an agency with 40 clients is 40 accounts and 40 invoices; Klaviyo's is 40 accounts;
Brevo's multi-account is Enterprise-only. Aglyn ships it in the data model.

The unfinished half is sending identity — 40 clients each need mail *from the client's
domain*. The record, the DNS instructions, the DMARC read and the send-time refusal are
built; the provider credential is in flight and the UI does not exist. When it lands,
*"one login, forty brands, each mailing from its own verified domain, one invoice"* is a
sentence no compared product can say.

**4. Self-hostable, on the customer's own payment account.**

None of the six offers self-hosting; Customer.io's only sovereignty lever is a choice of
US or EU data center. Aglyn already parameterizes `AGLYN_EMAIL_SPF_INCLUDE` and
`AGLYN_EMAIL_RETURN_PATH_HOST`, and the delivery log is provider-agnostic by
construction. Commerce runs on the merchant's own Stripe Connect account, so email about
money concerns money that never touched us.

The gap is small and specific: **sending is hardcoded to Resend's HTTP endpoint**, so a
self-host operator must have a Resend account. An SMTP transport behind the existing
`sendEmail` chokepoint completes a claim we already make.

### 3c. The honest counterweight

A register that only flatters is not calibrated. Three places where we are behind, or
where our stated position does not match our code:

- **We do meter contacts.** The existing spec says do not copy Mailchimp's contact-count
  pricing. We have copied its *shape* — `contactsPerHost`, with a per-1,000 overage —
  and softened it into cost-plus metering with a hard band only on free. That is better
  than Mailchimp's tier cliff, and it is not a different model. Worth being straight
  about, because the differentiator is *"a limit never deletes a person"*, which we do
  honor and Mailchimp's incentive structure does not.
- **Our A/B is thinner than Mailchimp's**, which varies four dimensions, runs up to three
  variations, and picks a winner by revenue.
- **We have one channel.** Every compared product has at least three. See
  [§5.1](#5-what-not-to-build) for why that is the right call anyway.

---

## 4. Security and abuse

Ranked by **what protects the platform first** — the shared domain, and therefore every
other tenant's mail — rather than what improves one tenant's own results.

### 4a. The structural fact, stated precisely

Everything leaves on one domain under `p=reject`, and three verified mechanics compound:

- **Google counts the bulk-sender threshold per primary domain, subdomains included.**
  "When we calculate the 5,000-message limit, we count all messages sent from the same
  primary domain."
- **Bulk-sender status is permanent.** "Senders who meet the above criteria at least once
  are permanently considered bulk senders… Changes in email sending practices will not
  affect permanent bulk sender status once it's assigned."
- **The Compliance Status dashboard applies to primary domains only**, and Yahoo
  classifies "at the authenticated domain or From header domain level."

So this is not a diluted pool. It is **one number, evaluated daily, for everybody,
permanently**. Above a 0.3% spam rate the domain becomes ineligible for mitigation until
the rate stays under 0.3% for seven consecutive days. And Google's denominator counts
only mail *delivered to the inbox and then marked spam* — so a tenant whose mail is
already being filtered makes the ratio **worse**, not better.

Two corrections worth propagating internally, because both are widely repeated and both
are wrong: **Yahoo publishes no volume threshold at all** ("We will not specify a volume
threshold"), and Google's 48-hour unsubscribe figure is a *recommendation* — Yahoo's
two-day figure is the requirement.

M3AAWG named this exact failure mode in 2015 and prescribed the fix: *"ESPs that send
large volumes of email on behalf of their clients are at the mercy of their worst
clients' worst practices,"* and mail from each entity in a shared environment should be
*"authenticated using DKIM, with a unique domain or subdomain as the entity asserting
responsibility for the mail."*

**And Yahoo's Complaint Feedback Loop is DKIM-only and domain-based.** With one shared
`d=`, we receive **one undifferentiated ARF stream** — we cannot tell which tenant earned
a complaint even in principle. Per-tenant DKIM subdomains are what buy that back, along
with independent Google Postmaster dashboards (attribution there is by the DKIM `d=` or
SPF Return-Path domain, not the `From:` domain). One precision, because it is tempting to
overclaim: **Google is silent on whether subdomain *reputation* is separate from the
parent.** Subdomains buy verified *attribution*; reputation isolation is inferred.

#### The number that should concentrate attention

**Resend — our provider — publishes: complaints below 0.08%, bounces below 4%, and
*"your account may be shut down without warning."*** That threshold applies to the
**Aglyn account**, which is every tenant at once. We are not managing a reputation score
that degrades gracefully; we are one tenant's bad week away from an automatic, unwarned
cutoff of all outbound mail — including every password reset and order confirmation.

For calibration, published enforcement lines elsewhere: Customer.io suspends or terminates
at a complaint rate at or above **0.1% over 30 days** (plus a $100 charge per substantiated
incident); Brevo's deliverability guidance names hard bounce **>2%**, unsubscribe **>1%**
and complaints **>0.2%** as grounds for suspending a campaign or an account; Omnisend
matches Resend at **0.08%** complaints and **4%** bounces. Mailchimp and Klaviyo publish no
number at all. **Every published vendor line sits at or below Google's 0.10% target — none
waits for the 0.30% ceiling**, which is the calibration our own threshold should inherit.

One route that is closed to us: Validity's sender certification explicitly **will not
certify** *"Email Service Providers (ESPs), Agencies, Third-party Mailers"*. A platform
cannot buy its way out of this with an allowlist.

#### The enforcement model worth copying is HubSpot's

HubSpot is unusually explicit, and its shape fits our house rules better than a bare
threshold does. It publishes **hard bounce 5%, spam reports 0.1% (one per thousand sent),
unsubscribes 3%**, assessed **cumulatively over a month** — and then defines **two states,
not one**: *email sending probation*, which the customer clears themselves by reviewing
their contacts, removing non-consenting addresses and attesting, escalating to full
suspension only if they do not.

That graduated, self-service ladder is the same instinct as enforce-at-the-reduction:
it refuses the *sending*, tells the customer exactly what to fix, and leaves their data
alone. It is a better model for [P2](#p2) than a binary pause, and it composes with the
SES tenant-state machine rather than competing with it.

Note also what HubSpot does **not** do: import validation is *format-only* — a consent
attestation plus an email-syntax check, with no MX or mailbox-existence test — so its
list-quality enforcement is deliberately **post-hoc**, via the probation ladder rather
than a gate. That is a defensible design and a cheaper first step than [P4](#p4)'s
full vetting flow.

### P1 — Four bulk paths send with no unsubscribe header, no suppression check, and no cap {#p1} — ✅ CLOSED

> ✅ **Closed**, exactly where this section said to close it: at the
> `sendEmail` chokepoint. A caller declares `marketing: { hostId, siteBase }`
> and the message gains the RFC 8058 header pair, a visible opt-out link on
> both parts, a check against both suppression lists, and the [G10](#g10)
> ceiling — one seam rather than four call sites remembering. The durable half
> is injected from `@aglyn/tenant-data-admin` the way the send-rate governor
> already is; nothing installed is ungated, not refused.
>
> All four paths declare it. The two cron sweeps additionally take `'bulk'`
> priority, so the hourly governor can defer them, and they now stamp their
> subject only when the message was not deferred — a refusal the window can
> clear is retried, while a suppression retires the row instead of being
> re-read on every beat. `member-post.ts`'s `limit(500)` with no `orderBy` is
> fixed in the same commit.
>
> A build-time sweep (`marketing-mail-carries-its-controls.spec.ts`) enumerates
> the audience senders from the source and fails on a fifth that does not
> declare itself, so this cannot quietly reopen.
>
> **Two things it deliberately did NOT do**, both recorded in
> [§6.4](#6-decisions-that-belong-to-the-owner) as the owner's: these paths
> still do not count against `emailSendsPerMonth`, and `member-post.ts` and
> the workflow email step stay transactional priority — neither is resumable,
> and only a resumable sweep may take a refusal the recipient survives.

**This is the top finding of the whole exercise.**

`List-Unsubscribe` and `List-Unsubscribe-Post` are added in exactly one place,
`campaign-send.ts:1122`. The shared `sendEmail` chokepoint — which all 39 senders pass
through — adds neither, and **does not consult either suppression list**. Only
`campaign-send.ts` and `usage-alert-email.ts` call a suppression filter at all.

Four merchant-triggered paths therefore mail people who hard-bounced or pressed "report
spam", with no unsubscribe mechanism:

| Path | Volume | Gated by |
| --- | --- | --- |
| `commerce/server/member-post.ts` | up to 200 subscribers **per click**, unlimited clicks | nothing but commerce being on |
| `commerce/server/process-abandoned.ts` | per sweep | `abandonedCart`, Pro+ |
| `commerce/server/process-restock.ts` | 200 per sweep | nothing but commerce being on |
| `tenant/runtime/run-event-actions.ts` `sendEmail` step | per event | nothing |

All four carry a `context` other than `'campaign'`, which makes them **transactional
priority**, which means `isRefusablePriority` is false and **the hourly governor cannot
refuse them**. They are metered for cost and never counted against `emailSendsPerMonth`.

Two details sharpen it. The automation step takes its recipient from the *event payload*
(`payload[step.toField ?? 'email']`) with a merchant-authored subject and body — and the
collect route's own docblock already says these are *"customer content writes and outbound
messages, triggered by an anonymous visitor."* And `member-post.ts` reads its audience
with `limit(500)` and **no `orderBy`** — the exact defect D1 closed everywhere else.

**Calibration.** This is not a free-tier hole: free has `commerce: false`, so member posts
and restock alerts are unreachable there. The finding is an **asymmetry**, and it starts
at Starter: a $25/month customer is sold **500 campaign emails a month** through the
capped, suppressed, unsubscribable path — and gets an **uncapped** one next to it.

**Why first.** One fix at the `sendEmail` chokepoint — add the headers, consult
`filterSendableForHost` — closes a Google/Yahoo compliance failure, a suppression-honoring
failure and an uncapped volume path simultaneously, for all four callers at once.

### P2 — No per-tenant complaint or bounce rate, so no circuit breaker {#p2}

Nothing computes a rate at any scope. There is no per-org number, no threshold, no pause,
no staff review queue. Grep returns zero for `complaintRate`, `bounceRate`,
`circuitBreaker`. The inputs exist — every delivery event carries `tags.hostId` — but
[G2](#g2) is the missing roll-up.

**And the problem is worse than a missing aggregate, because the mailbox providers cannot
attribute either.** Google Postmaster Tools keys on the **DKIM `d=` or SPF Return-Path
domain**, and Yahoo's Complaint Feedback Loop is DKIM-only and enrolled per domain. With
one shared `d=`, we do not merely lack *isolation* — **we lack *visibility***: we cannot
tell which tenant caused a complaint spike even after it has happened, and no amount of
work on our own delivery log recovers a signal the provider never separated.

That makes **per-tenant DKIM on a per-tenant subdomain the prerequisite for this entire
section**, not an alternative to it. It is M3AAWG's explicit prescription for shared
environments, it unlocks independent Postmaster dashboards and per-tenant CFL attribution,
and it is largely the same machinery as the custom-sending-domain work already in flight —
which is a strong argument for finishing that work for its *platform* value, not only as
a white-label feature. The honest caveat, again: this buys verified **attribution**;
reputation isolation at Gmail is undocumented.

**The reference implementation is published and recent.** Amazon SES launched *Tenants*
on 2025-08-01, framed at our exact problem: it *"addresses the challenge where one
customer's poor email practices could previously pause an entire SES account, affecting
all other customers."* The design is worth copying nearly wholesale:

- per-tenant reputation findings from bounces, complaints, third-party mailbox-provider
  feedback and **IP blocklist listings**, graded Low or High severity;
- three policies — **Standard** (auto-pause on high severity), **Strict** (auto-pause on
  any finding), **None** (record only);
- tenant states Enabled / Paused / Enforced / **Reinstated**, where Reinstated is a grace
  period in which active findings are ignored so a tenant can recover;
- the onboarding pattern AWS recommends: policy **None** while a new tenant is observed,
  then enforcement.

AWS also prints the caveat we must internalize: *"their combined sending activity still
affects your overall account reputation."* **Tenant isolation partitions enforcement, not
reputation at the mailbox provider.**

⚑ Transactional mail must stay exempt at every threshold — the rule the quota and the
governor already enforce twice each. A merchant with a bad list still gets password resets.

### P3 — Verify that our one-click unsubscribe actually works {#p3}

RFC 8058 requires that the message carry a valid DKIM signature **and** that both
`List-Unsubscribe` and `List-Unsubscribe-Post` be *"covered by the signature and included
in the `h=` tag."* If they are not, *"the mail receiver SHOULD NOT offer a one-click
unsubscribe."*

We hand both headers to Resend; **Resend performs the DKIM signing**, so whether they fall
inside `h=` is not decidable from this repository. Every surface we own reports one-click
as shipped.

**This is the exact shape of the click-tracking defect** — a feature that is structurally
inert while looking complete, discovered only by reading a real message. The check costs
one send: mail a campaign to a seed address and read the `DKIM-Signature` `h=` tag. Do
this before building anything else in this section; it is an hour, and it either confirms
compliance or invalidates a claim we are making to customers and to Google.

### P4 — Import does not exist yet, which is the best possible moment to design it {#p4}

[G5](#g5) is the product gap; this is its condition.

**A premise worth correcting before designing against it:** the widely-repeated belief
that the big vendors review imports above some contact count is **not supported by their
documentation**. None of Klaviyo, Mailchimp or Brevo publishes a numeric import-review
threshold. What they actually ship is more interesting and more copyable:

- **Mailchimp's Omnivore** is the only *named* import gate in the industry. It checks
  addresses you have never mailed before, estimates *"how many of those addresses are
  likely to be spamtraps, or to generate abuse complaints and hard bounces"*, and on a hit
  **disables sending to that audience until the bad addresses are removed** — audience
  scoped, data retained, account untouched. That is exactly our enforce-at-the-reduction
  rule: it refuses the *send*, never the *people*. It also throttles deliberately: the
  first campaign after a large import *"will send slowly so that our system has time to
  verify the imported addresses."*
- **Omnisend** is the only vendor documenting inspection of the import payload itself:
  *"we automatically sample and verify recipient lists imported into the platform to
  assess list quality"* — with the honest caveat that *"list cleaning confirms
  deliverability only and does not establish recipient consent."*
- **Brevo gates by industry and content, not by size** — lead-gen, crypto, gambling,
  dating, loans and several others require vetting by support before any send — and
  applies a recency rule: *"Contact lists that have not been updated in the last two years
  are not considered compliant."*
- **Klaviyo's only hard import limit is a 50 MB CSV**, and — directly relevant to
  [P8](#p8) — ***"List imports do not trigger double opt-in."***

M3AAWG's Vetting BCP supplies the mechanical checks, and they are cheap to automate:

- **Screen the file** for role accounts (`sales@`, `staff@`, `support@`) — *"their
  appearance on a customer list may be indicative of poor acquisition practices"* — and
  for list headers carrying purchase tells such as `jigsaw` or `append`.
- **Require a declared basis per address**, not one checkbox over the file, and keep it:
  every vendor surveyed requires the customer to be able to *produce proof of consent on
  demand*, which is a retention requirement, not a form field.
- **Gate the first send rather than the import** — a bounded send to a random segment,
  measured on bounce rate, bounce-type mix and complaint rate by domain, before unfettered
  provisioning. Note M3AAWG's sizing caveat: *"test sends to fewer than ten thousand
  recipients may not yield statistically significant results"*, which at our volumes means
  the signal will be weak and the gate should lean on prediction rather than measurement.
- **Never accept a bare CSV as consent.** Apple bans purchased, rented and appended lists
  outright; M3AAWG calls appending *"a direct violation of core M3AAWG values"*; and every
  one of the ten vendors surveyed prohibits purchased lists in its acceptable-use policy.

### P5 — No engagement-based sunsetting {#p5}

Unblocked by the same roll-up as [G7](#g7). Three points of calibration, the first two of
which lower this relative to where instinct would put it:

- **Almost no vendor ships automatic, platform-enforced suppression of unengaged
  contacts.** Across the SMB and developer-first products, automatic suppression is
  limited to hard bounces and complaints. **HubSpot is the exception and it is instructive:
  it auto-excludes graymail recipients from marketing sends by default** — reportedly
  those who have not opened the last 11 marketing emails — so the sender does not choose
  it and cannot forget it. That is a platform control wearing a deliverability feature's
  clothes, and it is the direction to copy if we build this.
- **What vendors ship instead is a policy obligation placed on the sender**, which is a
  cheaper instrument and worth copying first: Customer.io *prohibits* mailing anyone who
  has not engaged or been sent mail *"in two years or longer"*; Brevo declares lists not
  updated in two years non-compliant; SendGrid requires fresh affirmative consent after
  *"an extended period of non-engagement"* (deliberately undefined); Apple simply requires
  senders to *"periodically remove inactive subscribers."* A stated rule in our own
  acceptable-use terms costs nothing and precedes any engine.
- **The platform benefit is real** and follows mechanically from Google's denominator:
  spam rate counts mail *"delivered to engaged recipient's Inbox"*, so sunsetting unengaged
  contacts improves the metric Google grades us on independently of any content change.

Sunset on **clicks and site activity, not opens** — Apple's Mail Privacy Protection
inflated network-wide open rates by roughly 15%, and Klaviyo's own guidance is to treat
clicks as the primary engagement metric.

### P6 — No frequency capping {#p6} — ✅ CLOSED

> ✅ **Closed** with [G10](#g10)'s cap half. Customer.io's shape rather than
> Klaviyo's: a refused message is deferred and retried by the sweep that owns
> it, not dropped silently, and `isDeferrableSendResult` is the one place that
> distinction is made. The four uncontrolled paths named in [P1](#p1) are now
> the ones the ceiling governs.

The customer-facing half is [G10](#g10). The platform half is that complaint rate is the
metric a cap protects, and with four uncontrolled paths ([P1](#p1)) there is currently no
ceiling on how much mail one person receives from one site in one day. Customer.io's
model — composable shared and per-channel limits, with a 48-hour retry window that holds
the recipient in the journey rather than dropping them silently — is the better of the two
shipped designs; Klaviyo's Smart Sending drops silently.

### P7 — No new-tenant volume ramp {#p7}

The only ramp control in the product is a single platform-wide `perHour` number a staff
member edits in `staff-email-send-rate-card.component.tsx`. A brand-new, unvetted signup
gets the same 25% share of the platform hour as a customer with a year of clean sending.

The industry pattern is a **sandbox**, and two documented versions bracket the design.
Postmark reviews *"each new account"* manually, typically *"in less than 24 hours on
weekdays"*, and until then an account cannot send *"to any email address outside the
domains you've added to your account and verified."* Amazon SES makes it purely
mechanical and publishes the numbers: **200 messages per 24 hours, 1 message per second,
recipients must be verified addresses or domains**, per region — lifted by a request in
which the customer checks a box agreeing *"to only send email to individuals who've
explicitly requested it"* and confirming a bounce-and-complaint process exists.

The SES shape is the better fit here: it needs no human in the loop, it is a number rather
than a judgment, and the attestation it collects is the same one [P4](#p4) needs anyway.

Public signup opens Sept 1, which makes this the item whose deadline is fixed by something
other than our own planning.

### P8 — No double opt-in {#p8}

Zero occurrences in the tree. Calibration: of ten vendors examined, **none mandates it**.
Mailchimp defaults it off except that EU-based accounts may get it by default;
Customer.io makes it a DIY recipe whose own docs warn *"Customer.io doesn't automatically
check this attribute before sending messages"*; Brevo and Klaviyo offer it per list.

**The one implementation worth copying is ActiveCampaign's**, because it has teeth: forms
default to double opt-in, and unconfirmed subscribers land in a real quarantine —
*"You cannot send any emails to contacts that have this status."* That is the difference
between recording a fact and enforcing it, and it is the same shape as our consent join.

Two details to carry into any design: Klaviyo's **"list imports do not trigger double
opt-in"** is the hole every implementation leaves, and it is exactly where [P4](#p4) and
this item meet. And confirmations need an expiry — Klaviyo's link is valid 72 hours,
Brevo's 30 days.

On the law, be precise. **No jurisdiction verified requires double opt-in by statute.**
They require prior express consent *plus a burden of proof on the sender*: EU ePrivacy
Art. 13(1), German UWG §7(2), Canada's CASL s.13 (*"A person who alleges that they have
consent… has the onus of proving it"*). Germany's certification body says so outright —
*"A DOI is not required by law, neither in the GDPR nor in other laws"* — and then explains
why everyone does it anyway: *"this proof has so far been recognised by the courts
exclusively via a DOI."* **Do not write "German law requires double opt-in" anywhere.**
Write that the law requires provable consent and DOI is the accepted proof.

### P9 — Nothing re-checks a verified sending domain {#p9}

Already documented in `docs/design/email-sending-domains.md`. A customer who removes their
DKIM record months later keeps sending. `verifySendingDomain` is idempotent, never throws,
and already holds the `inconclusive` arm that stops a resolver outage from un-verifying
every customer at once; what is missing is the sweep and the drift discipline
`sso-drift-logic.ts` already implements.

### P10 — The `from` override is still reachable {#p10}

`SendEmailOptions.from` bypasses the configured sender. A resolved identity now outranks
it, so a campaign cannot be moved off a verified domain, but a caller passing `from` with
no identity still wins. Closing it means auditing 39 senders.

### P11 — Bulk and transactional share one domain {#p11}

Open question Q2 in the existing spec, unchanged. One merchant's complaint rate can
hard-fail every customer's password resets under `p=reject`. Splitting costs a warm-up
measured in weeks and must happen before volume, not after.

### Lowest — pre-send content and link scanning

Deliberately ranked last, against instinct. **Almost nobody blocks on it.** Postmark's
SpamAssassin endpoint is free, advisory and explicitly unstable, and operates
independently of their delivery service. No vendor documents refusing a send on a
link-shortener hit. Neither Mailchimp nor Brevo documents a pre-send spam-score checker at
all. The industry does not solve shared-reputation abuse with content scanning; it solves
it with per-tenant authentication and per-tenant accounting, which is [P2](#p2) and the
sending-domain work already in flight.

### 4b. Where we are already ahead on abuse

- **The unsubscribe GET/POST split.** A safe `GET` confirmation page and a mutating
  `POST`, so a mail-client prescanner cannot silently unsubscribe someone. This is a
  correctness property the RFC's design makes easy to get wrong.
- **Resubscribe refuses to reverse a bounce or complaint** — modeled as sender protection
  rather than a user preference, which is the right call.
- **Suppression is an evidence record**, released by a `releasedAt` field rather than a
  delete, so the record proves the suppression was honored.
- **Both suppression lists are consulted through one helper that fails closed on both
  halves**, and the per-site half is a keyed lookup rather than a truncatable scan — the
  earlier version failed *open* on the remainder, meaning the people most certain not to
  want the mail were the ones a short read dropped.
- **The governor cannot refuse transactional mail**, enforced twice independently.
- **Consent basis records whose act it was.** Nothing researched does this.

---

## 5. What NOT to build

### 5.1 A second channel — SMS, push, WhatsApp

Every compared product has at least three channels. That is the reason to decline, not a
reason to follow. A second channel is a second regulated consent regime (TCPA, 10DLC
registration, per-country opt-in rules), a second reputation surface, a second suppression
semantics and a second set of carrier relationships — taken on by a team that has not yet
closed the four uncontrolled email paths in [P1](#p1). Klaviyo prices mobile as a separate
dollar-denominated subscription precisely because it is a separate business. There is no
SMS, push or WhatsApp code anywhere in the tree today; keep it that way until email is
defensible.

### 5.2 A visual node-graph journey canvas

The gap in [G6](#g6) is **the wait step**, not the canvas. A delay and a per-step branch
added to the existing Actions form buys the entire welcome-series, win-back and
post-purchase category. A canvas buys a screenshot.

Salesforce is the cautionary case the existing spec already names: Journey Builder
requires a trained specialist, and a site-builder customer will not learn one to send a
newsletter. HubSpot makes the same point from the other direction — its workflows are
**Professional-tier only, $800/month with a required $3,000 onboarding fee**. That is not
a product an Aglyn customer is cross-shopping.

### 5.3 A third filter language

`contactSegments` (tags + sources) and `DynamicListRule` (nine fields) are already two
overlapping rule shapes. The right move is to converge them — the rule already accepts a
`segmentId` to reuse a saved segment, which is the seam — not to add a third.

### 5.4 Dedicated IPs

Already recorded as out of scope in `docs/design/email-sending-domains.md`, and the
research confirms the reasoning. Klaviyo gates them behind a CSM at consistently
**>1M emails/month** with a **30–40 day** warm-up, and vendors warn they *hurt*
deliverability below that volume. Our entire platform ceiling is 2,000/hour — roughly
1.4M/month across every tenant combined. **There is no tenant who should have one**, and
M3AAWG's own guidance is that domain reputation, not IP reputation, is what separates.

### 5.5 BIMI and VMC

Requires DMARC at enforcement on the organizational domain **and its subdomains**, with
`pct` at 100 — plus a registered trademark for a VMC. Self-asserted BIMI *"has limited
support across the various Mailbox Providers."* Our shared domain already meets the policy
bar, but per-tenant BIMI needs per-tenant subdomains at enforcement first, and the
trademark work is separately phased. This is a reward for tenants who authenticate, not a
platform feature — revisit after [P2](#p2).

### 5.6 Predictive and AI scoring

Klaviyo predicts CLV and churn risk; Brevo computes eight `SCORE_` attributes on its
$499 tier. We do not yet let a merchant filter on the **deterministic** purchase facts we
already store ([G4](#g4)). Predicting a customer's lifetime value before exposing their
actual lifetime value is out of order.

### 5.7 Pre-send spam scoring, inbox-placement testing and seed lists

Ranked last in [§4](#4-security-and-abuse) and repeated here because it is the most
intuitive wrong answer. Almost nobody blocks on content scanning; Postmark's SpamAssassin
endpoint is free, advisory and explicitly unstable; neither Mailchimp nor Brevo documents
a pre-send spam-score checker. Meanwhile the one route that looks like an escape hatch is
closed: Validity **will not certify** ESPs, agencies or third-party mailers. The industry
solves shared-reputation abuse with per-tenant authentication and per-tenant accounting.
So should we.

### 5.8 A prepaid credit ledger

The existing spec's Phase 6 is right and the research does not disturb it. Metered overage
is the house pattern everywhere else in this product, and email is the one meter that has
no rate. Build the rate before inventing a second billing primitive — and see
[§6.2](#62-email-sends-are-metered-and-not-priced).

### 5.9 A `mailto:` unsubscribe fallback

Already a documented refusal in `libs/plugins/email/src/lib/server.ts`: it needs a
monitored mailbox that does not exist, and an unsubscribe request landing in an unread
inbox is worse than no fallback, because the recipient believes they have unsubscribed.
RFC 8058 permits it; nothing requires it. Do not add one without the mailbox.

---

## 6. Decisions that belong to the owner

⚠️ **Pricing is locked for Sept 1 and a charged price may not change.** Each of the
following is recorded as a decision, not a recommendation, and this document stops here.

### 6.1 Every plan's included audience is larger than its monthly send allowance

| Plan | Price /mo | Included contacts | Campaign emails /mo | Sends to the included audience |
| --- | --- | --- | --- | --- |
| free | $0 | 100 | 0 | none |
| starter | $25 ($16 annual) | 1,000 | 500 | 0.5× |
| pro | $56 ($39) | 10,000 | 5,000 | 0.5× |
| business | $139 ($99) | 100,000 | 50,000 | 0.5× |
| scale | $249 ($179) | 500,000 | 100,000 | 0.2× |
| advanced | $399 ($299) | 1,000,000 | 125,000 | 0.125× |
| agency | $799 ($649) | unlimited | 250,000 | — |

A merchant holding exactly the contacts their plan includes **cannot mail them once in a
month** on any plan. Mailchimp sells 10–12× contacts in sends and HubSpot 10–20×; we sell
0.125–0.5×. Two meters have been dimensioned against the platform ceiling and against
plan value independently, and never against each other. **This is a packaging question,
not an engineering one.**

### 6.2 Email sends are metered and not priced {#62-email-sends-are-metered-and-not-priced}

`emailSends` counts every message and the file says *"RECORDED, NOT PRICED"*.
`emailSendsOverage` is computed in `report-usage` and deliberately excluded from
`billedCents`, `costUsd` and `ORG_COGS_UNIT_RATES_USD`. Contacts, storage, API requests
and data all carry a rate; **email is the one significant cost we measure and do not
bill**, which also makes `emailSendsPerMonth` a hard refusal rather than the metered
overage every other limit in the product uses. Pricing it is a six-place move with a
Decision Log entry, and it is either post-lock or a new SKU.

### 6.3 The published pricing table still advertises the old email allowances

**Found while running the repo's own guards, and it is live right now.**
`npm run check:pricing-tables` is **red on `main`**:

```
CODE-vs-FRAME disagreements (the code wins — but say so deliberately)
    Email sends / mo · Advanced: code=125,000  frame=250,000
    Email sends / mo · Agency:   code=250,000  frame=1,000,000
```

Commit `39f979587` lowered the top two allowances to what the platform can actually
deliver and **did not regenerate `tools/marketing/pricing-copy/tables.json`**. So the
marketing pricing copy still offers Advanced **2×** and Agency **4×** the campaign email
the product will now send, ten days before the Sept-1 freeze.

**Deliberately not fixed here.** Regenerating that file changes published pricing copy
downward while pricing is locked, and it is a shared generated artifact — both of which
make it the owner's call and the pricing commit's business, not a research document's.
The regeneration command is printed by the guard itself.

⚠️ Note the direction: this is an **overstatement in our favor to fix**, not an
understatement. A customer who buys Agency today on the published table has been told they
get 1,000,000 campaign emails a month, and the code will refuse them at 250,000.

### 6.4 The Starter asymmetry in [P1](#p1) may be a packaging decision as well as a bug

A $25/month customer is sold 500 campaign emails through the capped path and has an
uncapped one beside it. Closing the compliance half (unsubscribe headers, suppression
filtering) is unambiguously a bug fix and should not wait. **Whether member posts and
restock alerts should then count against an allowance is a packaging decision**, because
it changes what a plan delivers. Recorded, not recommended.

---

## Appendix — what was not verified

**Method.** Competitor facts came from live fetches of vendor documentation on
2026-08-30. Anything below was either not reachable or is contested between sources, and
**should not be asserted without a fresh check.**

- **Salesforce deliverability and consent specifics.** Editions, pricing and the full
  feature-gating matrix **were** verified (from the vendor's own data payload, since
  `salesforce.com` returns 403 to ordinary fetching). What was **not** reached: whether
  MCAE mandates DMARC, whether it permits a vendor-shared sending domain at all, whether
  it emits the RFC 8058 `List-Unsubscribe-Post` header, its published complaint-rate
  thresholds, its Email Preference Center mechanics and whether it supports opt-down,
  native double opt-in, and the consent audit trail.
- **HubSpot residual gaps.** Verified live: pricing, contact ladders, segment semantics and
  filter caps, the Professional-tier workflow gate, the Enterprise-only frequency
  safeguard, the published 5% / 0.1% / 3% thresholds and the probation ladder, and the
  `hs-domain.com` shared-domain fallback. **Not** verified: whether HubSpot actually emits
  the RFC 8058 `List-Unsubscribe-Post` header (its docs describe only the rendered link),
  whether the consent History tab records source and timestamp, its soft-bounce
  suppression threshold, and the exact graymail window — the "last 11 marketing emails"
  figure comes from a page that now 404s, so treat the *mechanism* as verified and the
  *number* as not.
- **Two claims in this document rest on secondary corroboration**, flagged here rather
  than in the body: HubSpot's frequency-capping behavior beyond its tier gate, and
  Klaviyo's Smart Sending defaults.
- **Microsoft's own enforcement wording.** Whether unauthenticated bulk mail to
  Outlook/Hotmail/Live was junk-foldered from 2025-05-05 with rejection later, or rejected
  outright, is contested between three reputable secondaries; Microsoft's own post would
  not render. Observed 2026 behavior is rejection via `550 5.7.515`. **Plan for rejection;
  do not cite a phase date in a design doc.**
- **Google's November 2025 hard-enforcement date.** The escalation language and the SMTP
  error codes are on Google's own FAQ; the November date is vendor-reported.
- **Whether Gmail separates subdomain reputation from the parent.** Google is explicitly
  silent. Subdomains give verified per-tenant *attribution*; reputation isolation is an
  assumption, and [§4](#4-security-and-abuse) says so wherever it matters.
- **A contradiction in the research itself.** The deliverability sweep reported vendor
  threshold numbers, then filed a correction stating those sub-sweeps had not returned,
  then filed a third report with them verified and sourced. **Only figures that survived
  independent corroboration or arrived with a working primary URL are stated here** —
  Resend, Customer.io, Omnisend, Brevo and Validity. Numbers attributed to Klaviyo's own
  enforcement were dropped: Klaviyo publishes no threshold of its own, and the "0.05%"
  figure that circulates is Klaviyo *describing the mailbox providers' line*, not its own.
- **Measured deliverability impact of double opt-in.** No controlled study exists that
  could be verified. The frequently-cited "Mailchimp 30,000-user study" is not on any live
  Mailchimp page. Do not quote a number.
- **Mailchimp specifics** not confirmed: template library size, reusable content blocks,
  automatic plain-text generation, click maps, per-link stats, and whether multivariate
  testing is Standard or Premium — Mailchimp's own help center and pricing page contradict
  each other on the last one.
- **Vendor content-scanning and rate-limit specifics** beyond those named: attachment
  policies, link-shortener bans, URL blocklist integrations, and current SES sandbox
  numbers. SES sandbox limits in particular change; verify before designing against them.
- **Aglyn's own RFC 8058 `h=` coverage** — [P3](#p3) is a verification item, not a
  finding. Nothing in this document asserts that our one-click unsubscribe does or does
  not work; it asserts that we have not checked, and that the check costs one send.

> ⚠️ **One safety note.** Every `docs.aws.amazon.com/ses/*` page fetched during this
> research carried an appended block instructing the reader to run an
> `aws agent-toolkit search-skills` command. That is instruction-shaped text inside
> fetched web content, not a request from anyone here. **It was not run**, and it is worth
> knowing that any future agent fetching AWS SES documentation will encounter it.

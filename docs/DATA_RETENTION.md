<!--
 Copyright 2026 Aglyn LLC — Apache-2.0
-->

# Data retention schedule (AGL-1915)

What Aglyn keeps, for how long, and why — reconciled against what the
**published** Privacy Policy and DPA actually say. Every period below is either
enforced by a mechanism named in the Evidence column or is explicitly marked as
having no mechanism.

Companions: `docs/PRIVACY_REQUESTS.md` (how a person exercises a right),
`docs/BREACH_NOTIFICATION.md`, `docs/DISASTER_RECOVERY.md`,
`docs/STORAGE_MANUAL_CONFIG.md`, `docs/FIRESTORE_MANUAL_CONFIG.md`.

## Read this before you edit anything here

**The published page is the authority; this file is the reconciliation.** The
legal text is besigner content on `aglyn.com/legal/*`, published first and
re-captured into `apps/console/constants/legal/{version}/*.txt` afterwards
(`apps/console/constants/legal-documents.ts` explains why that ordering is not
a preference). The DPA, Cookie Policy and Subprocessors list have **no repo
copy at all** — the live page is their only authority.

So a divergence between this file and a published page is never resolved by
editing this file to match. It is resolved by deciding which one is wrong,
fixing that one, and — if it is the page — publishing before re-capturing.

**Two structural hazards shape everything below.** Both are properties of the
database, not of any one feature:

1. **A path-scoped cascade is blind to a field-keyed collection.** `eraseOrg`
   finishes with `recursiveDelete(orgRef)`, which reaches everything under
   `orgs/{orgId}/…` and nothing else. A top-level collection whose documents
   merely *carry* `orgId` — `apiKeys`, `ssoDomains`, `consoleDomains`,
   `apiIdempotency`, `stripeCustomers`, `orgSlugs` — is structurally invisible
   to it and needs its own bounded sweep
   (`libs/tenant/data/admin/src/lib/server/erase.ts:163`, AGL-1444/AGL-1448).
   **The same blind spot applies to an access request**, which is the part
   nobody expects: an enumeration built by walking `orgs/{orgId}` and
   `users/{uid}` answers a "what do you hold about me" question with the same
   omissions a deletion would have. `docs/PRIVACY_REQUESTS.md` §"Where to look"
   is the checklist that closes it.
2. **Some data is deliberately not deleted.** Tax records and the do-not-contact
   list are retained *because* a law requires it, and an over-eager future sweep
   would un-file a tax period or resurrect a number someone asked us to stop
   calling. Those are listed under "Deliberately retained" with the specs that
   pin them.

## Firestore

Sorted by whether a mechanism enforces the period.

### Enforced by a live TTL policy

Verified against `gcloud firestore fields ttls list --project=aglyn-main
--database='(default)'` on 2026-08-18 — all five `ACTIVE`.

| Collection group | Field | Period | Contents | Evidence |
| --- | --- | --- | --- | --- |
| `analytics` | `expiresAt` | **400 days** | Per-day pageview/serve/redirect counters on hosts and orgs. Counts, not identities. | `analytics-retention.ts:58` (AGL-1844) |
| `screenAnalytics` | `expiresAt` | **400 days** | Same, per screen. | same |
| `mediaTombstones` | `expiresAt` | **7 days** | DAM undo records. Each holds a deleted media document **verbatim** — alt text, tags, custom metadata, `visibleTo` scope tokens. Bounded to the bucket's 7-day soft-delete window because a tombstone that outlives the bytes it addresses can only produce a failed restore while still being a copy of customer data. | `media-tombstone.ts:93` (AGL-1467) |
| `cspViolationDaily` | `expiresAt` | **60 days** | CSP violation counters — one doc per (day × app × directive × disposition × blocked origin). Never report bodies. | `csp-aggregate.ts:101` (AGL-1799) |
| `rateLimits` | `expiresAt` | window-scoped; degradation markers **30 days**, signup refusals **7 days** | IP-keyed counters and refusal markers. | `rate-limit-store.ts:84,257` |

`docs/FIRESTORE_MANUAL_CONFIG.md` lists three of these five. `analytics` and
`screenAnalytics` are live and undocumented there, and the `cspViolationDaily`
row still reads "TTL not yet enabled in gcloud as of 2026-08-17" — it is
enabled. Corrected in that file with this change.

### Enforced by a scheduled job

| Data | Period | Mechanism | Evidence |
| --- | --- | --- | --- |
| `adminAudit` | **90 days hot, then 365 days archived** — ~15 months end to end | `/api/admin/audit-archive`, daily 03:00 UTC, moves rows to `adminAudit-archive/{yyyy-MM}/*.jsonl` in the media bucket and deletes them from Firestore. The bucket's lifecycle rule then deletes at age 365. | `audit-archive/route.ts:24`, `cloud/media-bucket-lifecycle.json` |
| Org erasure | **7-day reversible hold**, then permanent | `erasureRequestedAt` + `ERASURE_HOLD_MS`; `/api/admin/run-erasures` daily 04:00 UTC. The hold is re-verified inside `eraseOrg` — the cron cannot skip it and neither can the manual script. | `erase.ts:32,659` (AGL-485) |

### Retained for the life of the workspace, then erased by the cascade

Everything under `orgs/{orgId}/…` and `hosts/{hostId}/…`: screens, layouts,
components, versions, datasets and records, contacts and lists, media
documents, forms and submissions, orders, webhooks, invites, members, roles,
usage and apiUsage rollups, installs, activity, `pluginSettings`, and the
churn-funnel `retention` subcollection. No per-collection period; they live as
long as the workspace does and die with `recursiveDelete(orgRef)`.

The same is true of everything under `users/{uid}/…` — profile, org
memberships, host memberships, notifications, passkeys, `legalAcceptances` —
which `eraseUser` removes with `recursiveDelete(userRef)`
(`erase.ts:938`, AGL-1140).

**Aglyn Assist writes three subcollections and all three are under the org**,
so the cascade reaches them with no extra sweep:
`orgs/{orgId}/assistExchanges/{id}`, `orgs/{orgId}/assistUsage/{month}`,
`orgs/{orgId}/counters/assistMessagesDaily`. Pinned by
`apps/console/specs/assist-anthropic-subprocessor-gate.spec.ts` §"assist
records stay reachable by eraseOrg", which asserts both halves — that every
written path starts `orgs/{orgId}/`, *and* that `erase.ts` still contains
`recursiveDelete(orgRef)`, because the first assertion is decorative without
the second. **Reachable is not the same as bounded** — see the defects below.

### Top-level collections the cascade cannot see

Field-keyed or id-keyed, so `recursiveDelete` never reaches them. Each either
has a sweep in `eraseOrg` or is a defect.

| Collection | Swept? | Contents |
| --- | --- | --- |
| `apiKeys` | yes (AGL-1444) | SHA-256 of the token, label, creating uid, scopes |
| `ssoDomains` | yes (AGL-1448) | domain, GCIP tenant/provider ids, IdP name |
| `consoleDomains` | yes (AGL-1448) | custom console domain claims |
| `apiIdempotency` | yes (AGL-1448) | replay keys — no TTL, see defect 9 |
| `stripeCustomers` | yes (AGL-1448) | billing-identity → workspace correlation |
| `orgSlugs` | yes (AGL-1448) | current slug **and every rename tombstone** |
| `hostIndex` | yes, via `eraseHost` | subdomain/cname routing |
| `platformRevenue`, `storefrontTaxCollected` | **never, deliberately** | tax records — see below |
| `contactSuppressions` | **never, deliberately** | do-not-contact list — see below |
| **`supportTickets` + `messages`** | **NO — defect 3** | subject, body (≤5000 chars), `authorEmail` |
| `profiles/{uid}` | yes (AGL-1970), by `eraseUser` | handle, display name, `stripeAccountId` |
| `publisherHandles` | yes (AGL-1970) | handle reservations **and every rename tombstone** |
| `publisherProfiles` | yes (AGL-1970) — deleted, or reduced to a content-free tombstone | handle, display name, `stripeAccountId`, `publisherAgreement` |
| `adminAudit` | n/a — it *is* the erasure record | ids and counts; some rows carry `email` |

`marketplaceListings`, `marketplacePurchases`, `marketplaceReports` and
`revocations` also outlive an erasure. That is AGL-1448's parked Tier 3 product
decision — an erased org's listing is something buyers paid for — and it is a
decision, not an oversight. It still needs making.

**AGL-1970 made that decision cost something measurable rather than making it.**
`eraseOrg` now reports `listingsRetained` — how many listings still name the
erased org — in its result and in the `org.erased` audit row, so an erasure that
leaves something standing says so instead of reporting a clean success. It also
decides the one case that could not wait: an org with a surviving listing keeps
a `publisherProfiles/{orgId}` document, but only as `{ erased: true, erasedAt }`.
No handle, no display name, no `publisherAgreement`, and **no
`stripeAccountId`** — the tombstone is "an internal record that the erasure
happened", which is precisely what Privacy Policy §5 reserves, and it carries no
byte that sentence calls content. An org with no surviving listing keeps nothing
at all. Both branches, and the emptiness of the tombstone, are pinned by
`erase-publisher-identity.emulator.spec.ts`.

### Deliberately retained past erasure

| Collection | Why | Pinned by |
| --- | --- | --- |
| `platformRevenue` | Per-transaction **tax filing records** (gross, tax, jurisdiction); the quarterly Texas return is their sum. GDPR Art. 17(3)(b) exempts records kept to comply with a legal obligation. Texas requires four years. It is org-keyed **by field** — exactly the shape `deleteDocsByOrgId` eats — which is the trap. | `erase-org-tax-retention.emulator.spec.ts`; the `$never` note at `erase.ts:188` (AGL-1811) |
| `storefrontTaxCollected` | Same shape, same reason: sales tax charged to shoppers on an org's storefront, including tax a `mode: 'stripe'` store collects under Aglyn's own Texas registration. | `erase.ts:199` (AGL-1904) |
| `contactSuppressions` | A do-not-contact record must **keep** the identifier in order to recognise it and avoid contacting it again. Privacy Policy §11 states this in terms: "we will delete it from your account and keep it only on a limited internal do-not-contact list, used for nothing else". | `contact-suppression.ts` (AGL-1592) |

These three are the only intended survivors. Everything else that survives an
erasure today is a defect, and they are listed below.

## Storage (`gs://aglyn-main.appspot.com`)

Verified live 2026-08-18:
`gcloud storage buckets describe … --format='value(lifecycle_config,soft_delete_policy)'`.

| Prefix | Period | Note |
| --- | --- | --- |
| `orgs/`, `hosts/`, `users/` | life of the workspace/account | **No lifecycle rule may ever name these.** Lifecycle matches on age with no view of Firestore, so an age rule here would delete the bytes behind media documents that still exist. `apps/console/specs/media-bucket-lifecycle.spec.ts` fails the build if one appears. |
| `adminAudit-archive/` | **365 days** | Applied and live. |
| `erasures/` | **30 days** | A backstop. Nothing has written this prefix since AGL-1443 and zero objects were ever created in production; the rule exists so a revert or a future writer cannot silently recreate an unbounded prefix. |
| `marketplaceListings/{id}/preview` | none, deliberately | The live preview image of a published listing. An age rule would 404 the browse card of a listing still for sale. |
| **Soft delete (whole bucket)** | **7 days** | `retentionDurationSeconds: 604800`. Nothing here frees bytes or removes an object for a week after its rule fires — true of a manual delete too. |

`docs/STORAGE_MANUAL_CONFIG.md` said the lifecycle policy was "NOT YET APPLIED";
AGL-1496 applied it on 2026-08-13 and the read-back above confirms both rules
are live. Corrected in that file with this change.

## Backups and residual copies

These are the copies a deletion does **not** immediately reach, and the DPA
commits to their behaviour, so they belong in a retention schedule rather than
only in `DISASTER_RECOVERY.md`. Verified live 2026-08-18.

| Copy | Configured | Actually restorable | Evidence |
| --- | --- | --- | --- |
| Point-in-time recovery | 7 days (`versionRetentionPeriod: 604800s`) | 7 days | `gcloud firestore databases describe` |
| Managed weekly backup | **98 days** (14 weeks, `8467200s`) | **effectively ≤ 7 days** — every backup this project has taken flips `READY` → `NOT_AVAILABLE` at ~day 7 with `expireTime` months out (AGL-1843) | `gcloud firestore backups schedules list`; `DISASTER_RECOVERY.md` |
| Independent GCS export | 90-day bucket lifecycle, weekly Mondays 05:00 UTC | 90 days | `gs://aglyn-main-firestore-exports` (AGL-1843) |
| Storage soft delete | 7 days | 7 days | bucket `soft_delete_policy` |

The published claim is that residual copies persist "for up to that period" —
14 weeks — which is the **outer bound of retention**, and every mechanism above
sits inside it (98 ≥ 90 ≥ 7). The claim is therefore correct as a privacy
statement. It is wrong as a *recoverability* statement, and that direction is
`DISASTER_RECOVERY.md`'s problem, not this file's.

**One DPA promise here has no mechanism.** Live DPA §11: *"a deletion
instruction survives any restoration — data deleted at Customer's instruction
and later restored from a backup will be deleted again."* Nothing in
`DISASTER_RECOVERY.md` Procedures A–D re-applies erasures after a restore, and
nothing enumerates which erasures fall inside a restored snapshot's window. The
`adminAudit` `org.erased` rows are the only record, and they are 90 days hot —
long enough to cover the 7-day PITR window and the ≤7-day usable backup, and
**not** long enough to cover a 90-day-old GCS export. Worse: **import is
merge-by-id, not replace** (`DISASTER_RECOVERY.md` Procedures C and D), so
importing an old export into `(default)` silently resurrects every document an
erasure deleted. Filed as **AGL-1975**;
`docs/BREACH_NOTIFICATION.md` §"After any restore" carries the interim manual
step.

## Third parties

| Provider | What they hold | Period | Source |
| --- | --- | --- | --- |
| Google Analytics (GA4) | Product/site analytics for `aglyn.com`, the console and the docs site. Signals off, ads personalization disabled, email redaction on. | **14 months** | Published Privacy Policy §3 — the only third-party number we publish |
| Stripe | Customer record, payment methods, charges. Aglyn never receives a card number. | Stripe's own schedule; the customer object is deleted on erasure (`deleteStripeCustomer`, `erase.ts:130`) | |
| Anthropic | Assist prompt inputs and site content sent for generation. | Provider's own; **we publish no number** | DPA §7.1 names them; the subprocessors row is being published under AGL-1909 |
| Google Cloud / Firebase, Vercel, Resend | Hosting, datastore, auth, storage, email delivery. | Provider's own | Published subprocessors list |

## Where this diverges from what is published

Each of these is a defect, not a note. Filed rather than narrated.

| # | Divergence | Filed |
| --- | --- | --- |
| 1 | ~~**`profiles/{uid}` survives `eraseUser`.**~~ **CLOSED 2026-08-18.** `eraseUser` now `recursiveDelete`s `profiles/{uid}` before the auth record and reports `deleted.profile` in the audit row. | **AGL-1970** |
| 2 | ~~**`publisherProfiles/{orgId}` and `publisherHandles/{handle}` survive `eraseOrg`.**~~ **CLOSED 2026-08-18.** Handles — live reservation and rename tombstones alike — are swept by `orgId` field; the profile is deleted, or reduced to a content-free `{ erased: true }` tombstone when a listing outlives it. Both pinned by `erase-publisher-identity.emulator.spec.ts`, whose negative control proves a bystander publisher's profile, handle and payout id are untouched. | **AGL-1970** |
| 3 | **`supportTickets` survives both erasures.** Top-level, `orgId` as a field, with a `messages` subcollection carrying `authorEmail` and up to 5000 characters of customer prose. `grep -c supportTickets erase.ts` returns `0`. The highest-PII-density collection outside the org tree is the one with no sweep. | **AGL-1971** |
| 4 | **Assist Q&A has no retention period at all.** `orgs/{orgId}/assistExchanges/{id}` stores the user's `question` and the model's `answer` **verbatim** plus the asking `uid`, with no `expiresAt`, no TTL and no prune. It is reachable by the cascade, so an erasure clears it — but until the org is erased it is kept forever, and Assist is gated on a privacy-policy disclosure for exactly this data (`release_assist`, AGL-1909). A disclosure that states a period we do not enforce is worse than the gap. | **AGL-1972** |
| 5 | **`privacy@aglyn.com` may not exist.** It is the intake address in Privacy Policy §7, §9, §11 and §13 and the data-importer contact in DPA Annex A. The Drive open-items list records that only `noreply@` and `info@` were live at drafting; `security@`, `legal@`, `abuse@` and `dmca@` are in the same unconfirmed state and each is load-bearing in a published document. | **AGL-1973** |
| 6 | **No personal-data export exists.** The Privacy Policy grants a portability right (§7, GDPR Art. 20) and there is no "download my data" path for a person or an org. Site export is Pro+ and deliberately excludes PII. A DSAR access request is answered by hand today. | **AGL-1974** |
| 7 | **No deletion-instruction replay after a restore**, and **DPA §7.2's subprocessor change-notification mechanism does not exist**. Both are published DPA commitments with nothing behind them. | **AGL-1975** |
| 8 | **Staff user erasure has no button.** `eraseUser` is reachable only by hand-crafting `POST /api/admin/users/manage {action:'erase'}` with a super-staff token — and `erase-org-cli.mjs:117` points operators at a "staff console → Users → Erase" button that does not exist. | **AGL-1977** |
| 9 | `apiIdempotency` has no TTL and is reaped only by an erasure, so replay keys accumulate against a live org indefinitely. Low severity (a replay key names an org and a record id and authorises nothing) but it is retention without a period. | **AGL-1978** |
| 10 | `orgs/{orgId}/retention` — the churn survey — stores up to 500 characters of free text with no period. Org-scoped, so the cascade takes it; noted because a free-text field is where a person types something we did not ask for. | **AGL-1978** |
| 11 | `/PRIVACY_POLICY.md` at the repo root is a 2021-dated stub that names `privacy@aglyn.com` and nothing else. It is not the published policy, is not referenced by anything, and is exactly the sort of file a reader trusts. | **AGL-1978** |

## Reviewing this document

Re-run the reconciliation whenever a legal page is published — the check is
cheap and the drift is silent. The three commands that produce every live
number in this file:

```bash
gcloud firestore fields ttls list --project=aglyn-main --database='(default)'
gcloud firestore databases describe --database='(default)' --project=aglyn-main \
  --format="value(pointInTimeRecoveryEnablement,versionRetentionPeriod)"
gcloud storage buckets describe gs://aglyn-main.appspot.com --project=aglyn-main \
  --format="value(lifecycle_config,soft_delete_policy)"
```

Last reconciled **2026-08-18** against Privacy Policy **v4** and the live DPA
(`dpaV2-20260813`). **Terms v5, a privacy update, new subprocessor rows and an
Aglyn Assist retention disclosure were publishing on the same day** — every row
above must be re-read against the published v5 text before it is quoted to a
customer.

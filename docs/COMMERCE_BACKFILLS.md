# Commerce backfills (AGL-1727 / 1745 / 1752 / 1753 / 1821)

Five historical-data gaps in commerce money records, each filed as a "backfill
decision" issue because rewriting merchant-facing financial history is Zach's
call, not an agent's. Zach authorised all five on **2026-08-20**.

**Nothing here has been applied to production.** Every script dry runs by
default; the apply gate is double-keyed and deliberately awkward.

## The scripts

| Issue | Script | Repairs |
| --- | --- | --- |
| AGL-1727 | `tools/scripts/backfills/backfill-agl1727-buy-now-orders.mjs` | Pre-AGL-1711 buy-now orders: `quantity: 1`, tax folded into the unit price, `taxCents`/`discountCents` 0 |
| AGL-1745 | `tools/scripts/backfills/backfill-agl1745-subscription-sales.mjs` | Pre-AGL-1732 subscription sales with no `lineItems` / `totals` / `interval` |
| AGL-1752 | `tools/scripts/backfills/backfill-agl1752-subscription-invoices.mjs` | Pre-AGL-1743 renewals, recorded nowhere: creates the invoice ledger and the subscription roll-up |
| AGL-1753 | `tools/scripts/backfills/backfill-agl1753-contact-ltv.mjs` | Pre-AGL-1748/1755 contacts: `ltvCents` understated, some buyers missing entirely |
| AGL-1821 | *(no script — see below)* | Subscriptions renewing untaxed |

Shared pieces: `lib/backfill-core.mjs` (pure transforms + the plan executor),
`lib/backfill-io.mjs` (arg gating, admin bootstrap, **read-only** Stripe),
`lib/backfill-core.test.mjs` (`npm run test:backfill-core`).

## Running them

Dry run — the default, writes nothing, prints every planned change:

```sh
FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
STRIPE_SECRET_KEY=sk_live_… \
  node tools/scripts/backfills/backfill-agl1727-buy-now-orders.mjs
```

Apply — requires **both** flags. `--apply` alone stays in dry run, loudly:

```sh
  … node tools/scripts/backfills/backfill-agl1727-buy-now-orders.mjs \
      --apply --yes-i-mean-production
```

Other flags: `--host <hostId>` scopes to one host; `--create-missing`
(AGL-1753 only) opts into creating contacts for buyers who have none.

### Order matters

Run **1745 → 1752 → 1753**. AGL-1745 gives a subscription its opening amount;
AGL-1752 needs that for a richer line-item snapshot and builds the invoice
ledger; AGL-1753 reads orders ∪ subscriptions ∪ invoices, so it under-counts
every subscriber if the first two have not run. Each script says so in its
output when it detects the dependency. AGL-1727 is independent.

## The safety properties, and why they hold

**Dry run is the default.** `parseBackfillArgs` only sets `apply` when
`--apply` *and* `--yes-i-mean-production` are both present.

**Stripe access is structurally read-only.** `stripeGet` hardcodes
`method: 'GET'` and never sends a body. The localhost/production key is
`sk_live`, so this is a structural guarantee rather than a matter of
discipline.

**Writes are `update()`/`create()` only — never `set({ merge: true })`.**
`applyPlan` refuses any other op type. This is what makes a phantom document
impossible: `update()` fails NOT_FOUND on a missing doc, `create()` fails
ALREADY_EXISTS on a live one.

**No converter can corrupt these writes.** None of the four target
collections (`hosts/{h}/orders`, `hosts/{h}/subscriptions`, its `invoices`
subcollection, `orgs/{orgId}/contacts`) has a `withConverter` attached —
repo-wide, converters exist only on CMS/layout data. `applyPlan` also uses
bare `db.doc(path)` refs, so no converter runs even if one is added later.
The hazard a converter would pose (a `toFirestore` that defaults a field
destroying the real value under a partial write) therefore does not apply.

**Idempotent by re-derivation, not by a flag.** Each script re-computes the
correct value and writes only if it differs from what is stored, so a second
run plans zero operations. `ltvCents` is a `FieldValue.increment` on the live
path; the backfill **SETs** it, which is the whole reason a re-run cannot
compound. Proven by four `idempotence …` tests that apply a plan against the
Firestore double and then re-plan *from the mutated document*.

**Every rewritten document is stamped**, so a later reader can tell a
reconstructed value from a measured one:

| Document | Marker |
| --- | --- |
| `hosts/{h}/orders/{id}` | `backfills.agl1727AtMs` |
| `hosts/{h}/subscriptions/{id}` | `backfills.agl1745AtMs` |
| `…/subscriptions/{id}/invoices/{id}` | `backfilledAtMs` |
| `orgs/{orgId}/contacts/{id}` | `backfills.agl1753AtMs` |

**Nothing un-reconstructable is silently defaulted.** A missing coupon, an
absent session, an anonymous POS sale and a subscription with no opening
amount are all *reported* in a "manual review / cannot reconstruct" block and
excluded from the plan. No constant is written where a measured value belongs.

**Test-mode sales are excluded** by AGL-1727/1745/1752 (a `cs_test_…` id, or
a subscription id that 404s under the live key). **AGL-1753 does not filter
test mode** — see the caveat below.

**The live path is never reused, so no notification is re-sent.** The scripts
write documents directly; a backfill that called the webhook handlers would
deliver a year of "Subscription renewed" notifications at once.

## Production dry run — 2026-08-20

Against `aglyn-main`, live Stripe key, read-only:

| Issue | Scanned | Would write |
| --- | --- | --- |
| AGL-1727 | 6 hosts, 1 order (1 test-mode) | **0** |
| AGL-1745 | 6 hosts, 1 subscription (1 test-mode) | **0** |
| AGL-1752 | 6 hosts, 1 subscription, 0 paid invoices on Stripe | **0** |
| AGL-1753 | 5 orgs, 6 hosts, 1 distinct buyer | **1** (an e2e fixture) |
| AGL-1821 | 2 live subscriptions, 0 `commerce-subscription` | **0** |

The live Stripe account has **four balance transactions in its lifetime** and
one real payment ever ($25.00 on 2026-07-18, Aglyn's own platform billing),
zero connected accounts and zero transfers. That ledger is independent of any
metadata filter, so the zeros above are corroborated rather than merely
reported. Commerce has taken no real customer money yet.

### Caveat on the one planned write

AGL-1753 would update `e2e-member-1@example.com` in org `hz_KgetqSq`: set
`firstPurchaseAtMs` (absent — the AGL-1838 anchor bug) and move
`lastPurchaseAtMs` back 899 ms, from the write-time clock to the order's own
`paidAt`. `ltvCents` and `ordersCount` already match and are not rewritten.

That $18.00 came from a **test-mode** checkout session. AGL-1727/1745/1752
exclude test-mode sales; AGL-1753 does not, because it aggregates Firestore
order documents and the live contact writer counted that order too. Excluding
it would make the backfill disagree with the live path permanently — so the
inconsistency is recorded here rather than papered over. It is moot today:
the only affected row is an e2e fixture, not a customer.

## AGL-1821 — no repair script, deliberately

AGL-1821 is not a records repair. Subscriptions sold by a manual-tax merchant
before AGL-1751 carry no tax rate on the Stripe subscription item, so every
renewal bills untaxed. Fixing it means attaching a tax rate to a **live**
Stripe subscription — a mutation that raises what a real customer is charged
on their next invoice. The renewal *records* are honest: those invoices
genuinely collected no tax.

**The population is zero, and it is closed.** `audit-money-back-book.mjs`
(read-only, AGL-2323) reports 0 untaxed `commerce-subscription` rows, and the
balance ledger corroborates it. AGL-1751 shipped in `77a88bfe0` and is on
`origin/production`, so no new untaxed subscription can be created. The count
can only shrink.

Building a tool whose only function is to raise live customer charges, for a
population that is empty and can never grow, is a standing hazard with no
upside — so none was built. Re-run the audit before launch to confirm the zero
still holds:

```sh
STRIPE_SECRET_KEY=sk_live_… node tools/scripts/audit-money-back-book.mjs
```

If it ever returns non-zero, the repair is a Stripe `POST` to
`subscription_items` and needs its own decision about notifying the customer.

## Consequences these backfills do NOT fix

- **Inventory drift** (AGL-1727): the same hardcoded `1` under-decremented
  stock, so a host that sold multi-unit buy-now orders has counts that are too
  high and silently oversellable. The script *reports* the drift per order and
  writes nothing — that reconciliation is a separate decision.
- **Dropship supplier notices** (AGL-1727): already sent, telling suppliers to
  ship one unit. Outbound and unrewritable.
- **Refund netting** (AGL-1754): `ltvCents` is gross by definition; AGL-1753
  writes `refundedCents` beside it, never netted into it.

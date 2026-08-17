# Demo sample data

Two scripts, sharing one fixture engine (`tools/scripts/lib/seed-demo.mjs`)
and one set of brand packs (`tools/scripts/lib/demo-brands.mjs`):

| Script | Seeds |
| --- | --- |
| `seed-demo-host.mjs` | **one** host, with the brand pack you name |
| `seed-demo-org.mjs` | **one org, several hosts**, one brand each — the multi-site demo |

Together they populate every console/besigner/host/org feature, so demos,
screenshots and onboarding start populated instead of empty (AGL-144,
AGL-377, AGL-1734).

## The multi-site demo org (AGL-1734)

The founding demo (`Design-Partner-Outreach.md` §4) spends minutes 3–10 —
its largest block — on *"switch between several sites in one org;
roles/permissions; one billing view"*. That is the wedge, so the demo org
has to be several visibly different businesses, not one site cloned.

```bash
# Local emulator — creates the org, its owner, and all four sites.
FIRESTORE_EMULATOR_HOST=localhost:8082 \
FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
  node tools/scripts/seed-demo-org.mjs
```

Four sites under one org, one pack each: **Northgate Dental**, **Harborline
Law**, **Casa Verde Cantina**, **Ironleaf Strength**. Sign in as
`demo@aglyn.test` / `Demo-Password-1` (override with `DEMO_PASSWORD`).

Against a **real project** the script never creates the organization —
an org carries billing identity and a Stripe customer, and minting one from
a seeder is a decision, not a fixture. Point it at an org that already
exists, and pass `--create-hosts` deliberately:

```bash
FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
  node tools/scripts/seed-demo-org.mjs --org <orgId|orgSlug> --create-hosts
```

`--create-hosts` is opt-in because a direct host write skips
`/api/hosts/create`, and with it the plan's **site quota** and the
subdomain reservation the console performs. The conservative path is to
create the sites in the console and seed each one individually.

Other flags: `--brands a,b,c` (which packs, one host each), `--dry-run`
(print the plan, change nothing), `--reset` (prune every seeded host).

## One host

```bash
FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
  node tools/scripts/seed-demo-host.mjs --host demo --brand bakery
```

`--host` accepts a host **id** or **subdomain** (defaults to `demo`).
`--brand` defaults to `bakery`, so an unflagged run seeds what this script
always seeded. `--list-brands` prints the packs, `--reset` deletes this
host's fixtures, `--no-prune` merges instead of replacing. Credentials are
optional when `FIRESTORE_EMULATOR_HOST` is set.

## Brand packs

A pack is not a string table. Three sites that differ only in colour still
read as one template, so a pack also decides **which modules exist at all**.

| module | bakery | dental | legal | restaurant | fitness |
| --- | :-: | :-: | :-: | :-: | :-: |
| commerce | ✓ | — | — | ✓ | ✓ |
| bookable services | ✓ | ✓ | — | — | ✓ |
| reservations | — | — | — | ✓ | — |
| site members | ✓ | — | ✓ | — | ✓ |
| overlays | bar | bar | — | bar + popup | popup |
| experiments | ✓ | — | — | ✓ | ✓ |
| locations | 1 | 0 | 0 | **2** | 1 |
| home sections | 2 | 3 | 3 | 3 | 3 |

Each pack also carries its own `theme` (palette, Google font, border
radius) and a home screen composed from a different set of section
builders — so the four sites differ in layout, not only in words. An empty
Products list on the law firm next to a full one on the cantina is
deliberate: it is what proves the switcher is crossing between businesses.

To add a pack, add an entry to `BRANDS` in
`tools/scripts/lib/demo-brands.mjs`. The engine skips any module the pack
leaves `null` or empty, so a partial pack is valid.

## What gets seeded

| Area | Fixtures |
| --- | --- |
| Identity | `displayName`, host `theme`, `seo.favicon` |
| Home | a published screen at `/`, plus the host routing-map entry |
| Logic | variables, a function, a workflow, an action |
| Content | a content collection with entries, media docs, bookable services |
| CRM | leads, site members |
| Commerce | products with variants, category, manual collection, locations, a paid order |
| Promotions | automatic discount, coupon, gift card, an approved review |
| Reservations | bookable units + confirmed reservations |
| Marketing | a sent campaign, a **designed email** template (email-kind screen), overlays, an A/B experiment |
| Redirects | exact, prefix, and regex rules |
| Org data (AGL-240) | contacts, a segment, a list, a dataset — written to `orgs/{orgId}/…`, namespaced per host |
| Team | a per-site `orgs/{orgId}/invites` row scoped with `hostAccess` |
| Marketplace | one published listing (platform-global) |

## Idempotency and reset

Every fixture has a deterministic `seed-…` doc id, **and every run deletes
the previous `seed-…` documents before writing**. The delete is what makes
a *brand change* converge: merge-set alone would leave the old brand's
products and posts sitting beside the new ones, so the second run of a live
demo would not look like the first.

The prune is prefix-scoped — it only touches ids starting with `seed-`, so
pointing it at a host that also holds real content cannot delete that
content. Org-scoped rows are reclaimed by their `seedHostId` field instead,
because those collections are shared between the org's sites.

Reset without re-seeding:

```bash
node tools/scripts/seed-demo-host.mjs --host <sub> --reset
node tools/scripts/seed-demo-org.mjs --org <orgId|slug> --reset
```

## Notes

- Org-scoped collections resolve the owning org from the host doc's `orgId`
  and fall back to the host path for pre-migration hosts.
- Products carry both structured `variants` and the flat legacy
  `priceUsd`/`inventory`/`imageUrl` fields, so they render everywhere
  without a lift step.
- The team fixture is an **invite**, not a member. `orgs/{orgId}/members`
  is keyed by uid and read by the rules on every request; an email that has
  never signed in has no uid, and inventing one would put a
  never-resolvable principal in the authorization collection. (The previous
  version of this script wrote to `tenants/{tenantId}/members`, which has
  been dead since legacy tenants were retired — modern hosts carry no
  `tenantId`, so that fixture silently skipped itself every run.)
- Notifications and per-user records aren't seeded (they need real uids);
  the app emits those as you exercise the features.
- The marketplace listing is platform-global, so it is written once and
  never pruned — deleting it while re-seeding one site would blank the
  marketplace for every other one.

# Demo sample data

`tools/scripts/seed-demo-host.mjs` populates a host (and its owning org)
with representative fixtures for **every** console/besigner/host/org
feature, so demos, screenshots, and onboarding start populated instead of
empty (AGL-144, AGL-377).

## Run it

```bash
FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
  node tools/scripts/seed-demo-host.mjs --host demo
```

`--host` accepts a host **id** or **subdomain** (defaults to `demo`). It
is **idempotent**: every fixture uses a deterministic `seed-…` doc id and
writes with `{ merge: true }`, so re-runs converge instead of
duplicating. Nothing outside the target host and its org is touched.

## What it seeds

| Area | Fixtures |
| --- | --- |
| Logic | variables, a function, a workflow, an action |
| Content | a blog collection with entries, media docs, a bookable service |
| CRM | leads, an invited teammate |
| **Commerce catalog** | a physical product with variants + a digital/subscription product, category, manual collection, inventory location |
| **Orders** | one paid order with line-item snapshots and cents totals |
| **Promotions** | automatic discount, coupon, gift card, an approved review |
| **Reservations** | a bookable cabin + a confirmed reservation |
| **Marketing** | a sent campaign, a **designed email** template (email-kind screen), an announcement bar + a popup overlay, an A/B experiment |
| **Redirects** | exact, prefix, and regex rules |
| **Org data** (AGL-240) | a contact, a segment, a list, an extra dataset — written to `orgs/{orgId}/…` when the host is org-wired |
| Community | a published community listing |

## Notes

- Org-scoped collections (contacts, segments, lists, datasets) resolve
  the owning org from the host doc's `orgId` and fall back to the host
  path for pre-migration hosts.
- Products carry both structured `variants` and the flat legacy
  `priceUsd`/`inventory`/`imageUrl` fields, so they render everywhere
  without a lift step.
- Notifications and per-user records aren't seeded (they need real uids);
  the app emits those as you exercise the features.

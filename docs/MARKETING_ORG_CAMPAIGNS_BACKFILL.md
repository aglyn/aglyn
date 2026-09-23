# Moving campaigns and their emails to the organization (AGL-3273)

`tools/scripts/backfill-org-campaigns.mjs` moves each site's campaign
containers, email sends and sequence rollups up to the org:

| from | to |
| -- | -- |
| `hosts/{hostId}/emailCampaigns/{id}` | `orgs/{orgId}/emailCampaigns/{id}` + `visibleTo` |
| `hosts/{hostId}/campaigns/{sendId}` and `reports/*` | `orgs/{orgId}/campaigns/{sendId}` + `hostId`, `visibleTo: ['host:{hostId}']` |
| `hosts/{hostId}/campaignSequenceReports/{id}` | `orgs/{orgId}/campaignSequenceReports/{id}` |

Every document keeps its id. That is the whole reason this is safe:

- a member's `campaignIds` (forms, screens, leads, contact facets, sequences,
  enrollments) names a container id, so none of them is rewritten;
- a send id is `cid` inside the HMAC of every unsubscribe link that send ever
  mailed, and the delivery webhook finds the send by the same id. Readers that
  start from a link look the send up through the site's org and fall back to
  the site path (`resolveCampaignSendRef` in `campaign-conversion-attribution.ts`), so a link works before, during and
  after the move.

Each moved document is archived to
`orgs/{orgId}/marketingBackfillArchive/{kind~hostId~id}` before the site copy
is deleted.

## Order, and why it is not optional

1. The **promotion carrying AGL-3273 is live** on production.
2. Its **rules are deployed** — a promotion ships only Vercel:
   ```
   firebase deploy --only firestore:rules
   ```
   Deploy them before the promotion takes the alias if you can: the new
   console reads the org collections, which the old rules deny.
3. **Then** this script, promptly. From the moment the new code is live, the
   scheduled-send cron leaves any send still under a site alone rather than
   split it across two documents, so a send scheduled in the window waits
   for this run.

## Running it

```bash
# Dry run, every org. Writes nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-campaigns.mjs

# One org, dry run, then for real.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-campaigns.mjs --org=<orgId>
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-campaigns.mjs --org=<orgId> --apply

# An org whose campaigns should span every site rather than the one each
# came from. Needs --org: it changes who sees each campaign.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-campaigns.mjs --org=<orgId> --org-wide --apply
```

## What a moved document gains

- **Container:** `visibleTo`. The site it came from by default
  (`['host:{hostId}']`), so an agency's brands do not start seeing each other's
  campaigns because the storage moved; `['org']` with `--org-wide`. A
  container that already carries a valid scope keeps it.
- **Send:** `hostId`, the site it is sent as, and `visibleTo` naming that site.
- Both: `migratedFromHostId`.

## When the org already holds an id

The live code writes the org path from the moment it deploys. For a container
or a send the **org copy wins** field by field and the site copy fills only
what it lacks. A sequence rollup is a set of counters the live code only ever
increments at the org, so the two are **added**.

## What it leaves alone, and exits 1 for

- A send `status: 'sending'` under the old code with no org copy: a batch is
  running against the site document. **Deferred** — re-run once it settles.
- An id held by two sites of one org. **Refused** and left where it is, for a
  person to settle; the org path can hold one of them.

## Idempotence

A second run finds no site documents and plans nothing. An interrupted run is
finished by a re-run: writes are ordered org copy, then archive, then delete,
so nothing is removed before its copy is committed.

## Runs

| date | org | result |
| -- | -- | -- |
| 2026-09-23, after v1.0.0-beta.174 went live (rules ruleset `8d18c0d9`, three `campaigns` indexes) | `jWmGooWE3L` (aglyn-org), `--org-wide` | 5 campaigns (all now `['org']`), 8 emails across both sites (`hostId` stamped), 2 sequence rollups; 18 archive rows; 0 deferred, 0 refused |
| 2026-09-23, same window | `hz_KgetqSq` (demo brands) | 4 seeded emails, the shared `seed-campaign-1` re-keyed `seed-campaign-1-{hostId}`; 4 archive rows |
| 2026-09-23, re-run | every org | plans nothing: converged |

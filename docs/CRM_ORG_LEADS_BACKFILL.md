# Moving leads to the organization (AGL-3276)

`tools/scripts/backfill-org-leads.mjs` moves every lead from
`hosts/{hostId}/leads/{personKey}` to `orgs/{orgId}/leads/{personKey}` and
folds the rows that share a person key into one record.

## Why there is anything to fold

A lead's id is `sha256(normalizeContactEmail(email))`. Under the old layout
the same address captured on two sibling brands was **two documents carrying
one id** under two parents — one person as two records, by construction. On
the org there is one document, so the rows have to be merged.

An org with a single site has nothing to fold. Its leads still move: the host
path is going away in AGL-3277.

## Order, and why it is not optional

1. The **AGL-3275 promotion is live** on production.
2. Its **rules and indexes are deployed** — a promotion ships only Vercel:
   ```
   firebase deploy --only firestore:rules
   firebase deploy --only firestore:indexes
   ```
3. **Then** this script.

A deployment still on the old model rebuilds the host rows behind the script.
And the live code carries a stale row over on the next write that touches it
(`leadForWrite`), so by the time this runs some keys are already on the org —
which is why a key the org **already holds is left alone** rather than
overwritten with a fold of the rows it was built from. Overwriting would undo
a capture that happened after the promotion.

Run **between sends**, never inside the send job's window, and tell whoever is
running Sequences first.

## Running it

```bash
# Dry run, every org. Writes nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-leads.mjs

# Dry run, one org.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-leads.mjs --org=<orgId>

# Apply. A separate, approved step.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-org-leads.mjs --org=<orgId> --apply
```

## The merge

Every decision is in `tools/scripts/lib/org-lead-backfill.mjs` and pinned by
`org-lead-backfill.test.mjs`. In short:

| question | answer |
| -- | -- |
| which row wins | the **earliest created**; a row that cannot prove its age sorts last |
| the later rows | fold in, and each leaves a timeline note naming its site |
| `visibleTo` | the **union** of the folded rows' scopes; a row naming none is scoped to the site it was found under. **Never** `['org']` |
| `capturedByHostIds`, `sources` | union |
| `submissionCount` | sum; `firstSeenAtMs`/`lastSeenAtMs` bracket the person |
| status | a **conversion or a close on any site wins** an open status |
| marketing basis | carried forward, never cleared, keeping the **earliest** grant |
| two enrollments | the one **furthest along** is kept; the duplicate is *stopped*, not deleted |

The conversion rule is the load-bearing one: taking an open status because
that row happened to be created first would put somebody who is already a
contact back in the Leads list, where the sequence runtime would enroll them
again.

A refused enrollment is stopped rather than deleted because the record of
having been enrolled is what stops the person being enrolled again.

## Idempotence

A second run finds no host rows and plans nothing. An interruption leaves a
partially moved org, which a re-run finishes — the archive id is keyed by site
and person, so a re-archived row is the same row.

## Afterwards

- A second dry run plans nothing.
- On the Enrollments tab, each surviving enrollment kept its step and due time.
- No surviving lead is visible to a host outside its consent group.
- Then AGL-3277 removes the host-path fallback and its rules block.

Every moved row is archived to
`orgs/{orgId}/crmBackfillArchive/leads~{hostId}~{personKey}` before it is
deleted, unless `--no-archive` is passed, which it should not be.

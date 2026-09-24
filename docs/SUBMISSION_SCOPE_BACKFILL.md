# Stamping form submissions with their organization and site (AGL-3303)

The organization's Inbox (`/{orgSlug}/inbox`) reads every site's form
submissions with ONE collection-group query:

```
collectionGroup('formSubmissions')
  .where('orgId', '==', <orgId>)
  .orderBy('createdAt', 'desc')
```

The submit route stamps `orgId` and `hostId` on every submission from the
AGL-3303 promotion on. A submission written before it carries neither, so it is
in no organization's Inbox until `tools/scripts/backfill-submission-scope.mjs`
stamps it. Each site's own Inbox lists it either way — it reads the site's
collection directly, not the group.

| field | value |
| -- | -- |
| `hostId` | the site in the row's own path, `hosts/{hostId}/formSubmissions/{id}` |
| `orgId` | that site's org: the host document's `orgId`, else `hostIndex/{hostId}.orgId` — the submit route's order |

Nothing else on a submission is read beyond those two fields or written.

## Order, and why it is not optional

1. **Deploy the index**, and wait for it to build:
   ```
   node tools/scripts/deploy-firestore-indexes.mjs
   npm run check:index-drift        # until formSubmissions (orgId, createdAt DESC) is READY
   ```
   The `COLLECTION_GROUP` index `formSubmissions (orgId ASC, createdAt DESC)`.
   Without it the org Inbox's Submissions tab is refused with
   `FAILED_PRECONDITION` rather than answered slowly.
2. **Deploy the rules** — a promotion ships only Vercel:
   ```
   node tools/scripts/deploy-firestore-rules.mjs
   ```
   They add the collection-group read (org-wide members, a list filtered on
   `orgId` only) and freeze `orgId`/`hostId` against the client, narrowing a
   submission's client update to `read`. Both are safe under the console that
   is live before the promotion: it only ever writes `read`.
3. **Promote.** From here every new submission arrives stamped.
4. **Then this script.** Run before the promotion is live, the rows arriving
   between the run and the deploy would be unstamped again — and `--apply` is
   refused on a checkout whose submit route does not stamp the pair or whose
   rules do not freeze it, which is the tell of a checkout older than the change.

## Running it

```bash
# Dry run, every org. Writes nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-submission-scope.mjs

# One org, dry run, then for real.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-submission-scope.mjs --org=<orgId>
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-submission-scope.mjs --org=<orgId> --apply

# Every org.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-submission-scope.mjs --apply
```

It walks every host, then each host's `formSubmissions` paged on the document
id, reading only `orgId` and `hostId`, and writes in batches of 400.

## What it leaves alone, and exits 1 for

- **A site whose host document and `hostIndex` name different orgs** is
  REFUSED: its submissions stay unstamped and the run exits 1. Stamping either
  org could file a site's submissions into a stranger's Inbox; settle the site's
  org by hand, then re-run.
- **A site with no org at all** is left alone and counted — such a site is in
  no organization's Inbox by design.
- **A row carrying a different pair** is corrected, and counted as corrected:
  the pair is a fact about where the document lives.
- **A row deleted while the run was writing** is counted and skipped — never
  recreated as a stub.

## Idempotence

A row already carrying the right pair is not written, so a second run plans
nothing. An interrupted run leaves some rows stamped; a re-run finishes the
rest. When a dry run across every org reports `0 to stamp` with no refusals,
the backfill has converged: record the run here and delete the script in the
same commit ([the lifecycle](BACKFILLS_AND_SEEDS.md#the-lifecycle-and-why-this-list-should-shrink)).

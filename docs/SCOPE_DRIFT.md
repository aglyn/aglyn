# Scope drift: the weekly detector, and how to repair what it finds

A resource in a scoped collection carries `visibleTo` — the AGL-1037 array of
tokens naming who may see it, `['org']` or `['host:{hostId}']`. Both
enforcement layers **fail closed on a missing field**: the rules'
`visibleTo.hasAny(...)` errors, and the client's `array-contains-any` matches
nothing. So a document created without it is not "unrestricted". It is
invisible to every site-scoped read, and visible only from the org page that
made it.

That is a bug with a very misleading symptom. In AGL-1466 the media library
opened from a host showed **"No folder — 111"** and **"Brand — 0 files"**: the
114 files were all correctly scoped, and it was their *folders* that had
vanished, so everything fell back to "No folder" and it read as a data-loss
event rather than a scoping one.

## What runs, and when

`.github/workflows/scheduled-crons.yml` POSTs `/api/admin/backfill-scope` with
`x-cron-secret` every **Monday at 06:30 UTC**.

A cron-authenticated call is a **dry run and cannot be anything else** — the
route refuses `dryRun: false` to that caller. It plans, counts, and reports:

```jsonc
{
  "dryRun": true,
  "drift": {
    "byCollection": { "mediaFolders": 8, "datasets": 1 },
    "members": 0,
    "total": 9
  },
  "totals": { /* per-collection written/skipped, plus legacyHostDatasets */ },
  "done": true,
  "nextCursor": null
}
```

With `drift.total > 0` it returns **HTTP 207** — which fails the workflow run —
and sends a staff notification naming the collections and counts. With zero it
returns 200 and says nothing.

### Why it does not repair

It would be one line to let the weekly job write the stamps, and that is the
wrong line. The documents are a *consequence*; the bug is always a creation
path that forgot the field. A job that quietly fixed the consequence every
Monday would leave the creation path broken forever and remove the only signal
that it exists — which is precisely how this class survives an audit. The
scan being read by a person is the entire feature.

## Reading the report

| Field | Means |
| --- | --- |
| `drift.byCollection.datasets` | datasets that render on **no site**, and are missing from the workflows and reference-health cards even for an org-wide member |
| `drift.byCollection.media` | assets invisible to every site-scoped library view |
| `drift.byCollection.mediaFolders` | the AGL-1466 shape: folders gone, their files collapsed into "No folder" |
| `drift.byCollection.contacts` | `upsert-contact` dedupes through `scopedToHost`, so these are invisible to their own dedupe query — a repeat form submission creates a duplicate instead of merging |
| `drift.byCollection.contactSegments` | inert today (no scoped reader, rules gate on `isOrgWideMember()`), live the moment anyone adds one |
| `drift.members` | a member's `scopeTokens` projection is stale — the same mismatch from the reader's end |

An **empty** `visibleTo: []` is never counted. That is a stored "visible to
nobody", and widening it to `['org']` is the one direction nothing may move a
resource unasked.

`totals.legacyHostDatasets` counts documents still under the pre-AGL-237
`hosts/{hostId}/datasets` fallback. It is reported, never touched.

## Repairing what it finds

**First find the creation path.** The document is downstream. Ask which writer
made it, and fix that writer — the guard is
`libs/aglyn/src/lib/app-utils/scoped-create-coverage.spec.ts`, which lists
every creator of a scoped collection and fails when a new one arrives without
a scope. `newResourceScopeFields` (and `newMediaFolderDoc` for folders) take a
**required** argument with no default, so a creator that has not decided
cannot compile.

**Then stamp the documents.** Same route, driven by a staff ID token:

```bash
# Dry run first — always. The totals are meant to be read before bytes move.
curl -sS -X POST https://app.aglyn.com/api/admin/backfill-scope \
  -H "authorization: Bearer $STAFF_ID_TOKEN" \
  -H 'content-type: application/json' -d '{"dryRun":true}'

# Then, having read them:
curl -sS -X POST https://app.aglyn.com/api/admin/backfill-scope \
  -H "authorization: Bearer $STAFF_ID_TOKEN" \
  -H 'content-type: application/json' -d '{"dryRun":false}'
```

It stamps `visibleTo: ['org']` — exactly today's behaviour for an unstamped
document read by an org-wide member, so nobody gains access and nobody loses
it. Narrowing afterwards is an explicit act by an org admin in the sharing
editor.

It walks 25 orgs per invocation. If the response has `"done": false`, feed
`nextCursor` back as `{"cursor":"…"}` (or `?afterOrg=`) until it is true. A
re-run plans zero writes; that idempotence is the acceptance criterion.

**`['org']` is not always right.** It is the safe default and it is not a
judgement. A document that *should* have been site-private is now org-wide and
correctly stamped, so the detector will never mention it again — which is why
the creation path matters more than the stamp.

## If the detector itself goes quiet

A green Monday run means `drift.total` was 0. Two ways that can be a lie:

- **`CRON_SECRET` unset on the console project.** The route answers 501 with
  "Scope drift detection is not configured", and the workflow goes red rather
  than passing quietly.
- **`CONSOLE_BASE_URL` pointing at a redirecting host.** curl carries neither
  the body nor `x-cron-secret` across a redirect (AGL-786); the workflow names
  that case explicitly on a 3xx.

Both fail loudly, on purpose. The failure this whole mechanism exists to
prevent is a job that looks scheduled and reports nothing.

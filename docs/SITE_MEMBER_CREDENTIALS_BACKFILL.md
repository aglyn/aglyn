# Moving site-member password hashes off the profile (AGL-3308)

A site member's scrypt hash (`passwordScrypt`, `salt:hash`) was stored on
`hosts/{hostId}/siteMembers/{id}` — the profile the console lists on the Users
page, the Inbox and the dashboard. The collection had no rules block of its
own, so the host catch-all let **every member of the site read every hash**,
viewers included, and let any admin, editor or author **replace one and sign in
as that member**.

The hash now lives on a document no client can read or write, staff included:

| document | holds | client access |
| -- | -- | -- |
| `hosts/{hostId}/siteMembers/{id}` | email, name, addresses, consent, `suspended`, `sessionsValidFromMs` | read: any member of the site; update: `suspended` only; create: none; delete: only while no credential document exists |
| `hosts/{hostId}/siteMemberCredentials/{id}` | `passwordScrypt`, `passwordResetAt` | none |

Sign-up, sign-in, recovery, reset and the console's password help read and
write the credential document; sign-in and recovery fall back to the copy on
the profile for a member who has none. The console removes a member through
`POST /api/membership/admin-remove`, which deletes both documents in one batch.

`tools/scripts/backfill-site-member-credentials.mjs` moves every remaining
copy across and deletes it from the profile. Until it runs, **every member of a
site can still read the legacy hashes**: a rule cannot hide one field of a
document its reader may read. The emulator suite's `RESIDUAL` case in
`a site member's password hash is no client's (AGL-3308)` measures exactly
that window.

## Order, and why it is not optional

1. **Deploy the rules**, from a checkout pinned to the merged commit:
   ```
   node tools/scripts/deploy-firestore-rules.mjs
   ```
   This closes the takeover at once — no client can set `passwordScrypt` or
   `sessionsValidFromMs` on a profile, create a member, or touch
   `siteMemberCredentials` — and must be live before any credential document
   exists. It is safe under the console that is live before the promotion: the
   drawer's suspend switch is re-granted, and the Inbox's client delete keeps
   working for every member without a credential document, which before the
   promotion is all of them.
2. **Promote.** From here the routes write credential documents and read them
   first.
3. **Then this script, straight away** — dry run, then `--apply`. Run before
   the promotion is live, it would lock every migrated member out, because the
   old sign-in reads the profile alone. `--apply` is refused on a checkout
   whose sign-in does not read the credential document or whose rules do not
   deny it — the tell of a checkout older than the change.

## Running it

```bash
# Dry run, every site. Writes nothing.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-site-member-credentials.mjs

# One site, dry run, then for real.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-site-member-credentials.mjs --host=<hostId>
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-site-member-credentials.mjs --host=<hostId> --apply

# Every site.
GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-site-member-credentials.mjs --apply
```

It walks every host, then each host's `siteMembers` paged on the document id.
Every read is masked to the two credential fields, so no address or name is
loaded, and the report is counts per site — never an address or a hash. Each
member is written in its own transaction.

## What each outcome means

- **to move** — the profile's hash is copied VERBATIM to the credential
  document (with `passwordResetAt`, when the credential document has none) and
  both fields are deleted from the profile. Verbatim is what keeps a reset link
  mailed before the move working: the token is bound to the hash's fingerprint.
- **superseded** — the credential document already holds a hash, written by a
  reset or an admin password set after the promotion. That newer hash is kept;
  only the stale profile copy is deleted.
- **stripped** — the profile carries a credential field with no usable hash (a
  blank or non-string value, or a reset time alone). It is deleted and nothing
  is copied; such a member could not sign in before and cannot after.
- A member removed while the run was writing is counted and left gone. A
  transaction that fails is named by site and member id and the run exits 1;
  re-run to finish.

## Idempotence, and what comes after

A member already clean is not written, so a second run plans nothing. When a
dry run across every site reports `0 to move, 0 superseded … 0 … (stripped)`,
the migration has converged: record the run here, delete the script in the
same commit ([the lifecycle](BACKFILLS_AND_SEEDS.md#the-lifecycle-and-why-this-list-should-shrink)),
and drop the legacy fallback in
`libs/plugins/commerce/src/lib/server/member-credentials.ts`
(`storedPasswordHash` reading the profile), so a profile field can never
answer for a password again.

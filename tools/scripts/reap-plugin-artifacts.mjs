/**
 * Orphaned plugin-artifact reaping, on demand (AGL-942).
 *
 *   CRON_SECRET=... node tools/scripts/reap-plugin-artifacts.mjs [--apply]
 *   CRON_SECRET=... CONSOLE_BASE_URL=https://app.aglyn.com \
 *     node tools/scripts/reap-plugin-artifacts.mjs --apply
 *
 * DRY RUN BY DEFAULT — prints what would be deleted and exits. Pass
 * `--apply` to actually delete. Deletions are permanent: the artifacts
 * bucket has no object versioning, and a bundle we delete cannot be
 * rebuilt from our side.
 *
 * This is a thin client for `POST /api/admin/reap-plugin-artifacts`, not a
 * second implementation. The join it drives needs the Admin SDK and
 * `PLUGIN_ARTIFACTS_BUCKET`, which the console runtime already has, and
 * keeping one home for the rules means a local dry run and the weekly cron
 * can never disagree about what counts as an orphan. Same reason the route
 * (not this script) is what `.github/workflows/scheduled-crons.yml` calls.
 */
const apply = process.argv.includes('--apply')
const baseUrl = process.env.CONSOLE_BASE_URL ?? 'https://app.aglyn.com'
const cronSecret = process.env.CRON_SECRET

if (!cronSecret) {
  console.error('Set CRON_SECRET (same value as the console Vercel env var)')
  process.exit(1)
}

const url = `${baseUrl.replace(/\/+$/, '')}/api/admin/reap-plugin-artifacts`
console.log(`POST ${url}${apply ? '' : ' (dry run)'}`)

const response = await fetch(url, {
  method: 'POST',
  redirect: 'manual',
  headers: {
    'content-type': 'application/json',
    'x-cron-secret': cronSecret,
  },
  body: JSON.stringify({ dryRun: !apply }),
})

// A redirect drops both the body and the secret (AGL-786) — the request
// that lands is unauthenticated, so fail loudly rather than report "0
// orphans" from a response that never ran the reaper.
if (response.status >= 300 && response.status < 400) {
  console.error(
    `${response.status} redirect to ${response.headers.get('location')} — ` +
      'set CONSOLE_BASE_URL to the host that SERVES the console.',
  )
  process.exit(1)
}

const payload = await response.json().catch(() => null)
if (!response.ok) {
  console.error(`HTTP ${response.status}`, payload ?? '(no body)')
  process.exit(1)
}

const {
  scanned = 0,
  kept = 0,
  tooNew = 0,
  orphans = 0,
  deleted = 0,
  bytesReclaimable = 0,
  deferredByCap = 0,
  orphanedListings = [],
  unrecognized = [],
  objects = [],
} = payload ?? {}

console.log(
  `scanned ${scanned} — kept ${kept}, too new ${tooNew}, orphaned ${orphans}`,
)
for (const name of objects) console.log(`  ${apply ? 'deleted' : 'would delete'} ${name}`)
if (deferredByCap) console.log(`  ${deferredByCap} more deferred to the next run (per-run cap)`)
console.log(
  `${apply ? `deleted ${deleted} object(s)` : 'dry run'} — ` +
    `${(bytesReclaimable / 1024).toFixed(1)} KiB reclaimable`,
)

// Reported, never deleted: both need a human decision (see the route).
for (const name of orphanedListings) {
  console.log(`  RETAINED (listing doc gone, installs may still load) ${name}`)
}
for (const name of unrecognized) {
  console.log(`  RETAINED (not a canonical artifact path) ${name}`)
}
if (!apply && orphans) console.log('Re-run with --apply to delete.')

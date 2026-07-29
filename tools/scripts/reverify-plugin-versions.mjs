/**
 * Re-run the static verifier across every published version (AGL-1086).
 *
 *   CRON_SECRET=... node tools/scripts/reverify-plugin-versions.mjs
 *   CRON_SECRET=... node tools/scripts/reverify-plugin-versions.mjs --apply
 *   CRON_SECRET=... node tools/scripts/reverify-plugin-versions.mjs --apply --force
 *
 * DRY RUN BY DEFAULT — reports what the current checker says about every
 * stored version without writing a verdict back. `--apply` stores the new
 * verdicts (which is what makes the next reviewer's page load free) and, if
 * a LIVE version with installs regressed, notifies staff. `--force`
 * re-downloads even versions whose stored verdict is already current.
 *
 * Run it after bumping PLUGIN_VERIFIER_VERSION. Verdicts otherwise only
 * recompute when a reviewer opens that version's page, so new checks never
 * reach the versions nobody looks at — which are the ones worth checking.
 *
 * A thin client for `POST /api/admin/reverify-plugin-versions`, not a second
 * implementation: the sweep needs the Admin SDK and PLUGIN_ARTIFACTS_BUCKET,
 * which the console runtime already has, and one home for the rules means a
 * local run and the scheduled one can never disagree.
 */
const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')
const baseUrl = process.env.CONSOLE_BASE_URL ?? 'https://app.aglyn.com'
const cronSecret = process.env.CRON_SECRET

if (!cronSecret) {
  console.error('Set CRON_SECRET (same value as the console Vercel env var)')
  process.exit(1)
}

const url = `${baseUrl.replace(/\/+$/, '')}/api/admin/reverify-plugin-versions`
console.log(`POST ${url}${apply ? '' : ' (dry run)'}${force ? ' --force' : ''}`)

const response = await fetch(url, {
  method: 'POST',
  redirect: 'manual',
  headers: { 'content-type': 'application/json', 'x-cron-secret': cronSecret },
  body: JSON.stringify({ dryRun: !apply, force }),
})

// A redirect drops both the body and the secret (AGL-786) — the request that
// lands is unauthenticated, so fail loudly rather than report "0 regressions"
// from a response that never ran the sweep.
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
  verifierVersion = 0,
  skipped = 0,
  downloaded = 0,
  deferredByCap = 0,
  scanned = 0,
  regressed = 0,
  fixed = 0,
  stillFailing = 0,
  unchanged = 0,
  unverifiable = 0,
  notable = [],
  needsStaff = [],
} = payload ?? {}

console.log(
  `verifier ${verifierVersion} — ${skipped} already current, ` +
    `${downloaded} re-checked${deferredByCap ? `, ${deferredByCap} deferred to the next run` : ''}`,
)
console.log(
  `${scanned} scanned — ${regressed} regressed, ${stillFailing} still failing, ` +
    `${fixed} fixed, ${unchanged} unchanged, ${unverifiable} unverifiable`,
)
for (const entry of notable) {
  console.log(
    `  [${entry.outcome}] ${entry.listingName} v${entry.version} ` +
      `(${entry.reviewStatus}, ${entry.activeInstalls} active install(s))`,
  )
  for (const problem of entry.problems ?? []) console.log(`      ${problem}`)
}
if (needsStaff.length) {
  console.log(
    `\n${needsStaff.length} LIVE version(s) with installs regressed — ` +
      `${apply ? 'staff notified' : 'staff would be notified'}. Nothing was ` +
      'revoked: the verifier is a lint, and a reviewer decides.',
  )
}
if (!apply) console.log('\nDry run — no verdicts were written.')

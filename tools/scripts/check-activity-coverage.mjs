/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// AGL-118 — every path that brings a durable customer object into existence,
// or changes who controls it, must write an activity entry or say in writing
// why it does not.
//
// ── THE SYMPTOM THIS EXISTS TO PREVENT ────────────────────────────────────
//
// An ACTIVE ACCOUNT WITH AN EMPTY ACTIVITY FEED. That is what this gap looked
// like from the outside, and it was misread twice before anyone looked here:
// first as a Firestore rules denial, then as a customer who had never used the
// product. Neither was true. The account had signed up, created a workspace,
// created a site and built three screens from a template — and every one of
// those acts was a CREATE, which was the one category the log did not cover.
//
// If you are reading this because a customer's activity feed is empty, the
// question is not "who is being denied" but "which mutation path forgot to
// log", and this check is where the answer lives.
//
// ── WHY THE GAP EXISTED ───────────────────────────────────────────────────
//
// The log was assembled by adding a call at each mutation point IN THE CONSOLE
// UI. That covers saves and deletes well — a person edits a thing that already
// exists from a screen that already has the logger in scope. It covers
// creation almost not at all, because the acts that bring a top-level object
// into being happen in server routes and provisioning functions that no UI
// mutation point reaches.
//
// It is also why the fix is server-side and why this check is possible at all:
// a route file is something a script can enumerate. A `logActivity()` call
// inside a React component is not.
//
// ── SCOPE: DELIBERATELY NARROW ────────────────────────────────────────────
//
// It checks paths that CREATE, TRANSFER or DESTROY a durable customer object —
// workspaces, sites, and the resources and memberships under them.
//
// It deliberately does NOT cover:
//
//  - every Firestore write. A detector that flags all of them is noisy, and a
//    noisy check collects reflex exclusions until it means nothing. The class
//    that failed here is object lifecycle, so that is the class it guards.
//  - client-side mutation points. They cannot be enumerated statically with
//    any confidence, and moving their writes server-side is the actual fix.
//  - reads, and updates to fields on an object that already exists. A save is
//    already logged by the surface that performs it.
//  - the tenant runtime's own event/workflow writers, which append to the same
//    collection from the site side and are not console mutation paths.
//
// ── HOW IT DECIDES ────────────────────────────────────────────────────────
//
// A path is COVERED when its file calls `logHostActivity(` or `logOrgActivity(`,
// or when it is classified in `NOT_LOGGED` with a written reason. A path that
// is neither fails the check. `NOT_LOGGED` is ratcheted: its size may fall and
// may not rise, so removing a reason is free and adding one is a deliberate,
// reviewable act.
//
//   node tools/scripts/check-activity-coverage.mjs
//   node tools/scripts/check-activity-coverage.mjs --self-test
//
// `--self-test` is not optional decoration. A coverage check whose enumeration
// silently matches nothing reports perfect coverage, which is the same failure
// as a search with no control — it points the detector at one path known to
// log and one known not to, and fails if either verdict is wrong.

import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const args = process.argv.slice(2)
const SELF_TEST = args.includes('--self-test')

/** The call that satisfies the check, in either scope. */
const LOG_CALL = /\blog(?:Host|Org)Activity\s*\(/

/**
 * The durable-object mutation surface, listed rather than globbed.
 *
 * A glob over `app/api/**` would sweep in reads, health probes and plugin
 * proxies, and the exclusion list needed to quiet it would be longer than this
 * one and would carry no information. Every entry here brings an object into
 * existence, destroys one, or moves who controls it.
 */
const MUTATION_PATHS = [
  'apps/console/app/api/orgs/create/route.ts',
  'apps/console/app/api/orgs/delete/route.ts',
  'apps/console/app/api/orgs/members/route.ts',
  'apps/console/app/api/orgs/invites/route.ts',
  'apps/console/app/api/orgs/roles/route.ts',
  'apps/console/app/api/orgs/settings/route.ts',
  'apps/console/app/api/hosts/create/route.ts',
  'apps/console/app/api/hosts/delete/route.ts',
  'apps/console/app/api/hosts/rename/route.ts',
  'apps/console/app/api/hosts/members/route.ts',
  'apps/console/app/api/hosts/resources/route.ts',
  'apps/console/app/api/hosts/versions/route.ts',
  'apps/console/app/api/hosts/import/route.ts',
  'apps/console/app/api/hosts/collections/route.ts',
  'apps/console/app/api/domains/attach/route.ts',
  'apps/console/app/api/domains/detach/route.ts',
  'apps/console/app/api/billing/subscription/route.ts',
  'apps/console/app/api/billing/checkout/route.ts',
  'apps/console/app/api/billing/webhook/route.ts',
  // The provisioning module. Not a route, and the reason the gap went
  // unnoticed for so long: `createOrganization` and `transferOrgOwnership`
  // live here, are reachable from several routes, and are where a workspace
  // actually comes into being.
  'libs/tenant/data/admin/src/lib/server/organizations.ts',
  // The CRM's server routes (AGL-2622): `crm/contacts-create` brings a
  // person into the org's shared address book, and `crm/lead-convert`
  // brings a contact, a company and a deal into being from one lead. Plugin
  // routes rather than `app/api` ones, which is why a glob over the app
  // would never have listed them — the same shape as the provisioning
  // module above.
  'libs/plugins/crm/src/lib/server.ts',
  'libs/plugins/crm/src/lib/server/lead-convert.ts',
]

/**
 * Paths that legitimately write no activity entry, each with the reason.
 *
 * A reason is not a formality. Every line here is a claim that an act a
 * customer performed does not belong in their audit trail, and the next
 * person to read it has to be able to agree or disagree with it.
 */
const NOT_LOGGED = {
  'apps/console/app/api/orgs/create/route.ts':
    'Delegates to `createOrganization`, which writes the entry. Logging here ' +
    'too would put two rows on one act, and the route is not the only caller.',
  'apps/console/app/api/hosts/import/route.ts':
    'Writes its own `Restored site from export (N documents)` entry directly ' +
    'with the Admin SDK rather than through the helper.',
  // The three billing routes share one decision, recorded here so whoever
  // picks this up inherits the answer instead of re-deriving it.
  //
  // DECIDED: subscription lifecycle is logged FROM THE WEBHOOK, not from the
  // console route.
  //
  //  1. The webhook reports what HAPPENED; the route reports what was
  //     ATTEMPTED. A plan change Stripe declines, or that fails SCA, is a
  //     console action with no billing consequence — and a log that records
  //     the attempt as the event is wrong in precisely the cases somebody is
  //     reading it to understand.
  //  2. It covers events with NO console action at all: dunning
  //     cancellations, Stripe-side retries, disputes. With the console as
  //     writer those are invisible, which is the same hole this whole issue
  //     closed.
  //  3. One writer, so there is no de-duplication problem to solve.
  //
  // The cost is that the webhook does not know who clicked. Carry the acting
  // uid in Stripe METADATA on the call the console makes and read it back off
  // the event: a customer-initiated change then names the person, and a
  // Stripe-initiated one honestly has no actor.
  //
  // ⛔ Do NOT fall back to attributing a dunning cancellation to the last
  // person who touched billing. That is the org-owner inference wearing a
  // different hat, and it puts a name on an act nobody performed.
  //
  // Both console routes are now CORRECTLY SILENT rather than pending: the
  // webhook logs the lifecycle, and each of these stamps `metadata[actorUid]`
  // and `metadata[actorAction]` on the Stripe call so the webhook can name
  // the person without inferring one. The reader is
  // `webhook/subscription-activity.ts`.
  'apps/console/app/api/billing/subscription/route.ts':
    'Correctly silent. It reports what was ATTEMPTED; the webhook reports ' +
    'what happened. It carries the acting uid to the webhook in Stripe ' +
    'metadata and writes no entry of its own.',
  'apps/console/app/api/billing/checkout/route.ts':
    'Correctly silent for the same reason, and carries the same stamp.',
}

/** How many exclusions are allowed. It may fall; it may not rise. */
const RATCHET = 4

const read = (relative) => {
  const path = `${repoRoot}${relative}`
  return existsSync(path) ? readFileSync(path, 'utf8') : null
}

/** COVERED | CLASSIFIED | UNLOGGED | MISSING */
function verdictFor(relative) {
  const source = read(relative)
  if (source === null) return 'MISSING'
  if (LOG_CALL.test(source)) return 'COVERED'
  return NOT_LOGGED[relative] ? 'CLASSIFIED' : 'UNLOGGED'
}

if (SELF_TEST) {
  /*
   * The control. One path known to log and one known not to — if the
   * enumeration ever stops matching real files, or the pattern stops matching
   * a real call, both verdicts go wrong here before the check can report
   * perfect coverage on an empty scan.
   */
  const LOGS = 'apps/console/app/api/hosts/create/route.ts'
  const SILENT = 'apps/console/app/api/billing/subscription/route.ts'
  const failures = []
  if (read(LOGS) === null) failures.push(`${LOGS} does not exist`)
  if (read(SILENT) === null) failures.push(`${SILENT} does not exist`)
  if (verdictFor(LOGS) !== 'COVERED') {
    failures.push(
      `${LOGS} calls the logger but the detector says ${verdictFor(LOGS)} — ` +
        'the pattern no longer matches a real call.',
    )
  }
  if (verdictFor(SILENT) !== 'CLASSIFIED') {
    failures.push(
      `${SILENT} writes no entry but the detector says ${verdictFor(SILENT)} ` +
        '— the detector is matching something that is not a log call.',
    )
  }
  if (failures.length) {
    console.error('\nSELF-TEST FAILED\n  ' + failures.join('\n  ') + '\n')
    process.exit(1)
  }
  console.log(
    '\nself-test OK — a logging path reads COVERED and a silent one reads ' +
      'CLASSIFIED, so the detector discriminates.\n',
  )
  process.exit(0)
}

const covered = []
const classified = []
const unlogged = []
const missing = []
for (const relative of MUTATION_PATHS) {
  const verdict = verdictFor(relative)
  if (verdict === 'COVERED') covered.push(relative)
  else if (verdict === 'CLASSIFIED') classified.push(relative)
  else if (verdict === 'MISSING') missing.push(relative)
  else unlogged.push(relative)
}

console.log('\nActivity coverage over durable-object mutation paths (AGL-118)\n')
console.log(`  covered     ${covered.length}`)
console.log(`  classified  ${classified.length}  (ratchet ${RATCHET})`)
console.log(`  unlogged    ${unlogged.length}`)
for (const path of covered) console.log(`    LOGS       ${path}`)
for (const path of classified) console.log(`    classified ${path}`)

let failed = false
if (missing.length) {
  // A renamed or deleted path silently shrinks the enumeration, which is how
  // a coverage check starts reporting on nothing.
  console.error('\nENUMERATION IS STALE — these paths no longer exist:')
  for (const path of missing) console.error(`  ${path}`)
  console.error('Update MUTATION_PATHS; do not let the list rot into a no-op.')
  failed = true
}
if (unlogged.length) {
  console.error('\nUNLOGGED MUTATION PATHS — each creates, transfers or')
  console.error('destroys a durable customer object and writes no activity:')
  for (const path of unlogged) console.error(`  ${path}`)
  console.error(
    '\nAdd a `logHostActivity`/`logOrgActivity` call, or classify it in\n' +
      'NOT_LOGGED with the reason it does not need one. An account whose\n' +
      'feed is empty because a path forgot to log is indistinguishable from\n' +
      'an account that did nothing.',
  )
  failed = true
}
if (classified.length > RATCHET) {
  console.error(
    `\nRATCHET — ${classified.length} classified exclusions, baseline ` +
      `${RATCHET}. The list may shrink, never grow.`,
  )
  failed = true
}
if (classified.length < RATCHET) {
  console.log(
    `\nRatchet can tighten: ${classified.length} < ${RATCHET}. Lower RATCHET ` +
      'to record the win.',
  )
}
if (failed) process.exit(1)
console.log('\nEvery durable-object mutation path logs or is classified.\n')

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

/**
 * The argument handling and reporting for `tools/scripts/erase-tenant.mjs`
 * (AGL-1481), separated from the entry point for one reason: everything here
 * takes `eraseOrg` as a parameter, so a test can assert WHICH call the script
 * makes without loading the workspace or reaching Firestore.
 *
 * There is deliberately no erasure logic in this file. The whole point of
 * AGL-1481 is that the script has no second copy of the cascade: it parses
 * arguments, calls `eraseOrg`, and prints what came back.
 */

export const USAGE =
  'Usage: node tools/scripts/erase-tenant.mjs --org <orgId> [--confirm] ' +
  '[--actor <uid>]'

/** Read `--flag <value>`, returning null when the flag is absent. */
function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  if (index < 0) return null
  return argv[index + 1] ?? null
}

export function parseEraseArgs(argv) {
  return {
    orgId: flagValue(argv, '--org'),
    confirm: argv.includes('--confirm'),
    actorUid: flagValue(argv, '--actor') || 'script:erase-tenant',
    // Recognised only to explain itself — see `runEraseOrgCli`.
    legacyTenant: argv.includes('--tenant'),
  }
}

/**
 * Print every count the result carries, whatever they are.
 *
 * Deliberately NOT a list of the sweeps with friendly labels. A list here is a
 * second enumeration of what an erasure covers, and a second enumeration is
 * the thing that drifted — a sweep added to `eraseOrg` would land in the
 * result and silently never be printed, so a manual erasure would understate
 * what it destroyed in exactly the way AGL-1481 describes. The field names are
 * the shared function's own and they carry their meaning; a new one appears
 * here the moment it exists.
 */
function reportCounts(result, log) {
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'number') log(`  ${String(value).padStart(6)}  ${key}`)
  }
}

/**
 * Why a refusal happened, in the operator's words rather than the enum's.
 *
 * `eraseOrg` returns the same reasons to the cron, which logs them for a
 * machine. A person who has just been asked to erase a customer's workspace
 * needs to know what to do next.
 */
const REFUSALS = {
  'not-found': (orgId) => `orgs/${orgId} does not exist.`,
  'no-request': () =>
    'no erasure request on this org. File it first (staff admin console, or ' +
    'the owner via self-serve "Delete organization"), then wait out the ' +
    '7-day hold.',
  'hold-active': () =>
    'the 7-day hold has not elapsed. The request is still reversible; that ' +
    'is what the hold is for.',
}

/**
 * Run the erasure CLI. Returns a process exit code; never calls `process.exit`
 * itself, so a test can drive it.
 *
 * `eraseOrg` is injected. The entry point passes the real one, loaded from
 * `libs/tenant/data/admin/src/lib/server/erase.ts` — the same function
 * `/api/admin/run-erasures` calls.
 *
 * **Nothing here writes a file.** The version this replaced wrote
 * `erasure-org-{orgId}-{now}.json` into whatever directory the operator
 * happened to be standing in: a complete verbatim copy of the org tree and
 * every host tree, carrying `webhooks.secret`, `orders.paymentLinkUrl` (a live
 * payable bearer URL), `screens.protection.passwordHash` and
 * `ssoDomains.token`. A GDPR erasure run by hand left a file of WORKING
 * customer credentials on a laptop, with no retention, no access control and
 * no record that it existed. AGL-1443 deleted the same write from the served
 * path; this is the other producer.
 */
export async function runEraseOrgCli({
  argv,
  eraseOrg,
  emulated = false,
  log = console.log,
  warn = console.error,
}) {
  const { orgId, confirm, actorUid, legacyTenant } = parseEraseArgs(argv)

  if (legacyTenant) {
    warn(
      // The path named here has to be one that EXISTS. It did not until
      // AGL-1977 built it: this string sent operators to "staff console →
      // Users → Erase" for two months while no such control was rendered
      // anywhere, which is a dead end reached at the moment somebody is
      // trying to honour a statutory deadline. It now names the page that
      // carries the button, so a reader can check it in one click.
      'REFUSED: --tenant is gone (AGL-1481). The legacy `tenants/{uid}` ' +
        'collection was retired by AGL-238 and personal-account erasure is ' +
        'served by `eraseUser` — staff console → /admin/users/<uid> → ' +
        'Erase account (super staff only, immediate, no 7-day hold), or ' +
        "the owner's own Manage Account → Close account. This script " +
        'erases an ORG.',
    )
    return 1
  }
  if (!orgId) {
    warn(USAGE)
    return 1
  }

  // There is no Storage emulator, and this script initializes firebase-admin
  // with a REAL service-account credential — so a confirmed run pointed at the
  // Firestore emulator would delete Firestore rows that do not matter and
  // sweep the PRODUCTION bucket, which does. Planning against the emulator is
  // the useful half and is safe; erasing against it is neither.
  if (emulated && confirm) {
    warn(
      'REFUSED: --confirm is not allowed while FIRESTORE_EMULATOR_HOST is ' +
        'set. There is no Storage emulator, so the storage sweeps in a ' +
        'confirmed run would address the real bucket. Plan here; erase for ' +
        'real without the emulator.',
    )
    return 1
  }

  const result = await eraseOrg(orgId, { dryRun: !confirm, actorUid })

  if (result.skippedReason === 'dry-run') {
    log(`PLAN for orgs/${orgId} — nothing has been deleted:`)
    reportCounts(result, log)
    log(
      '\nRe-run with --confirm to PERMANENTLY erase the org, its sites, ' +
        'files and data. No copy is kept: export anything the customer still ' +
        'needs before you do (AGL-1443).',
    )
    return 0
  }

  if (!result.ok) {
    const explain = REFUSALS[result.skippedReason]
    warn(`REFUSED: ${explain ? explain(orgId) : result.skippedReason}`)
    return 1
  }

  log(`Erased orgs/${orgId}:`)
  reportCounts(result, log)
  log(`\nComplete and audited as ${actorUid}. This cannot be undone.`)
  return 0
}

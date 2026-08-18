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

// Re-apply the erasures a restore brought back (AGL-1975).
//
// THE LAST STEP OF ANY RESTORE OR IMPORT. Live DPA §11 promises "a deletion
// instruction survives any restoration — data deleted at Customer's
// instruction and later restored from a backup will be deleted again", and a
// Firestore import is merge-by-id, not replace: importing a pre-erasure
// snapshot into `(default)` silently reinstates every document an erasure
// deleted, during an incident, with nothing anywhere saying so.
//
// THIS SCRIPT PERFORMS NO ERASURE OF ITS OWN. It calls `replayErasuresSince`,
// which calls `eraseOrg`/`eraseUser` — the same functions the cron and the
// staff console call (the AGL-1481 rule). A replay tool with its own copy of
// the sweep list would faithfully re-erase the collections somebody remembered
// and quietly leave the ones they did not.
//
// Without --confirm it PLANS: it reads the audit rows and reports which
// targets are standing again, and writes nothing.
//
// Usage (the root .env carries the service account):
//   set -a && source .env && set +a && \
//     node tools/scripts/replay-erasures.mjs --since <ISO8601> [--confirm] \
//       [--actor <uid>]
//
// `--since` is the instant the RESTORED SNAPSHOT was taken, not the instant of
// the restore. Everything erased at or after it may have come back.
//
//   # Procedure A/B (managed backup or PITR clone): the backup's snapshot time
//   node tools/scripts/replay-erasures.mjs --since 2026-08-11T05:00:00Z
//   # Procedure D (GCS export): the export prefix IS the timestamp
//   node tools/scripts/replay-erasures.mjs --since 2026-08-11T05-00-00Z
//
// Exit codes: 0 every erasure was re-applied (or nothing came back); 1 an
// entry is BLOCKED or the window predates the 90-day hot `adminAudit` span, in
// which case an empty list is NOT evidence that there was nothing to replay.

import { getApps, initializeApp, cert } from 'firebase-admin/app'
import { importWorkspaceModule } from './lib/workspace-module.mjs'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const USAGE =
  'Usage: node tools/scripts/replay-erasures.mjs --since <ISO8601> ' +
  '[--confirm] [--actor <uid>]'

function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  if (index < 0) return null
  return argv[index + 1] ?? null
}

/**
 * Initialize the default app BEFORE the workspace module loads, for the same
 * reason `erase-tenant.mjs` does: this script decides which project it points
 * at rather than inheriting whatever `.env` happens to hold.
 */
function initAdmin() {
  if (getApps().length) return
  if (EMULATED) {
    initializeApp({
      projectId:
        process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
        process.env.FIREBASE_PROJECT_ID ||
        'aglyn-main',
    })
    return
  }
  const projectId =
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      'Missing NEXT_PUBLIC_FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / ' +
        'FIREBASE_PRIVATE_KEY — `set -a && source .env && set +a` first.',
    )
    process.exit(1)
  }
  initializeApp({
    projectId,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    serviceAccountId: clientEmail,
    credential: cert({ projectId, clientEmail, privateKey }),
  })
}

async function main() {
  const argv = process.argv.slice(2)
  const rawSince = flagValue(argv, '--since')
  if (!rawSince) {
    console.error(USAGE)
    return 1
  }
  // A GCS export prefix uses `-` where an ISO time uses `:`, and an operator
  // copying the prefix straight off `gcloud storage ls` is the expected path.
  const normalized = /T\d\d-\d\d-\d\d/.test(rawSince)
    ? rawSince.replace(
        /T(\d\d)-(\d\d)-(\d\d)/,
        (_match, h, m, s) => `T${h}:${m}:${s}`,
      )
    : rawSince
  const sinceMs = Date.parse(normalized)
  if (Number.isNaN(sinceMs)) {
    console.error(`--since is not a date I can parse: ${rawSince}`)
    return 1
  }

  initAdmin()
  const { replayErasuresSince } = await importWorkspaceModule(
    'libs/tenant/data/admin/src/lib/server/replay-erasures.ts',
  )

  const confirm = argv.includes('--confirm')
  const result = await replayErasuresSince({
    sinceMs,
    dryRun: !confirm,
    actorUid: flagValue(argv, '--actor') || 'script:replay-erasures',
  })

  console.log(
    `${confirm ? 'REPLAY' : 'PLAN'} — erasures recorded at or after ` +
      `${new Date(sinceMs).toISOString()} (${result.examined} audit rows read)`,
  )
  for (const entry of result.entries) {
    const label = `${entry.kind} ${entry.id}`
    console.log(
      `  ${entry.outcome.toUpperCase().padEnd(9)} ${label}` +
        (entry.detail ? ` — ${entry.detail}` : ''),
    )
  }
  if (!result.entries.length) console.log('  (no erasures in this window)')

  if (result.incomplete === 'audit-window') {
    console.error(
      '\n⚠️  THIS ANSWER IS INCOMPLETE. --since predates the 90-day hot ' +
        '`adminAudit` window, so erasure rows inside the restored span may ' +
        'already be in the Storage archive (`adminAudit-archive/`) and were ' +
        'NOT read. An empty list above is not evidence that nothing needs ' +
        'replaying — read the archive before telling anyone the deletion ' +
        'instruction survived.',
    )
  }
  const blocked = result.entries.filter((entry) => entry.outcome === 'blocked')
  if (blocked.length) {
    console.error(
      `\n⚠️  ${blocked.length} erasure(s) came back and could NOT be ` +
        're-applied. `owns-orgs` means the restore also brought back a ' +
        'workspace that person owns: erase the workspace first (it usually ' +
        'has its own row in the list above), then run this again.',
    )
  }
  if (!confirm && result.entries.some((e) => e.outcome === 'replayed')) {
    console.log('\nRe-run with --confirm to actually re-apply these.')
  }
  return result.ok ? 0 : 1
}

main()
  .then((code) => process.exit(code))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

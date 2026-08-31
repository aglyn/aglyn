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

// Deploys cloud/firebase-firestore.indexes.json using the root .env service
// account via the Firestore Admin REST API (AGL-2015) — the fourth of the
// four Firebase setup commands, alongside the three rules deploys, and with
// the same auth and the same shape:
//
//   node tools/scripts/deploy-firestore-indexes.mjs
//   node tools/scripts/deploy-firestore-indexes.mjs --dry-run
//   node tools/scripts/deploy-firestore-indexes.mjs --file=/tmp/other.json
//
// WHY THIS EXISTS. The self-hosting runbook deployed rules and stopped, then
// sent the operator off to `npx firebase login` for indexes — a different
// tool, a different credential, an interactive browser OAuth flow that does
// not exist on a server. Rules decide who may read; indexes decide whether
// the read works at all, and the consequence is ASYMMETRIC:
//
//   * A missing COMPOSITE index throws `9 FAILED_PRECONDITION` on the query.
//     The product degrades feature by feature, confusingly, and the operator
//     has no reason to connect it to a setup step nobody told them to run.
//   * A missing FIELD OVERRIDE can REJECT A WRITE. The `indexes: []` entries
//     EXEMPT the large besigner `nodes` blobs from indexing; without them
//     Firestore tries to index the blob and refuses the write on the 40KB
//     index-entry limit. Saving a screen is among the first things a new
//     operator does, so this is the one that reads as "the product is broken".
//
// ⚠️ THIS DEPLOY IS ADDITIVE, AND THAT IS THE DELIBERATE DIFFERENCE FROM
// `firebase deploy --only firestore:indexes`. The CLI RECONCILES: it deletes
// whatever the project has that the file does not list, `fieldOverrides`
// included. AGL-866 is that having already destroyed the `versions.nodes`
// exemption once; AGL-1801 is it nearly disabling a live TTL policy. This
// script never deletes. Anything live-but-unlisted is REPORTED, loudly, with
// the instruction to copy it into the file — and then left alone.
//
// ⚠️ TTL POLICIES ARE NOT WRITTEN HERE. `"ttl": true` in the file is applied
// by tools/scripts/set-firestore-ttl.mjs (all eight, per
// docs/FIRESTORE_MANUAL_CONFIG.md). This script's `fields.patch` sends
// `updateMask=indexConfig` precisely so it CANNOT clear a live `ttlConfig`.
// What it owes but does not do is printed as TTL OWED — "not written" must
// never be read as "not needed".
//
// Index builds are ASYNCHRONOUS. A successful run means "accepted", not
// "ready": `npm run check:index-drift` reports what is still BUILDING.
//
// Exit codes — a failed deploy must NEVER render as a clean one:
//   0  every planned write was accepted (or was already there)
//   1  at least one write was refused
//   2  the deploy could not be attempted (missing creds, auth, network, or an
//      unreadable/malformed index file)

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assertCleanDeploySource } from './lib/clean-deploy-source.mjs'
import {
  ALLOW_DIRTY_FLAG,
  parseDeployArgs,
} from './lib/deploy-args.mjs'
import { loadLocalEnv } from './lib/firebase-rules-api.mjs'
import {
  createCompositeIndex,
  fetchLiveCompositeIndexes,
  fetchLiveFieldOverrides,
  patchFieldOverride,
  resolveDatabaseId,
  resolveWriteToken,
} from './lib/firestore-indexes-api.mjs'
import {
  compareIndexes,
  describeOverride,
  fieldResourceId,
  planIndexDeploy,
} from './lib/index-drift.mjs'

loadLocalEnv()

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const DEFAULT_FILE = `${repoRoot}cloud/firebase-firestore.indexes.json`

// This script already refused an unknown argument; what it had no answer for
// was `--help`, which it refused as unknown (exit 2) while the three rules
// deploys beside it DEPLOYED on it. One parser now serves all four, so the
// question "what does this do" has the same, safe answer everywhere.
const args = parseDeployArgs({
  command: 'deploy-firestore-indexes',
  summary:
    'Reconcile cloud/firebase-firestore.indexes.json with the live Firestore ' +
    'index configuration.',
  flags: [
    { flag: '--dry-run', key: 'dryRun', describe: 'Show the plan and change nothing.' },
    {
      flag: '--file',
      key: 'filePath',
      value: 'string',
      describe: 'Read the index config from this path instead of the default.',
    },
    ALLOW_DIRTY_FLAG,
  ],
})
const filePath = args.filePath ?? DEFAULT_FILE
const dryRun = args.dryRun
const allowDirty = args.allowDirty

const fileLabel =
  filePath === DEFAULT_FILE ? 'cloud/firebase-firestore.indexes.json' : filePath

// The same dirty-tree refusal the rules deploys carry (AGL-1489): this ships
// the WORKTREE copy of the file, so an uncommitted edit — including another
// session's work in progress in a shared checkout — would go live as a side
// effect. `--allow-dirty` is also the documented escape hatch for a tarball
// checkout with no git.
try {
  const verdict = assertCleanDeploySource(filePath, { allowDirty, fileLabel })
  if (verdict.warning) console.warn(verdict.warning)
} catch (error) {
  console.error(error.message)
  process.exit(2)
}

let indexFile
try {
  indexFile = JSON.parse(readFileSync(filePath, 'utf8'))
} catch (error) {
  console.error(`Cannot deploy: ${filePath} could not be read as JSON.`)
  console.error(`  ${error.message}`)
  process.exit(2)
}
if (
  !Array.isArray(indexFile.indexes) ||
  !Array.isArray(indexFile.fieldOverrides)
) {
  console.error(
    `Cannot deploy: ${filePath} has no \`indexes\`/\`fieldOverrides\` arrays.`,
  )
  process.exit(2)
}

/*
 * WHAT AN OPERATOR HAS TO GRANT, in one place because it is needed twice.
 *
 * Reading the live index configuration and WRITING it need different
 * permissions, and the deploy service account here had the first and not the
 * second — so this script listed 65 indexes happily and then failed 403 on
 * the first create. A raw `HTTP 403` with Google's body is not actionable:
 * the operator cannot tell a missing role from a wrong project from a
 * disabled API, and the self-hosting runbook sends them here.
 *
 * `datastore.indexes.*` are aliases the Firestore API surfaces; the predefined
 * roles grant them under the Datastore-mode name `datastore.schemas.*`, which
 * is why `roles/datastore.indexAdmin` is the minimal role that works and why
 * looking for a role whose listed permissions contain `datastore.indexes.create`
 * finds nothing — including on `roles/owner`.
 */
const ROLE_REMEDY = [
  'The service account needs permission to WRITE index configuration. Reading',
  'it needs less, which is why a listing can succeed and a create still 403.',
  '',
  '  gcloud projects add-iam-policy-binding <PROJECT_ID> \\',
  '    --member="serviceAccount:<FIREBASE_CLIENT_EMAIL>" \\',
  '    --role="roles/datastore.indexAdmin"',
  '',
  'roles/datastore.indexAdmin ("Cloud Datastore Index Admin") is the minimal',
  'role; roles/datastore.owner also works and grants a great deal more.',
].join('\n')

const auth = await resolveWriteToken()
if (auth.error) {
  console.error(
    [
      `Cannot deploy: ${auth.error}`,
      '',
      'This script needs a service account that can write Firestore index',
      'configuration on YOUR project. The self-hosting runbook sets the same',
      'three variables the rules deploys use, in .env at the repo root:',
      '  FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY',
      ROLE_REMEDY,
      '',
      'Exiting 2 (could not deploy). That is NOT the same as a clean run.',
    ].join('\n'),
  )
  process.exit(2)
}

const databaseId = resolveDatabaseId()
let liveIndexes
let liveFields
try {
  liveIndexes = await fetchLiveCompositeIndexes({ ...auth, databaseId })
  liveFields = await fetchLiveFieldOverrides({ ...auth, databaseId })
} catch (error) {
  console.error(`Cannot deploy: reading the live index config failed.`)
  console.error(`  ${error.message}`)
  console.error('Exiting 2 (could not deploy).')
  process.exit(2)
}

// The plan is computed from the SAME comparison check-index-drift.mjs makes.
// A deploy that normalized differently from the checker verifying it would
// re-create the same indexes on every run and report drift forever (AGL-1509).
const report = compareIndexes({
  liveIndexes,
  liveFields,
  fileIndexes: indexFile.indexes,
  fileOverrides: indexFile.fieldOverrides,
})
const plan = planIndexDeploy({
  report,
  fileIndexes: indexFile.indexes,
  fileOverrides: indexFile.fieldOverrides,
})

console.log(`Project:  ${auth.projectId}, database ${databaseId}`)
console.log(`File:     ${fileLabel}`)
console.log(
  `Already in place: ${report.composite.matched} composite indexes, ` +
    `${report.overrides.matched} field overrides.`,
)
console.log(
  `To deploy:        ${plan.creates.length} composite indexes, ` +
    `${plan.patches.length} field overrides.`,
)

// Reported BEFORE any write, so an operator who is about to lose something
// sees it while they can still stop. This script will not delete these; the
// Firebase CLI would.
if (plan.notDeleted.composite.length > 0) {
  console.warn(
    `\nLIVE BUT NOT IN THE FILE — composite indexes (${plan.notDeleted.composite.length}).` +
      `\n  NOT deleted by this script. \`firebase deploy --only firestore:indexes\` WOULD delete them.` +
      `\n  If they are wanted, copy them into ${fileLabel}; if not, delete them yourself, deliberately.`,
  )
  for (const key of plan.notDeleted.composite) console.warn(`  ${key}`)
}
if (plan.notDeleted.overrides.length > 0) {
  console.warn(
    `\nLIVE BUT NOT IN THE FILE — field overrides (${plan.notDeleted.overrides.length}). NOT deleted by this script.`,
  )
  for (const entry of plan.notDeleted.overrides) {
    console.warn(`  ${describeOverride(entry)}`)
  }
}
if (plan.ttlAtRisk.length > 0) {
  console.warn(
    `\n⚠️ ${plan.ttlAtRisk.length} of those carry a LIVE TTL POLICY. This is the AGL-1801 shape exactly:` +
      `\n  a reconciling index deploy would DISABLE the sweep and the documents would accumulate.` +
      `\n  This script left them alone. Add them to ${fileLabel} with "ttl": true.`,
  )
  for (const entry of plan.ttlAtRisk) {
    console.warn(`  ${entry.id} (${entry.ttlState})`)
  }
}

if (plan.empty) {
  console.log(`\nNothing to deploy: ${auth.projectId} already matches ${fileLabel}.`)
  reportTtlOwed()
  process.exit(0)
}

if (dryRun) {
  console.log('\n--dry-run: the following would be written. Nothing was sent.')
  for (const create of plan.creates) console.log(`  CREATE  ${create.key}`)
  for (const patch of plan.patches) {
    console.log(
      `  PATCH   ${patch.id}${patch.exempt ? '  (EXEMPT from indexing — this is the one that unblocks writes)' : ''}`,
    )
  }
  reportTtlOwed()
  process.exit(0)
}

let failures = 0
let forbidden = 0
let created = 0
let existed = 0

console.log('')
for (const create of plan.creates) {
  const result = await createCompositeIndex({
    ...auth,
    databaseId,
    collectionGroup: create.collectionGroup,
    body: create.body,
  })
  if (result.alreadyExists) {
    existed += 1
    console.log(`  = already present  ${create.key}`)
    continue
  }
  if (!result.ok) {
    failures += 1
    if (result.status === 403) forbidden += 1
    console.error(
      `  ✗ FAILED  ${create.key}\n      HTTP ${result.status}: ` +
        `${result.error ?? JSON.stringify(result.body?.error ?? result.body).slice(0, 300)}`,
    )
    continue
  }
  created += 1
  console.log(`  + created  ${create.key}`)
}

let patched = 0
for (const patch of plan.patches) {
  const result = await patchFieldOverride({
    ...auth,
    databaseId,
    collectionGroup: patch.collectionGroup,
    fieldResourceId: fieldResourceId(patch.fieldPath),
    body: patch.body,
  })
  if (!result.ok) {
    failures += 1
    if (result.status === 403) forbidden += 1
    console.error(
      `  ✗ FAILED  ${patch.id}\n      HTTP ${result.status}: ` +
        `${result.error ?? JSON.stringify(result.body?.error ?? result.body).slice(0, 300)}`,
    )
    continue
  }
  patched += 1
  console.log(
    `  ± patched  ${patch.id}${patch.exempt ? '  (EXEMPT from indexing)' : ''}`,
  )
}

console.log(
  `\n${created} indexes created, ${existed} already present, ${patched} field overrides patched.`,
)
reportTtlOwed()

if (failures > 0) {
  // A 403 among the failures is a MISSING ROLE, not a bad index definition,
  // and it is the one cause the operator cannot diagnose from the status line.
  if (forbidden > 0) {
    console.error(
      `\n${forbidden} write(s) were refused with HTTP 403 — this is a ` +
        `PERMISSIONS problem, not a problem with ${fileLabel}.\n\n${ROLE_REMEDY}`,
    )
  }
  console.error(
    `\n${failures} write(s) were refused. The project is PARTIALLY configured — ` +
      `re-run after fixing the cause; the accepted writes are idempotent and ` +
      `will not be duplicated.`,
  )
  process.exit(1)
}

console.log(
  [
    '',
    'Accepted. Index builds are ASYNCHRONOUS — "accepted" is not "ready", and',
    'a query against a still-building index fails exactly as it did before.',
    'Watch them finish with:',
    '  npm run check:index-drift',
    'which lists anything still BUILDING and, when it reports no drift, is the',
    'evidence that this project matches the file.',
  ].join('\n'),
)

/** What the file asks for that this script deliberately does not write. */
function reportTtlOwed() {
  if (plan.ttlOwed.length === 0) return
  console.log(
    `\nTTL OWED (${plan.ttlOwed.length}) — NOT written here, by design. Run:` +
      `\n  node tools/scripts/set-firestore-ttl.mjs` +
      `\n(see docs/FIRESTORE_MANUAL_CONFIG.md). "Not written" is not "not needed".`,
  )
  for (const entry of plan.ttlOwed) console.log(`  ${entry.id} — ${entry.why}`)
}

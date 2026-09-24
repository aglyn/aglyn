#!/usr/bin/env node
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

// Stamp `orgId` and `hostId` on the form submissions written before the
// submit route did (AGL-3303). See `docs/SUBMISSION_SCOPE_BACKFILL.md`.
//
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-submission-scope.mjs
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-submission-scope.mjs --org=<orgId>
//   GOOGLE_CLOUD_PROJECT=aglyn-main node tools/scripts/backfill-submission-scope.mjs --apply
//
// DRY RUN BY DEFAULT. `--apply` writes. Every decision is
// `lib/submission-scope-backfill.mjs`'s and pinned by its test; this file
// reads, prints and writes.
//
// ## What it does
//
// Every `hosts/{hostId}/formSubmissions/{id}` gets the site in its own path
// as `hostId` and that site's org as `orgId`, which is what the
// organization's Inbox lists it by. The org comes from the host document and
// the `hostIndex` mirror, in the submit route's order; a site whose two
// documents name different orgs is REFUSED and left for a person, and the run
// exits 1 so the refusal is not read as a clean finish.
//
// ## What it never does
//
// Touch any other field, or write a row that already carries the right pair —
// a second run plans nothing. A row deleted between the read and the write is
// counted and skipped, never recreated as a stub.
//
// ## Ordering
//
// Run once the promotion carrying AGL-3303 is live, so every submission from
// then on arrives stamped; a run before it leaves a gap that grows. `--apply`
// is refused on a checkout whose submit route does not stamp the pair or
// whose rules do not freeze it — the tell of a checkout older than the change.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  BATCH_OPERATIONS,
  collect,
  commitAll,
  connectFirestore,
  everyDocument,
} from './lib/firestore-backfill.mjs'
import {
  planSiteScope,
  routeStampsScope,
  rulesFreezeScope,
  siteOrgId,
} from './lib/submission-scope-backfill.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-submission-scope',
  summary:
    'Stamp `orgId` and `hostId` on every `hosts/{hostId}/formSubmissions` row ' +
    'that predates the submit route stamping them, so the organization Inbox ' +
    'lists it. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    {
      flag: '--apply',
      key: 'apply',
      describe: 'Write. Without it, a dry run.',
    },
    {
      flag: '--org',
      key: 'org',
      value: 'string',
      describe: 'Limit to one org id.',
    },
  ],
})
const apply = Boolean(args.apply)
const onlyOrg = args.org

/** Firestore's NOT_FOUND, which an `update` of a deleted document answers. */
const NOT_FOUND = 5

if (apply) {
  const missing = [
    routeStampsScope(read('apps/tenant/app/api/forms/submit/route.ts'))
      ? null
      : 'the submit route in this checkout does not stamp orgId and hostId',
    rulesFreezeScope(read('cloud/firebase-firestore.rules'))
      ? null
      : 'the rules in this checkout do not freeze orgId and hostId',
  ].filter(Boolean)
  if (missing.length) {
    console.error(
      `Refusing --apply: ${missing.join('; ')}. NOTHING WAS WRITTEN.`,
    )
    process.exit(2)
  }
}

function read(path) {
  return readFileSync(join(REPO_ROOT, path), 'utf8')
}

/**
 * Commit one site's writes in batches. A batch that fails is retried one
 * write at a time, so a row the Inbox deleted mid-run costs that row and not
 * the other hundreds beside it.
 */
async function applyWrites(db, submissions, writes) {
  let written = 0
  let gone = 0
  for (let start = 0; start < writes.length; start += BATCH_OPERATIONS) {
    const slice = writes
      .slice(start, start + BATCH_OPERATIONS)
      .map((write) => ({
        kind: 'update',
        ref: submissions.doc(write.id),
        value: write.patch,
      }))
    try {
      await commitAll(db, slice)
      written += slice.length
    } catch {
      for (const write of slice) {
        try {
          await write.ref.update(write.value)
          written += 1
        } catch (error) {
          if (error?.code !== NOT_FOUND) throw error
          gone += 1
        }
      }
    }
  }
  return { written, gone }
}

async function run() {
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const index = new Map(
    (await collect(db.collection('hostIndex'))).map((row) => [
      row.id,
      row.data?.orgId,
    ]),
  )

  const totals = {
    sites: 0,
    read: 0,
    stamped: 0,
    already: 0,
    corrected: 0,
    written: 0,
    gone: 0,
  }
  const skipped = []
  const refused = []
  const byOrg = new Map()

  for await (const host of everyDocument(
    db.collection('hosts').select('orgId'),
  )) {
    const hostOrgId = host.get('orgId')
    const indexOrgId = index.get(host.id)
    const decision = siteOrgId({ hostOrgId, indexOrgId })
    if (decision.refused) {
      if (!onlyOrg || hostOrgId === onlyOrg || indexOrgId === onlyOrg) {
        refused.push({ hostId: host.id, ...decision })
      }
      continue
    }
    if (decision.skipped) {
      if (!onlyOrg) skipped.push(host.id)
      continue
    }
    const { orgId } = decision
    if (onlyOrg && orgId !== onlyOrg) continue

    const submissions = db
      .collection('hosts')
      .doc(host.id)
      .collection('formSubmissions')
    const rows = []
    for await (const row of everyDocument(
      submissions.select('orgId', 'hostId'),
    )) {
      rows.push({ id: row.id, data: row.data() ?? {} })
    }
    const plan = planSiteScope({ hostId: host.id, orgId, submissions: rows })
    totals.sites += 1
    totals.read += plan.read
    totals.already += plan.alreadyStamped
    totals.stamped += plan.writes.length
    totals.corrected += plan.corrected
    const org = byOrg.get(orgId) ?? { sites: 0, stamped: 0 }
    org.sites += 1
    org.stamped += plan.writes.length
    byOrg.set(orgId, org)
    if (plan.writes.length) {
      console.log(
        `  ${orgId} / ${host.id}: ${plan.read} read, ${plan.writes.length} to stamp` +
          (plan.corrected
            ? ` (${plan.corrected} carrying a different pair, corrected)`
            : ''),
      )
    }
    if (apply && plan.writes.length) {
      const { written, gone } = await applyWrites(db, submissions, plan.writes)
      totals.written += written
      totals.gone += gone
    }
  }

  if (onlyOrg && !byOrg.size && !refused.length) {
    console.error(`No site of org ${onlyOrg} found — nothing to do.`)
    process.exitCode = 1
    return
  }
  for (const [orgId, org] of [...byOrg].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    console.log(
      `${orgId}: ${org.sites} site(s), ${org.stamped} submission(s) to stamp`,
    )
  }
  for (const row of refused) {
    console.log(
      `  REFUSED ${row.hostId}: the host names ${row.hostOrgId}, hostIndex names ${row.indexOrgId} — settle by hand`,
    )
  }
  console.log(
    `sites: ${totals.sites} scanned, ${skipped.length} with no org (left alone), ${refused.length} refused. ` +
      `submissions: ${totals.read} read, ${totals.already} already stamped, ${totals.stamped} to stamp` +
      (totals.corrected ? ` (${totals.corrected} corrected)` : ''),
  )
  if (!apply) {
    console.log('Dry run — nothing was written. Re-run with --apply.')
  } else {
    console.log(
      `wrote ${totals.written} submission(s); ${totals.gone} were deleted while this ran and were left gone`,
    )
  }
  if (refused.length) process.exitCode = 1
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})

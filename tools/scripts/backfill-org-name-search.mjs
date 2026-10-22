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

/**
 * Stamp `nameLower`, `nameTokens` and `nameReversed` onto every organization
 * whose name keys are missing or no longer match its `name` (AGL-3321).
 *
 * The staff Organizations list and the Margin & utilization scan filter and
 * search on their Firestore query: Organization "contains" and the search by
 * `array-contains` on `nameTokens`, Organization "is" by equality on
 * `nameLower` (`apps/console/utils/org-list-query.ts`). Both writers of an
 * organization's name stamp all three keys — `createOrganization` in
 * `libs/tenant/data/admin/src/lib/server/organizations.ts` and the rename in
 * `apps/console/app/api/orgs/settings/route.ts` — and the rules deny the keys
 * to every client. An organization written any other way (a seed script, a
 * hand edit) carries none of them, and a query cannot find a document by a
 * field it lacks: it still LISTS, but no name filter and no search finds it.
 *
 * The keys come from `name` through `tools/scripts/lib/name-search-tokens.mjs`,
 * the one script-side restatement of the library's normalizers, held to its
 * fixtures by `--self-test`.
 *
 * ## What it touches
 *
 * `orgs/{orgId}`, and on each only the three keys — not `name`, not
 * `updatedAt`. An organization with no string `name` is reported and left
 * alone: stamping empty keys would not make it findable by anything. Nothing
 * is deleted.
 *
 * ## Idempotence and interruption
 *
 * An organization whose three keys already equal what its name gives is never
 * written, so a re-run is a no-op and an interrupted run is finished by the
 * next.
 *
 * ## Running it
 *
 * Application Default Credentials against the project:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-org-name-search.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-org-name-search.mjs --apply  # write
 *
 *     node tools/scripts/backfill-org-name-search.mjs --self-test
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'
import {
  displayNameSearchFields,
  nameSearchKey,
  nameSearchReversed,
  nameSearchTokens,
  sameSearchTokens,
} from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-org-name-search',
  summary:
    'Stamp nameLower, nameTokens and nameReversed onto organizations whose ' +
    'name keys are missing or stale, so the staff Organizations list and the ' +
    'margin scan can filter and search them. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/**
 * What an organization should be stamped with, or why it is skipped. Pure,
 * for the self-test.
 *
 * @param {Record<string, unknown>} data the organization
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'unnamed' }}
 */
export function planOrg(data) {
  if (typeof data.name !== 'string' || !nameSearchKey(data.name)) return { skip: 'unnamed' }
  const keys = displayNameSearchFields(data.name)
  const update = {}
  if (data.nameLower !== keys.nameLower) update.nameLower = keys.nameLower
  if (!sameSearchTokens(data.nameTokens, keys.nameTokens)) update.nameTokens = keys.nameTokens
  if (data.nameReversed !== keys.nameReversed) update.nameReversed = keys.nameReversed
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'name-search-tokens.fixtures.json'), 'utf8'),
  )
  const failures = []
  const check = (name, ok) => {
    if (!ok) failures.push(name)
  }
  // The script-side keys answer the library's own worked examples.
  for (const { name, key, reversed } of fixtures.keys) {
    check(`key of ${JSON.stringify(name)}`, nameSearchKey(name) === key)
    check(`reversed key of ${JSON.stringify(name)}`, nameSearchReversed(name) === reversed)
  }
  for (const { name, tokens } of fixtures.tokens) {
    check(`tokens of ${JSON.stringify(name)}`, sameSearchTokens(nameSearchTokens(name), tokens))
  }
  const ACME = {
    nameLower: 'acme coffee',
    nameTokens: nameSearchTokens('Acme Coffee'),
    nameReversed: 'eeffoc emca',
  }
  const cases = [
    ['an organization with no keys', { name: 'Acme Coffee' }, { update: ACME }],
    ['a current organization', { name: 'Acme Coffee', ...ACME }, { skip: 'current' }],
    [
      'a rename that kept the old keys',
      { name: 'Acme Coffee', nameLower: 'acme', nameTokens: ['a', 'ac', 'acm', 'acme'], nameReversed: 'emca' },
      { update: ACME },
    ],
    [
      'only the reversed key missing',
      { name: 'Acme Coffee', nameLower: ACME.nameLower, nameTokens: ACME.nameTokens },
      { update: { nameReversed: ACME.nameReversed } },
    ],
    ['no name at all', { plan: 'pro' }, { skip: 'unnamed' }],
    ['a blank name', { name: '   ' }, { skip: 'unnamed' }],
  ]
  for (const [name, data, expected] of cases) {
    const got = planOrg(data)
    check(`${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(expected))
  }
  // Idempotent: an organization the plan stamped plans nothing the second time.
  for (const [name, data] of cases) {
    const once = planOrg(data)
    const stamped = 'update' in once ? { ...data, ...once.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planOrg(stamped))
  }
  const total = fixtures.keys.length * 2 + fixtures.tokens.length + cases.length * 2
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(failures.length ? `self-test: ${failures.length} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const totals = { orgs: 0, current: 0, unnamed: 0, stamp: 0, missing: 0, stale: 0 }
  const writes = []
  const unnamed = []
  for await (const org of everyDocument(db.collection('orgs'))) {
    totals.orgs += 1
    const data = org.data() ?? {}
    const plan = planOrg(data)
    if ('skip' in plan) {
      totals[plan.skip] += 1
      if (plan.skip === 'unnamed') unnamed.push(org.id)
      continue
    }
    totals.stamp += 1
    if (data.nameLower === undefined || data.nameTokens === undefined) totals.missing += 1
    else totals.stale += 1
    writes.push({ kind: 'update', ref: org.ref, value: plan.update })
  }
  console.log(`scanned ${totals.orgs} organizations`)
  console.log(`  already current  ${totals.current}`)
  console.log(`  to stamp         ${totals.stamp} (${totals.missing} with no keys, ${totals.stale} with stale keys)`)
  console.log(`  no name, left    ${totals.unnamed}${unnamed.length ? ` — ${unnamed.slice(0, 20).join(', ')}` : ''}`)
  if (!apply) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}

await main()

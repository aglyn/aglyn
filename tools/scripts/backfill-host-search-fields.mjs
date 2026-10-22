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
 * Stamp `nameLower`, `searchTokens` and `hasCustomDomain` onto every site
 * whose search keys are missing or no longer match it (AGL-3378).
 *
 * The staff Sites list (`/admin/sites`) filters and searches `hosts` on its
 * Firestore query (`apps/console/utils/staff-site-list-query.ts`): the search
 * by `array-contains` on `searchTokens`, Site "is" by equality on `nameLower`,
 * Custom domain by equality on `hasCustomDomain`. `syncHostProjectionForMembers`
 * stamps all three whenever a site is created, renamed, or connects or
 * releases a domain (`hostSearchFields` in
 * `libs/tenant/data/admin/src/lib/server/host-memberships.ts`). A site written
 * before that carries none of them, and a query cannot find a document by a
 * field it lacks: it still LISTS, but no search and no Site or Custom domain
 * filter finds it.
 *
 * The keys come from the site's `displayName`, `subdomain` and `cname` through
 * `tools/scripts/lib/host-membership-search-tokens.mjs`, the script-side twin
 * the membership backfill already holds to the library's fixtures.
 *
 * ## What it touches
 *
 * `hosts/{hostId}`, and on each only the three keys. Nothing is deleted, and
 * `updatedAt` is not moved: nothing about the site changed.
 *
 * ## Idempotence and interruption
 *
 * A site whose keys already equal what it gives is never written, so a re-run
 * is a no-op and an interrupted run is finished by the next.
 *
 * ## Running it
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-host-search-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-host-search-fields.mjs --apply  # write
 *
 *     node tools/scripts/backfill-host-search-fields.mjs --self-test
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { commitAll, connectFirestore, everyDocument } from './lib/firestore-backfill.mjs'
import {
  hasCustomDomain,
  hostMembershipSearchTokens,
} from './lib/host-membership-search-tokens.mjs'
import { nameSearchKey, sameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(here, '..', '..')

const args = parseDeployArgs({
  command: 'backfill-host-search-fields',
  summary:
    'Stamp nameLower, searchTokens and hasCustomDomain onto sites whose search ' +
    'keys are missing or stale, so the staff Sites list can filter and search ' +
    'them. Writes to the named project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/**
 * What a site should be stamped with, or that it is current. Pure, for the
 * self-test, so the dry run and the apply run cannot disagree.
 *
 * @param {Record<string, unknown>} data the site
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' }}
 */
export function planHost(data) {
  const update = {}
  const nameLower = nameSearchKey(typeof data.displayName === 'string' ? data.displayName : '')
  if (data.nameLower !== nameLower) update.nameLower = nameLower
  const tokens = hostMembershipSearchTokens(data)
  if (!sameSearchTokens(data.searchTokens, tokens)) update.searchTokens = tokens
  const custom = hasCustomDomain(data)
  if (data.hasCustomDomain !== custom) update.hasCustomDomain = custom
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  const failures = []
  const check = (name, ok) => {
    if (!ok) failures.push(name)
  }
  const HOST = { displayName: 'Harbor Bakery', subdomain: 'harbor-bakery' }
  const KEYS = {
    nameLower: 'harbor bakery',
    searchTokens: hostMembershipSearchTokens(HOST),
    hasCustomDomain: false,
  }
  const DOMAIN = { ...HOST, cname: 'shop.harbor.com' }
  const cases = [
    ['a site with no keys', HOST, { update: KEYS }],
    ['a current site', { ...HOST, ...KEYS }, { skip: 'current' }],
    [
      'a renamed site that kept the old keys',
      { ...HOST, ...KEYS, displayName: 'Harbor Cafe' },
      {
        update: {
          nameLower: 'harbor cafe',
          searchTokens: hostMembershipSearchTokens({ ...HOST, displayName: 'Harbor Cafe' }),
        },
      },
    ],
    [
      'a site that connected a domain',
      { ...DOMAIN, ...KEYS },
      { update: { searchTokens: hostMembershipSearchTokens(DOMAIN), hasCustomDomain: true } },
    ],
    [
      'a site with no name still gets its subdomain tokens',
      { subdomain: 'harbor-bakery' },
      {
        update: {
          nameLower: '',
          searchTokens: hostMembershipSearchTokens({ subdomain: 'harbor-bakery' }),
          hasCustomDomain: false,
        },
      },
    ],
  ]
  for (const [name, data, expected] of cases) {
    const got = planHost(data)
    check(
      `${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`,
      JSON.stringify(got) === JSON.stringify(expected),
    )
    const stamped = 'update' in got ? { ...data, ...got.update } : data
    check(`${name}: re-run is a no-op`, 'skip' in planHost(stamped))
  }
  // `bakery` finds the site by the second word of its subdomain.
  check('a subdomain tail is a token', KEYS.searchTokens.includes('bakery'))
  const total = cases.length * 2 + 1
  for (const failure of failures) console.error(`FAIL ${failure}`)
  console.log(
    failures.length
      ? `self-test: ${failures.length} of ${total} failed`
      : `self-test: ${total}/${total} passed`,
  )
  process.exit(failures.length ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const apply = Boolean(args.apply)
  const db = connectFirestore({ repoRoot: REPO_ROOT, apply })
  const totals = { hosts: 0, current: 0, stamp: 0, missing: 0 }
  const writes = []
  for await (const host of everyDocument(db.collection('hosts'))) {
    totals.hosts += 1
    const data = host.data() ?? {}
    const plan = planHost(data)
    if ('skip' in plan) {
      totals.current += 1
      continue
    }
    totals.stamp += 1
    if (data.searchTokens === undefined) totals.missing += 1
    writes.push({ kind: 'update', ref: host.ref, value: plan.update })
  }
  console.log(`scanned ${totals.hosts} sites`)
  console.log(`  already current  ${totals.current}`)
  console.log(
    `  to stamp         ${totals.stamp} (${totals.missing} with no keys, ${totals.stamp - totals.missing} with stale keys)`,
  )
  if (!apply) {
    console.log(`DRY RUN — ${writes.length} writes planned, NOTHING WAS WRITTEN.`)
    return
  }
  await commitAll(db, writes)
  console.log(`APPLIED — ${writes.length} writes committed.`)
}

await main()

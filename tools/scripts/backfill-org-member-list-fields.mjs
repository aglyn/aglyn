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

/**
 * Stamp `consoleUserType` and `searchTokens` onto every organization member
 * written before them (AGL-3321).
 *
 * The organization's Members card filters its roster by Access (an equality
 * on `consoleUserType`) and searches a member's name, address and job title
 * (`array-contains` on `searchTokens`), both on the roster's query through
 * `GET /api/orgs/members`. `syncOrgAuthProjections` stamps both on every
 * member whenever any membership in the organization changes, and
 * `createOrganization` stamps its owner; a roster nobody has touched since
 * carries neither, and a query cannot find a document by a field it lacks.
 *
 * Both are derived from the member document through
 * `lib/org-member-list-fields.mjs`, the script-side twin of the library's
 * `orgMemberListFields`, held to the fixtures both sides assert.
 *
 * ## Idempotence and interruption
 *
 * A member whose two fields already equal what its document makes is never
 * written, so a re-run is a no-op and an interrupted run is finished by the
 * next. Writes touch only the two fields, in batches of 400. Nothing is
 * deleted. Only `orgs/{orgId}/members/{uid}` is touched: the scan is a
 * collection group, and the site rosters (`hosts/{hostId}/members`) and list
 * memberships of the same name are counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-org-member-list-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-org-member-list-fields.mjs --apply  # write
 *     node tools/scripts/backfill-org-member-list-fields.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { sameSearchTokens } from './lib/name-search-tokens.mjs'
import { orgMemberListFields } from './lib/org-member-list-fields.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const args = parseDeployArgs({
  command: 'backfill-org-member-list-fields',
  summary:
    'Stamp `consoleUserType` and `searchTokens` onto organization members ' +
    'written before them. Writes to the live project with --apply.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
    { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
  ],
})

/** Documents per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 1000

/**
 * What one member document needs, or why it is left alone. Pure, for the
 * self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-an-org-member' }}
 */
export function planOrgMember(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'orgs' || segments[2] !== 'members') {
    return { skip: 'not-an-org-member' }
  }
  const wanted = orgMemberListFields(data)
  const update = {}
  if (data.consoleUserType !== wanted.consoleUserType) update.consoleUserType = wanted.consoleUserType
  if (!sameSearchTokens(data.searchTokens, wanted.searchTokens)) update.searchTokens = wanted.searchTokens
  return Object.keys(update).length ? { update } : { skip: 'current' }
}

function selfTest() {
  let failed = 0
  let total = 0
  const check = (name, got, expected) => {
    total += 1
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      failed += 1
      console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
    }
  }
  // The worked examples the library's spec asserts against the writer.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'org-member-list-fields.fixtures.json'), 'utf8'),
  )
  check('the fixtures are there to answer', fixtures.cases.length > 4, true)
  for (const one of fixtures.cases) check(`fixture: ${one.name}`, orgMemberListFields(one.member), one.expected)

  const ADA = { role: 'owner', allHosts: true, displayName: 'Ada', email: 'ada@example.com' }
  const FIELDS = orgMemberListFields(ADA)
  const cases = [
    ['a member written before the fields', 'orgs/o1/members/u1', ADA, { update: FIELDS }],
    ['a stamped member', 'orgs/o1/members/u1', { ...ADA, ...FIELDS }, { skip: 'current' }],
    ['a member whose reach changed without a re-stamp', 'orgs/o1/members/u1',
      { ...ADA, ...FIELDS, consoleUserType: 'collaborator' }, { update: { consoleUserType: 'manager' } }],
    ['a site roster of the same name', 'hosts/h1/members/u1', ADA, { skip: 'not-an-org-member' }],
    ['a list membership of the same name', 'orgs/o1/lists/l1/members/u1', ADA, { skip: 'not-an-org-member' }],
  ]
  for (const [name, path, data, expected] of cases) {
    const once = planOrgMember(path, data)
    check(name, once, expected)
    // Idempotent: what the plan stamped plans nothing the second time.
    const stamped = 'update' in once ? { ...data, ...once.update } : data
    check(`${name}: re-run`, 'update' in planOrgMember(path, stamped), false)
  }
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = {
    scanned: 0,
    current: 0,
    stale: 0,
    consoleUserType: 0,
    searchTokens: 0,
    otherCollections: 0,
    written: 0,
  }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('members').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planOrgMember(doc.ref.path, doc.data())
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.otherCollections += 1
        continue
      }
      counts.stale += 1
      if ('consoleUserType' in plan.update) counts.consoleUserType += 1
      if ('searchTokens' in plan.update) counts.searchTokens += 1
      if (!args.apply) continue
      batch.update(doc.ref, plan.update)
      pending += 1
      if (pending >= BATCH) {
        const full = batch
        batch = firestore.batch()
        pending = 0
        await full.commit()
        counts.written += BATCH
      }
    }
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < PAGE) break
  }
  if (args.apply && pending) {
    await batch.commit()
    counts.written += pending
  }
  console.log(
    args.apply
      ? 'backfill-org-member-list-fields: APPLIED'
      : 'backfill-org-member-list-fields: DRY RUN (nothing written)',
  )
  console.log(`  scanned (every members group)      ${counts.scanned}`)
  console.log(`  org members already stamped        ${counts.current}`)
  console.log(`  org members to stamp               ${counts.stale}`)
  console.log(`    consoleUserType                  ${counts.consoleUserType}`)
  console.log(`    searchTokens                     ${counts.searchTokens}`)
  console.log(`  not orgs/*/members (left alone)    ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                            ${counts.written}`)
}

await main()

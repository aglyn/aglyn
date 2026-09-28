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
 * Stamp the Site users list's search fields onto every site member written
 * before them (AGL-3321): `displayNameLower` and `displayNameTokens` (the
 * Name filter's `equals` and `contains`) and `searchTokens` (the quick
 * search, a word of the name or of the address).
 *
 * The console's Site users list (`hosts/{hostId}/siteMembers`) asks for all
 * three beneath its newest-first order. Both writers — sign-up and the
 * member's own account form — stamp them through `memberNameSearchFields`
 * and `memberSearchTokens` in
 * `libs/plugins/commerce/src/lib/server/member-name-search.ts`, but a member
 * written before that carries none, and a query cannot find a document that
 * lacks a field: such a member still LISTS, and no search finds them.
 *
 * The keys come from the script-side twins of the library's builders —
 * `lib/name-search-tokens.mjs` (name keys and word-prefix tokens) and
 * `lib/activity-search-tokens.mjs` (the words of an address) — each held to
 * the fixtures its library's spec asserts. The two compositions below are
 * the writer's own: the name as its key and tokens, and the address's words
 * beside the name as the search tokens.
 *
 * ## Idempotence and interruption
 *
 * A member whose fields already equal what their `displayName` and `email`
 * make is never written, so a re-run is a no-op and an interrupted run is
 * finished by the next. A member with no display name gets `searchTokens`
 * alone — the address still finds them, and the writers stamp no name keys
 * for one either. Writes touch only these fields, in batches of 400.
 * Nothing is deleted.
 *
 * Only `hosts/{hostId}/siteMembers/{id}` is touched: the scan is a
 * collection group, and any other collection that happens to be named
 * `siteMembers` is counted and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-site-member-search.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-site-member-search.mjs --apply  # write
 *     node tools/scripts/backfill-site-member-search.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { addressSearchWords } from './lib/activity-search-tokens.mjs'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { nameSearchKey, nameSearchTokens, sameSearchTokens } from './lib/name-search-tokens.mjs'

const args = parseDeployArgs({
  command: 'backfill-site-member-search',
  summary:
    'Stamp `displayNameLower`, `displayNameTokens` and `searchTokens` onto ' +
    'site members written before them. Writes to the live project with --apply.',
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
 * The fields a member's name and address make: `memberNameSearchFields`'
 * keys (for a named member) and `memberSearchTokens`.
 *
 * @param {Record<string, unknown>} data the member document
 * @returns {{ displayNameLower?: string, displayNameTokens?: string[], searchTokens: string[] }}
 */
export function memberSearchFields(data) {
  const name = typeof data.displayName === 'string' ? data.displayName : ''
  return {
    // The writers stamp the name keys only for a truthy name, and so does this.
    ...(name
      ? { displayNameLower: nameSearchKey(name), displayNameTokens: nameSearchTokens(name) }
      : {}),
    searchTokens: nameSearchTokens([...addressSearchWords(data.email), name].join(' ')),
  }
}

/**
 * What a site member document needs, or why it is left alone. Pure, for the
 * self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'not-a-site-member' }}
 */
export function planSiteMember(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'siteMembers') {
    return { skip: 'not-a-site-member' }
  }
  const wanted = memberSearchFields(data)
  const update = {}
  if ('displayNameLower' in wanted && data.displayNameLower !== wanted.displayNameLower) {
    update.displayNameLower = wanted.displayNameLower
  }
  if ('displayNameTokens' in wanted && !sameSearchTokens(data.displayNameTokens, wanted.displayNameTokens)) {
    update.displayNameTokens = wanted.displayNameTokens
  }
  if (!sameSearchTokens(data.searchTokens, wanted.searchTokens)) {
    update.searchTokens = wanted.searchTokens
  }
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
  // The compositions `member-name-search.spec.ts` asserts against the writer.
  const ADA = memberSearchFields({ displayName: 'Ada Lovelace', email: 'ada@example.com' })
  check('the name keys', [ADA.displayNameLower, ADA.displayNameTokens], [
    'ada lovelace',
    nameSearchTokens('Ada Lovelace'),
  ])
  for (const typed of ['ada', 'lovelace', 'example', 'example.com', 'ada@exa']) {
    check(`search finds Ada by "${typed}"`, ADA.searchTokens.includes(typed), true)
  }
  const NAMELESS = memberSearchFields({ email: 'ops@acme.io' })
  check('a nameless member has no name keys', 'displayNameLower' in NAMELESS, false)
  check('a nameless member is found by the address', NAMELESS.searchTokens.includes('acme'), true)

  const cases = [
    ['a member written before the fields', 'hosts/h1/siteMembers/m1',
      { displayName: 'Ada Lovelace', email: 'ada@example.com' }, { update: ADA }],
    ['a stamped member', 'hosts/h1/siteMembers/m2',
      { displayName: 'Ada Lovelace', email: 'ada@example.com', ...ADA }, { skip: 'current' }],
    ['a member whose tokens lag a rename', 'hosts/h1/siteMembers/m3',
      { displayName: 'Ada Lovelace', email: 'ada@example.com', ...ADA, displayNameTokens: ['x'] },
      { update: { displayNameTokens: ADA.displayNameTokens } }],
    ['a member with no name', 'hosts/h1/siteMembers/m4', { email: 'ops@acme.io' },
      { update: { searchTokens: NAMELESS.searchTokens } }],
    ['another collection', 'orgs/o1/siteMembers/m6', { displayName: 'Ada' }, { skip: 'not-a-site-member' }],
    ['a subcollection below a member', 'hosts/h1/siteMembers/m7/notes/n1', { displayName: 'Ada' },
      { skip: 'not-a-site-member' }],
  ]
  for (const [name, path, data, expected] of cases) {
    const once = planSiteMember(path, data)
    check(name, once, expected)
    // Idempotent: what the plan stamped plans nothing the second time.
    const stamped = 'update' in once ? { ...data, ...once.update } : data
    check(`${name}: re-run`, 'update' in planSiteMember(path, stamped), false)
  }
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function main() {
  if (args.selfTest) return selfTest()
  initializeApp({ credential: applicationDefault() })
  const firestore = getFirestore()
  const counts = { scanned: 0, current: 0, stale: 0, otherCollections: 0, written: 0 }
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = firestore.collectionGroup('siteMembers').orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planSiteMember(doc.ref.path, doc.data())
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.otherCollections += 1
        continue
      }
      counts.stale += 1
      if (!args.apply) continue
      batch.update(doc.ref, plan.update)
      pending += 1
      if (pending >= BATCH) {
        await batch.commit()
        counts.written += pending
        batch = firestore.batch()
        pending = 0
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
      ? 'backfill-site-member-search: APPLIED'
      : 'backfill-site-member-search: DRY RUN (nothing written)',
  )
  console.log(`  scanned                          ${counts.scanned}`)
  console.log(`  already stamped                  ${counts.current}`)
  console.log(`  to stamp                         ${counts.stale}`)
  console.log(`  not hosts/*/siteMembers (left alone) ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                          ${counts.written}`)
}

await main()

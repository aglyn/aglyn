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
 * Stamp `displayNameLower` and `displayNameTokens` onto every site member
 * whose display name predates them (AGL-3321).
 *
 * The console's Site users list (`hosts/{hostId}/siteMembers`) searches names
 * by `array-contains` on `displayNameTokens` and filters Name by equality on
 * `displayNameLower`, both beneath its newest-first order. Both writers of a
 * display name — sign-up and the member's own account form — stamp the two
 * through `memberNameSearchFields` in
 * `libs/plugins/commerce/src/lib/server/member-name-search.ts`, but a member
 * named before that carries neither, and a query cannot find a document that
 * lacks a field: such a member still LISTS, and no search finds them.
 *
 * ## KEEP IN SYNC
 *
 * The derivation below restates `nameSearchKey` and `nameSearchTokens` from
 * `libs/aglyn/src/lib/app-utils/name-search.ts`, which a plain Node script
 * cannot import. Both are held to the same worked examples,
 * `lib/site-member-name-search.fixtures.json`: the commerce library's
 * `member-name-search.spec.ts` asserts them against the writer, and
 * `--self-test` asserts them against this copy.
 *
 * ## Idempotence and interruption
 *
 * A member whose two fields already equal what their `displayName` makes is
 * never written, so a re-run is a no-op and an interrupted run is finished by
 * the next. A member with no display name is left alone — there is no name
 * to search them by, and the writers stamp nothing for one either. Writes
 * touch only the two fields, in batches of 400. Nothing is deleted.
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
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-site-member-name-search.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-site-member-name-search.mjs --apply  # write
 *     node tools/scripts/backfill-site-member-name-search.mjs --self-test                             # fixtures only
 *
 * A self-hosted install runs the same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const args = parseDeployArgs({
  command: 'backfill-site-member-name-search',
  summary:
    'Stamp `displayNameLower` and `displayNameTokens` onto site members named ' +
    'before them. Writes to the live project with --apply.',
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
/** `NAME_TOKEN_MAX_PREFIX` and `NAME_TOKEN_LIMIT` in `app-utils/name-search`. */
const TOKEN_MAX_PREFIX = 12
const TOKEN_LIMIT = 120

/** `nameSearchKey`: trimmed, inner whitespace collapsed, lower-cased. */
function nameKey(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** `nameSearchTokens`: every prefix, to the cap, of every word. */
function nameTokens(name) {
  const key = nameKey(name)
  if (!key) return []
  const tokens = new Set()
  for (const word of key.split(' ')) {
    if (!word) continue
    const capped = word.slice(0, TOKEN_MAX_PREFIX)
    for (let end = 1; end <= capped.length; end += 1) {
      tokens.add(capped.slice(0, end))
      if (tokens.size >= TOKEN_LIMIT) return [...tokens]
    }
  }
  return [...tokens]
}

/** `memberNameSearchFields`, restated. */
export function memberNameSearchFields(displayName) {
  return {
    displayName,
    displayNameLower: nameKey(displayName),
    displayNameTokens: nameTokens(displayName),
  }
}

const sameTokens = (a, b) =>
  Array.isArray(a) && a.length === b.length && a.every((token, at) => token === b[at])

/**
 * What a site member document needs, or why it is left alone. Pure, for the
 * self-test.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @returns {{ update: Record<string, unknown> } | { skip: 'current' | 'no-name' | 'not-a-site-member' }}
 */
export function planSiteMember(path, data) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'siteMembers') {
    return { skip: 'not-a-site-member' }
  }
  // The writers stamp only a truthy name, and so does this.
  if (typeof data.displayName !== 'string' || !data.displayName) return { skip: 'no-name' }
  const { displayNameLower, displayNameTokens } = memberNameSearchFields(data.displayName)
  const update = {}
  if (data.displayNameLower !== displayNameLower) update.displayNameLower = displayNameLower
  if (!sameTokens(data.displayNameTokens, displayNameTokens)) update.displayNameTokens = displayNameTokens
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
  // The worked examples `member-name-search.spec.ts` asserts against the writer.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'site-member-name-search.fixtures.json'), 'utf8'),
  )
  fixtures.cases.forEach((one, at) =>
    check(`fixture #${at} (${one.displayName})`, memberNameSearchFields(one.displayName), one.expected),
  )

  const ADA = memberNameSearchFields('Ada Lovelace')
  const cases = [
    ['a member named before the fields', 'hosts/h1/siteMembers/m1', { displayName: 'Ada Lovelace' },
      { update: { displayNameLower: ADA.displayNameLower, displayNameTokens: ADA.displayNameTokens } }],
    ['a stamped member', 'hosts/h1/siteMembers/m2', { ...ADA }, { skip: 'current' }],
    ['a member whose tokens lag a rename', 'hosts/h1/siteMembers/m3',
      { ...ADA, displayNameTokens: ['x'] }, { update: { displayNameTokens: ADA.displayNameTokens } }],
    ['a member with no name', 'hosts/h1/siteMembers/m4', { email: 'a@example.test' }, { skip: 'no-name' }],
    ['a blank name', 'hosts/h1/siteMembers/m5', { displayName: '' }, { skip: 'no-name' }],
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
  const counts = { scanned: 0, current: 0, noName: 0, stale: 0, otherCollections: 0, written: 0 }
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
        else if (plan.skip === 'no-name') counts.noName += 1
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
      ? 'backfill-site-member-name-search: APPLIED'
      : 'backfill-site-member-name-search: DRY RUN (nothing written)',
  )
  console.log(`  scanned                          ${counts.scanned}`)
  console.log(`  already stamped                  ${counts.current}`)
  console.log(`  no display name (left alone)     ${counts.noName}`)
  console.log(`  to stamp                         ${counts.stale}`)
  console.log(`  not hosts/*/siteMembers (left alone) ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                          ${counts.written}`)
}

await main()

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
// The id-minting guard's forced reds (AGL-3079). Each fixture is a shape the
// guard exists to refuse, or one it must leave alone, so a detector that
// stopped seeing a site fails here before it reports green over the tree.
//
//   npm run test:id-minting

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

import {
  ID_MINTING_CEILING,
  allowlistSize,
  ceilingProblems,
  compareToAllowlist,
  findIdMintingSites,
  isIdMintingSource,
  rowProblems,
  siteKey,
} from './id-minting.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/** The sites one snippet holds, as `kind site`. */
const sitesIn = (text, path = 'libs/example/src/lib/server/example.ts') =>
  findIdMintingSites(path, text).map((site) => `${site.kind} ${site.site}`)

describe('what the guard refuses', () => {
  it('THE POINT: a `.doc()` in a resource collection, split over lines like any other call', () => {
    const planted = `
      export async function createScreen(hostRef) {
        const ref = hostRef
          .collection('screens')
          // a comment inside the chain
          .doc()
        await ref.set({ displayName: 'Home' })
      }`
    assert.deepEqual(sitesIn(planted), ["auto-id hostRef.collection('screens').doc()"])
  })

  it('finds `.add` on a collection however the collection is reached', () => {
    const text = `
      import type { CollectionReference } from 'firebase-admin/firestore'
      export async function run(db, orgRef, typed: CollectionReference) {
        await db.collection('orgs').doc('o').collection('tasks').add({ title: 'a' })
        const deals = orgRef.collection('deals')
        await deals.add({ title: 'b' })
        const contacts = await orgDataCollectionForHost('host-1')
        await contacts.add({ email: 'c' })
        await typed.add({ d: 1 })
        await jobsCollection(db, 'o').add({ e: 1 })
      }`
    assert.deepEqual(sitesIn(text), [
      "auto-id db.collection('orgs').doc('o').collection('tasks').add(…)",
      'auto-id deals.add(…)',
      'auto-id contacts.add(…)',
      'auto-id typed.add(…)',
      "auto-id jobsCollection(db, 'o').add(…)",
    ])
  })

  it('finds the modular SDK’s auto-ids', () => {
    const text = `
      import { addDoc, collection, doc } from 'firebase/firestore'
      export async function run(firestore, hostId) {
        await addDoc(collection(firestore, 'hosts', hostId, 'activity'), { a: 1 })
        const folder = doc(collection(firestore, 'hosts', hostId, 'mediaFolders'))
        const col = collection(firestore, 'adminAudit')
        const audit = doc(col)
        return [folder, audit]
      }`
    assert.deepEqual(sitesIn(text, 'apps/console/components/example.tsx'), [
      "auto-id addDoc(collection(firestore, 'hosts', hostId, 'activity'), …)",
      "auto-id doc(collection(firestore, 'hosts', hostId, 'mediaFolders'))",
      'auto-id doc(col)',
    ])
  })

  it('finds an id derived from other ids, inline or through a const', () => {
    const text = `
      export async function run(db, job, index, a, b, hostId, screenId, day) {
        await db.collection('hosts').doc(hostId).collection('layouts').doc(\`\${job.$id}-c\${index}\`).set({})
        const id = \`\${a}_\${b}\`
        await db.collection('pairs').doc(id).set({})
        await db.collection('pairs').doc(a + ':' + b).set({})
        await db.doc(\`hosts/\${hostId}/screenAnalytics/\${screenId}:\${day}\`).get()
      }`
    assert.deepEqual(
      findIdMintingSites('libs/example/src/lib/example.ts', text).map((site) => [site.kind, site.via ?? null]),
      [
        ['derived', null],
        ['derived', 'id = `${a}_${b}`'],
        ['derived', null],
        ['derived', null],
      ],
    )
  })

  it('finds an id from a helper that is not the platform’s', () => {
    const text = `
      import { randomBytes, randomUUID } from 'node:crypto'
      import { customAlphabet, nanoid } from 'nanoid'
      const makeId = customAlphabet('abc', 8)
      export async function run(db) {
        await db.collection('a').doc(randomUUID()).set({})
        await db.collection('b').doc(crypto.randomUUID()).set({})
        const token = randomBytes(16).toString('hex')
        await db.collection('c').doc(token).set({})
        await db.collection('d').doc(makeId()).set({})
        await db.collection('e').doc(nanoid()).set({})
        await db.collection('f').doc(\`x-\${randomUUID()}\`).set({})
      }`
    assert.deepEqual(
      findIdMintingSites('libs/example/src/lib/example.ts', text).map((site) => site.kind),
      ['uid-helper', 'uid-helper', 'uid-helper', 'uid-helper', 'uid-helper', 'derived'],
    )
  })
})

describe('what the guard leaves alone', () => {
  it('ignores Sets, class lists and refs, which also have `.add`', () => {
    const text = `
      export function run(el, ref, items) {
        const seen = new Set()
        seen.add('a')
        new Set(items).add('b')
        el.classList.add('open')
        ref.current.add('c')
        const byKey = new Map()
        byKey.get('k')?.add('d')
      }`
    assert.deepEqual(sitesIn(text), [])
  })

  it('ignores a document addressed by an id it was handed, a path, a named key and the platform’s id', () => {
    const text = `
      import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
      import { doc } from 'firebase/firestore'
      export async function run(db, firestore, hostId, input, slug, listingId, email) {
        await db.collection('hosts').doc(hostId).get()
        await db.collection('hosts').doc(String(input.id)).get()
        await db.doc(\`orgSlugs/\${slug}\`).get()
        await db.collection('suppressions').doc(suppressionId(email)).get()
        await db.collection('screens').doc(createResourceUid()).set({})
        const id = createResourceUid()
        await db.collection('layouts').doc(id).set({})
        await doc(firestore, 'marketplaceListings', listingId || '-missing-')
        await doc(firestore, 'hosts', hostId, 'discounts', input.id ?? createResourceUid())
      }`
    assert.deepEqual(sitesIn(text), [])
  })

  it('reads only shipped source: never a spec, a fixture, an e2e script or a declaration', () => {
    for (const path of [
      'libs/plugins/crm/src/lib/server/task-routes.ts',
      'apps/console/components/media/media-library.component.tsx',
      'tools/scripts/place-demo-plugin-node.mjs',
      'cloud/functions/src/index.ts',
    ]) {
      assert.equal(isIdMintingSource(path), true, path)
    }
    for (const path of [
      'libs/plugins/ai/src/lib/jobs/ai-jobs.spec.ts',
      'tools/scripts/lib/id-minting.test.mjs',
      'libs/plugins/ai/src/lib/jobs/fixtures/ai-page-briefs.ts',
      'apps/console-e2e/src/support/commands.ts',
      'tools/e2e/launch-smoke.e2e.mjs',
      'types/firebase.d.ts',
      'libs/aglyn/src/lib/__mocks__/firestore.ts',
      'cloud/rules-tests/tenant.spec.mjs',
      'libs/aglyn/README.md',
    ]) {
      assert.equal(isIdMintingSource(path), false, path)
    }
  })
})

describe('a site’s key', () => {
  it('is the same however the call is laid out or commented, and `.add` leaves out its data', () => {
    const one = findIdMintingSites('a.ts', "db.collection('adminAudit').add({ a: 1 })")
    const two = findIdMintingSites(
      'a.ts',
      `db
        .collection('adminAudit') // who did what
        .add({
          a: 1,
          b: 2,
        })`,
    )
    assert.equal(siteKey(one[0]), "a.ts: db.collection('adminAudit').add(…)")
    assert.equal(siteKey(two[0]), siteKey(one[0]))
  })
})

describe('the allowlist', () => {
  const row = (site, extra = {}) => ({ site, class: 'RECORD', reason: 'An internal row nobody addresses.', ...extra })
  const found = (path, site, line = 1) => ({ path, site, line, kind: 'auto-id' })

  it('is red for a site no row covers, and for one more of a call than its row counts', () => {
    const { unlisted } = compareToAllowlist(
      [found('a.ts', 'x.doc()'), found('b.ts', 'y.doc()', 1), found('b.ts', 'y.doc()', 9)],
      { sites: [row('b.ts: y.doc()')] },
    )
    assert.deepEqual(
      unlisted.map((entry) => [entry.key, entry.found.length, entry.allowed]),
      [
        ['a.ts: x.doc()', 1, 0],
        ['b.ts: y.doc()', 2, 1],
      ],
    )
  })

  it('is red for a row no site matches: the list cannot outlive what it excuses', () => {
    const { stale, unlisted } = compareToAllowlist([found('b.ts', 'y.doc()')], {
      sites: [row('a.ts: x.doc()'), row('b.ts: y.doc()', { count: 2 })],
    })
    assert.deepEqual(unlisted, [])
    assert.deepEqual(stale, [
      { key: 'a.ts: x.doc()', have: 0, allowed: 1 },
      { key: 'b.ts: y.doc()', have: 1, allowed: 2 },
    ])
  })

  it('refuses a row without a class, a reason, or for a RESOURCE debt its area issue', () => {
    assert.deepEqual(rowProblems(row('a.ts: x.doc()')), [])
    assert.match(rowProblems(row('a.ts: x.doc()', { class: 'OTHER' })).join(), /class must be/)
    assert.match(rowProblems(row('a.ts: x.doc()', { reason: '' })).join(), /reason/)
    assert.match(rowProblems(row('a.ts: x.doc()', { class: 'RESOURCE' })).join(), /area issue/)
    assert.deepEqual(rowProblems(row('a.ts: x.doc()', { class: 'RESOURCE', issue: 'AGL-3083' })), [])
    assert.match(rowProblems(row('a.ts: x.doc()', { count: 1 })).join(), /count/)
    assert.match(rowProblems({ ...row('x.doc()') }).join(), /site must be/)
    const { invalid } = compareToAllowlist([], { sites: [row('a.ts: x.doc()'), row('a.ts: x.doc()')] })
    assert.match(invalid.map((entry) => entry.problems.join()).join(), /listed twice/)
  })

  it('may only shrink: red above its ceiling, and red below it until the ceiling follows', () => {
    const ceiling = { sites: 10, toFix: 4 }
    assert.deepEqual(ceilingProblems({ sites: 10, toFix: 4 }, ceiling), [])
    assert.match(ceilingProblems({ sites: 11, toFix: 4 }, ceiling).join(), /may only shrink/)
    assert.match(ceilingProblems({ sites: 10, toFix: 5 }, ceiling).join(), /may only shrink/)
    assert.match(ceilingProblems({ sites: 9, toFix: 4 }, ceiling).join(), /lower ID_MINTING_CEILING\.sites to 9/)
    assert.equal(allowlistSize({ sites: [row('a.ts: x.doc()', { count: 3 }), row('b.ts: y.doc()', { class: 'RESOURCE', issue: 'AGL-1' })] }).sites, 4)
  })

  it('the file on disk is well formed, at its ceiling, and its ceiling never above the first one written', () => {
    const allowlist = JSON.parse(readFileSync(join(ROOT, 'tools/scripts/id-minting-allowlist.json'), 'utf8'))
    for (const entry of allowlist.sites) assert.deepEqual([entry.site, rowProblems(entry)], [entry.site, []])
    assert.deepEqual(ceilingProblems(allowlistSize(allowlist)), [])
    // May shrink; must never grow. 173 sites, 39 of them RESOURCE debts, when the list was written.
    assert.ok(ID_MINTING_CEILING.sites <= 173, `the ceiling grew to ${ID_MINTING_CEILING.sites}`)
    assert.ok(ID_MINTING_CEILING.toFix <= 39, `the RESOURCE ceiling grew to ${ID_MINTING_CEILING.toFix}`)
  })
})

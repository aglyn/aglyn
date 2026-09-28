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
 * Stamp `collectionIds` — the smart collections each product's rules answer —
 * onto every product (AGL-3321).
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=<project-id> \
 *     node tools/scripts/backfill-product-collection-ids.mjs [--apply] [--host=<hostId>]
 *
 *   node tools/scripts/backfill-product-collection-ids.mjs --self-test
 *
 * DRY RUN BY DEFAULT. Credentials are Application Default Credentials.
 *
 * ## What the field is
 *
 * The storefront reads a smart collection whose rules no query can express (a
 * NOT, an OR, a name rule, a price over) as `collectionIds array-contains
 * <id>`. Every product writer stamps the array from the site's smart
 * collections, and the commerce `collection-membership` route re-stamps it
 * whenever a smart collection changes. Products written before either did
 * carry no membership, and such a collection lists none of them until this
 * runs.
 *
 * ## What it touches
 *
 * For each site: its smart catalog collections, then every product, in
 * document order. A product whose stored array already equals the one its
 * rules give is not written, so a re-run is a no-op and a cut-short run is
 * finished by the next. An empty membership on a product that stores none is
 * current. Only `collectionIds` is written; nothing is deleted.
 *
 * The membership is derived by `lib/product-collection-ids.mjs`, the one
 * script-side twin of `productCollectionIds`, held to the fixtures the
 * commerce library's spec asserts too.
 */
import { pathToFileURL } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { liftForMembership, productCollectionIds } from './lib/product-collection-ids.mjs'

/** Products read, and at most written, per batch. Firestore allows 500. */
const BATCH = 400

const same = (stored, wanted) =>
  (Array.isArray(stored) ? stored : []).length === wanted.length &&
  wanted.every((id, at) => stored[at] === id)

/**
 * One product's verdict, so the dry run and the apply run cannot disagree.
 *
 * @param {Record<string, any>} data the product document
 * @param {ReadonlyArray<{ id: string, rules?: any[], matchAll?: boolean }>} smartCollections
 */
export function planProductMembership(data, smartCollections) {
  const wanted = productCollectionIds(liftForMembership(data ?? {}), smartCollections)
  return same(data?.collectionIds, wanted)
    ? { action: 'current' }
    : { action: 'update', write: { collectionIds: wanted } }
}

async function run(args) {
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { FieldPath, getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) })
  const firestore = getFirestore()
  console.log(
    `project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}` +
      (args.host ? ` · site ${args.host}` : ''),
  )
  const hostIds = []
  if (args.host) {
    hostIds.push(args.host)
  } else {
    let cursor = null
    for (;;) {
      let page = firestore.collection('hosts').orderBy(FieldPath.documentId()).limit(BATCH)
      if (cursor) page = page.startAfter(cursor)
      const snapshot = await page.select().get()
      if (snapshot.empty) break
      hostIds.push(...snapshot.docs.map((doc) => doc.id))
      cursor = snapshot.docs[snapshot.docs.length - 1]
      if (snapshot.size < BATCH) break
    }
  }
  const totals = { sites: 0, smartCollections: 0, scanned: 0, current: 0, updated: 0 }
  for (const hostId of hostIds) {
    const hostRef = firestore.collection('hosts').doc(hostId)
    const smart = await hostRef
      .collection('collections')
      .where('kind', '==', 'catalog')
      .where('mode', '==', 'smart')
      .get()
    const smartCollections = smart.docs.map((doc) => ({
      id: doc.id,
      rules: doc.get('rules') ?? [],
      matchAll: doc.get('matchAll'),
    }))
    totals.sites += 1
    totals.smartCollections += smartCollections.length
    let cursor = null
    for (;;) {
      let page = hostRef.collection('products').orderBy(FieldPath.documentId()).limit(BATCH)
      if (cursor) page = page.startAfter(cursor)
      const snapshot = await page.get()
      if (snapshot.empty) break
      const batch = firestore.batch()
      let writes = 0
      for (const doc of snapshot.docs) {
        totals.scanned += 1
        const verdict = planProductMembership(doc.data(), smartCollections)
        if (verdict.action === 'current') {
          totals.current += 1
        } else {
          totals.updated += 1
          batch.update(doc.ref, verdict.write)
          writes += 1
        }
      }
      if (args.apply && writes) await batch.commit()
      cursor = snapshot.docs[snapshot.docs.length - 1]
      if (snapshot.size < BATCH) break
    }
  }
  console.log(
    `\n${totals.sites} site(s), ${totals.smartCollections} smart collection(s); ` +
      `${totals.scanned} product(s) scanned: ${totals.current} already current, ` +
      `${totals.updated} ${args.apply ? 'updated' : 'would be updated'}`,
  )
  if (!args.apply) console.log('\nDRY RUN — re-run with --apply to write.')
}

/** The verdicts that decide whether this is safe to run. No Firestore. */
async function runSelfTest() {
  const { readFileSync } = await import('node:fs')
  const cases = []
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    cases.push({ name, ok, actual, expected })
  }
  const fixtures = JSON.parse(
    readFileSync(new URL('./lib/product-collection-ids.fixtures.json', import.meta.url), 'utf8'),
  )
  for (const one of fixtures.cases) {
    check(
      `fixture ${one.name}`,
      planProductMembership(one.product, fixtures.collections),
      one.expected.length ? { action: 'update', write: { collectionIds: one.expected } } : { action: 'current' },
    )
    check(
      `fixture ${one.name}, once stamped, is current`,
      planProductMembership({ ...one.product, collectionIds: one.expected }, fixtures.collections),
      { action: 'current' },
    )
  }
  check(
    'a stale membership is replaced',
    planProductMembership({ name: 'Mug', collectionIds: ['gone'] }, []),
    { action: 'update', write: { collectionIds: [] } },
  )
  check('no smart collections and no membership is current', planProductMembership({ name: 'Mug' }, []), {
    action: 'current',
  })
  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` + (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  if (failed) process.exitCode = 1
}

/* Run only when invoked, never when imported. ARGUMENTS FAIL CLOSED (AGL-1489). */
const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const args = parseDeployArgs({
    command: 'backfill-product-collection-ids',
    summary:
      'Stamp `collectionIds` (the smart collections each product answers) onto products, so ' +
      'the storefront lists a rule-based collection by query. Writes to the live project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
      { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one site (host document id).' },
    ],
  })
  if (args.selfTest) await runSelfTest()
  else await run(args)
}

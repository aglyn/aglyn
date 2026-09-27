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
 * Stamp the fields the products lists query by onto every product written
 * before they existed (AGL-3321). ONE backfill for both products lists.
 *
 * The console products table is ONE Firestore query: scoped to
 * `deletedAt == null`, ordered by `nameLower`, searched over `nameTokens`, and
 * filtered by `status`, `type`, `slug`, `skus` and `barcodes`. The storefront
 * catalog (the Product grid) is one too: scoped to `deletedAt == null` and
 * `status == 'active'`, ordered by `nameLower`, `priceFromCents` or
 * `createdAtMs`, and filtered by `type`, `soldOut`, a price range, a category
 * or a tag. A query cannot find a document that lacks the field it scopes,
 * orders or filters by, so a product without them is simply not in the list —
 * not "no match", absent.
 *
 *   - `deletedAt: null` — the create route stamps it on every product now;
 *     one created before carries no field at all. A soft-deleted product
 *     already carries a timestamp and is left alone.
 *   - `nameLower`, `nameTokens`, `nameReversed`, `skus`, `barcodes`,
 *     `priceFromCents` — the keys `productSearchFields` derives from the name
 *     and variants. A product from before has none, and a product Duplicate
 *     made before AGL-3321 carries its SOURCE's keys. Each is recomputed and
 *     written where it differs; `skus` / `barcodes` are removed from a
 *     product with none, as the writer omits them.
 *   - `soldOut` — the In stock verdict `productStockFields` derives from the
 *     variants' stock and the oversell policy.
 *   - `createdAtMs`, where it is missing, from the document's own create
 *     time — the storefront's Newest order reads it.
 *   - `status` and `type`, on a LEGACY product only (no `variants`), where
 *     `liftLegacyProduct` has always read an absent value as `active` and
 *     `physical`: every reader already treats it so, and now the query can.
 *
 * Nothing else on a product changes, and nothing is deleted except an empty
 * `skus` / `barcodes`.
 *
 * ## The restated logic, and what holds it
 *
 * The name keys come from `lib/name-search-tokens.mjs`, the one script-side
 * restatement of `app-utils/name-search`. The rest restates
 * `productSearchFields`, `productStockFields` and `liftLegacyProduct` in
 * `libs/plugins/commerce/src/lib/model/commerce.ts`, which a plain Node script
 * cannot import, and both sides are held to the worked examples in
 * `lib/product-list-fields.fixtures.json`: the library's
 * `product-search-keys.spec.ts` asserts them, and so does `--self-test`.
 *
 * ## Idempotence and interruption
 *
 * A product whose fields already match is never written, so a re-run is a
 * no-op and an interrupted run is finished by the next. Writes are batched,
 * 400 to a batch. Only `hosts/{hostId}/products/{id}` is touched: the scan is
 * a collection group, and any other collection named `products` is counted
 * and left alone.
 *
 * ## Running it
 *
 * Application Default Credentials against the project to write:
 *
 *     gcloud auth application-default login
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-products-list-fields.mjs          # dry run
 *     GOOGLE_CLOUD_PROJECT=<project> node tools/scripts/backfill-products-list-fields.mjs --apply  # write
 *     node tools/scripts/backfill-products-list-fields.mjs --self-test                           # no project
 *
 * `--host=<hostId>` limits a run to one site. A self-hosted install runs the
 * same commands against its own project.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  nameSearchKey,
  nameSearchReversed,
  nameSearchTokens,
  sameSearchTokens,
} from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Documents per batch; Firestore allows 500 writes, and this leaves room. */
const BATCH = 400
/** Documents read per page of the scan. */
const PAGE = 1000

const list = (value) => (Array.isArray(value) ? value : [])

/**
 * `productSearchFields` without the `name` it hands back: the name keys, the
 * flattened SKUs and barcodes (each omitted when no variant has one), and
 * `priceFromCents` when the variants are given.
 *
 * @param {{ name?: unknown, variants?: unknown }} product
 */
export function productSearchKeys(product) {
  const variants = list(product.variants)
  const flatten = (key) => [
    ...new Set(
      variants
        .map((variant) => {
          const value = variant?.[key]
          return typeof value === 'string' || typeof value === 'number' ? String(value) : ''
        })
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  const skus = flatten('sku')
  const barcodes = flatten('barcode')
  // `productPriceRange`'s low end, in cents: `productPriceFromCents`.
  const prices = variants
    .map((variant) => Number(variant?.priceUsd))
    .filter((price) => Number.isFinite(price) && price >= 0)
  return {
    nameLower: nameSearchKey(product.name),
    nameTokens: nameSearchTokens(product.name),
    nameReversed: nameSearchReversed(product.name),
    ...(skus.length ? { skus } : {}),
    ...(barcodes.length ? { barcodes } : {}),
    ...(Array.isArray(product.variants)
      ? { priceFromCents: Math.round((prices.length ? Math.min(...prices) : 0) * 100) }
      : {}),
  }
}

/**
 * `productStockFields`: the tracked total (`null` when nothing is tracked) and
 * whether a storefront card reads "Sold out".
 *
 * @param {{ variants?: unknown, oversellPolicy?: unknown }} product
 */
export function productStockKeys(product) {
  let inventory = null
  for (const variant of list(product.variants)) {
    if (variant?.inventory == null) continue
    inventory = (inventory ?? 0) + Number(variant.inventory)
  }
  return {
    inventory,
    soldOut: inventory != null && inventory <= 0 && product.oversellPolicy !== 'backorder',
  }
}

/** `liftLegacyProduct`'s test: a product with no variants is a legacy one. */
const isLegacy = (data) => !(Array.isArray(data.variants) && data.variants.length > 0)

/**
 * The parts of `liftLegacyProduct` the keys are derived from: a legacy doc
 * (flat name / priceUsd / inventory) gains a name, a status, a type and one
 * default variant; any other doc passes through.
 */
function lifted(data) {
  if (!isLegacy(data)) return data
  const priceUsd = Number(data.priceUsd ?? 0)
  return {
    ...data,
    name: data.name ?? 'Product',
    type: data.type ?? 'physical',
    status: data.status ?? 'active',
    variants: [
      { id: 'default', priceUsd: Number.isFinite(priceUsd) ? priceUsd : 0, inventory: data.inventory ?? null },
    ],
  }
}

/**
 * Every field the products lists read, as a writer would stamp it on this
 * product: the live scope's `deletedAt: null` (a deleted product keeps its
 * timestamp), the search and price keys, the In stock verdict, and — for a
 * legacy product — the status and type the lift reads it as. The seeders
 * spread this onto what they write.
 *
 * @param {Record<string, unknown>} data
 */
export function productListFieldsOf(data) {
  const product = lifted(data)
  const legacy = isLegacy(data)
  return {
    deletedAt: data.deletedAt === undefined ? null : data.deletedAt,
    ...productSearchKeys({
      name: typeof product.name === 'string' ? product.name : '',
      variants: product.variants,
    }),
    soldOut: productStockKeys(product).soldOut,
    ...(legacy ? { status: product.status, type: product.type } : {}),
  }
}

/** Search and price keys a product must hold: written when they differ. */
const KEY_FIELDS = ['nameLower', 'nameReversed', 'priceFromCents', 'soldOut']

/**
 * What a product document should be stamped with, or a skip. Pure, for the
 * self-test. `remove` names fields to delete.
 *
 * @param {string} path the document path
 * @param {Record<string, unknown>} data the document
 * @param {number | null} [createTimeMs] the document's create time
 * @returns {{ update: Record<string, unknown>, remove: string[] } | { skip: 'current' | 'not-a-site-product' }}
 */
export function planProduct(path, data, createTimeMs = null) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'products') {
    return { skip: 'not-a-site-product' }
  }
  const want = productListFieldsOf(data)
  const update = {}
  const remove = []
  if (data.deletedAt === undefined) update.deletedAt = null
  for (const field of KEY_FIELDS) {
    if (field in want && data[field] !== want[field]) update[field] = want[field]
  }
  if (!sameSearchTokens(data.nameTokens, want.nameTokens)) update.nameTokens = want.nameTokens
  for (const field of ['skus', 'barcodes']) {
    if (want[field]) {
      if (!sameSearchTokens(data[field], want[field])) update[field] = want[field]
    } else if (data[field] !== undefined) {
      remove.push(field)
    }
  }
  if (isLegacy(data)) {
    if (data.status == null) update.status = want.status
    if (data.type == null) update.type = want.type
  }
  if (!(typeof data.createdAtMs === 'number' && Number.isFinite(data.createdAtMs)) && createTimeMs != null) {
    update.createdAtMs = createTimeMs
  }
  return Object.keys(update).length || remove.length ? { update, remove } : { skip: 'current' }
}

function selfTest() {
  let passed = 0
  let failed = 0
  // Field order is not part of a document, so objects compare key-sorted.
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
        : value
  const check = (name, actual, expected) => {
    if (JSON.stringify(canonical(actual)) === JSON.stringify(canonical(expected))) {
      passed += 1
    } else {
      failed += 1
      console.error(`FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
    }
  }

  // The worked examples `product-search-keys.spec.ts` asserts of the library.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'product-list-fields.fixtures.json'), 'utf8'),
  )
  fixtures.keys.forEach(({ product, expected }, at) =>
    check(`fixture keys #${at}`, productSearchKeys(product), expected),
  )
  fixtures.stock.forEach(({ product, expected }, at) =>
    check(`fixture stock #${at}`, productStockKeys(product), expected),
  )
  // What the lift READS is what the backfill STORES: a legacy product ends up
  // holding the status, type and keys every reader already gave it.
  fixtures.lift.forEach(({ product, expected }, at) => {
    const plan = planProduct('hosts/h1/products/p1', product)
    const stamped = 'update' in plan ? { ...product, ...plan.update } : product
    check(
      `fixture lift #${at}`,
      Object.fromEntries(Object.keys(expected).map((field) => [field, stamped[field] ?? null])),
      expected,
    )
  })

  const variants = [{ id: 'a', sku: 'L-1', priceUsd: 12, inventory: 3 }]
  const KEYS = productListFieldsOf({ name: 'Desk lamp', variants, status: 'active', type: 'physical', deletedAt: null })
  const current = { name: 'Desk lamp', variants, status: 'active', type: 'physical', createdAtMs: 5, ...KEYS }
  const { deletedAt: _deletedAt, ...keysOnly } = KEYS
  const cases = [
    ['a current product', 'hosts/h1/products/p1', current, null, { skip: 'current' }],
    [
      'a product from before the create route stamped deletedAt',
      'hosts/h1/products/p1',
      { ...current, deletedAt: undefined },
      null,
      { update: { deletedAt: null }, remove: [] },
    ],
    [
      'a soft-deleted product keeps its timestamp',
      'hosts/h1/products/p1',
      { ...current, deletedAt: { seconds: 1 } },
      null,
      { skip: 'current' },
    ],
    [
      'a product with no keys at all',
      'hosts/h1/products/p1',
      { name: 'Desk lamp', variants, status: 'active', type: 'physical', deletedAt: null, createdAtMs: 5 },
      null,
      { update: keysOnly, remove: [] },
    ],
    [
      'a product from before the storefront keys',
      'hosts/h1/products/p1',
      { ...current, priceFromCents: undefined, soldOut: undefined },
      null,
      { update: { priceFromCents: 1200, soldOut: false }, remove: [] },
    ],
    [
      'a sold-out product',
      'hosts/h1/products/p1',
      { ...current, variants: [{ ...variants[0], inventory: 0 }] },
      null,
      { update: { soldOut: true }, remove: [] },
    ],
    [
      'a duplicate carrying its source’s keys',
      'hosts/h1/products/p2',
      { ...current, name: 'Desk lamp (copy)' },
      null,
      {
        update: {
          nameLower: 'desk lamp (copy)',
          nameReversed: ')ypoc( pmal ksed',
          nameTokens: nameSearchTokens('Desk lamp (copy)'),
        },
        remove: [],
      },
    ],
    [
      'a product whose SKUs were all removed',
      'hosts/h1/products/p1',
      { ...current, variants: [{ id: 'a', priceUsd: 12, inventory: 3 }], barcodes: [] },
      null,
      { update: {}, remove: ['skus', 'barcodes'] },
    ],
    [
      'a product with no createdAtMs takes its create time',
      'hosts/h1/products/p1',
      { ...current, createdAtMs: undefined },
      1700,
      { update: { createdAtMs: 1700 }, remove: [] },
    ],
    [
      'a legacy product with nothing but a name and a price',
      'hosts/h1/products/p3',
      { name: 'Old tee', priceUsd: 5, createdAtMs: 5 },
      null,
      {
        update: {
          deletedAt: null,
          nameLower: 'old tee',
          nameReversed: 'eet dlo',
          priceFromCents: 500,
          soldOut: false,
          nameTokens: nameSearchTokens('Old tee'),
          status: 'active',
          type: 'physical',
        },
        remove: [],
      },
    ],
    [
      'a nameless legacy product is keyed as the name every reader shows',
      'hosts/h1/products/p4',
      { priceUsd: 1, status: 'draft', type: 'digital', deletedAt: null, createdAtMs: 5 },
      null,
      {
        update: {
          nameLower: 'product',
          nameReversed: 'tcudorp',
          priceFromCents: 100,
          soldOut: false,
          nameTokens: nameSearchTokens('Product'),
        },
        remove: [],
      },
    ],
    ['another collection named products', 'orgs/o1/products/p1', {}, null, { skip: 'not-a-site-product' }],
  ]
  for (const [name, path, data, createTimeMs, expected] of cases) {
    check(name, planProduct(path, data, createTimeMs), expected)
  }
  // Idempotent: a product the plan stamped plans nothing the second time.
  for (const [name, path, data, createTimeMs] of cases) {
    const once = planProduct(path, data, createTimeMs)
    if ('skip' in once) continue
    const stamped = { ...data, ...once.update }
    for (const field of once.remove) delete stamped[field]
    check(`${name}: re-run is a no-op`, planProduct(path, stamped, createTimeMs), { skip: 'current' })
  }
  const total = passed + failed
  console.log(failed ? `self-test: ${failed} of ${total} failed` : `self-test: ${total}/${total} passed`)
  process.exit(failed ? 1 : 0)
}

async function run(args) {
  const { applicationDefault, initializeApp } = await import('firebase-admin/app')
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore')
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || undefined
  initializeApp({ credential: applicationDefault(), ...(projectId ? { projectId } : {}) })
  const firestore = getFirestore()
  console.log(
    `project: ${projectId ?? '(from the credentials)'} · ${args.apply ? 'APPLY' : 'dry run'}` +
      (args.host ? ` · site ${args.host}` : ''),
  )
  const counts = {
    scanned: 0,
    current: 0,
    otherCollections: 0,
    deletedAt: 0,
    keys: 0,
    storefront: 0,
    createdAt: 0,
    legacy: 0,
    written: 0,
  }
  const source = args.host
    ? firestore.collection('hosts').doc(args.host).collection('products')
    : firestore.collectionGroup('products')
  let cursor = null
  let batch = firestore.batch()
  let pending = 0
  for (;;) {
    let page = source.orderBy('__name__').limit(PAGE)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    for (const doc of snapshot.docs) {
      counts.scanned += 1
      const plan = planProduct(doc.ref.path, doc.data(), doc.createTime?.toMillis() ?? null)
      if ('skip' in plan) {
        if (plan.skip === 'current') counts.current += 1
        else counts.otherCollections += 1
        continue
      }
      const has = (...fields) => fields.some((field) => field in plan.update)
      if (has('deletedAt')) counts.deletedAt += 1
      if (plan.remove.length || has('nameLower', 'nameTokens', 'nameReversed', 'skus', 'barcodes')) {
        counts.keys += 1
      }
      if (has('priceFromCents', 'soldOut')) counts.storefront += 1
      if (has('createdAtMs')) counts.createdAt += 1
      if (has('status', 'type')) counts.legacy += 1
      if (!args.apply) continue
      batch.update(doc.ref, {
        ...plan.update,
        ...Object.fromEntries(plan.remove.map((field) => [field, FieldValue.delete()])),
      })
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
      ? 'backfill-products-list-fields: APPLIED'
      : 'backfill-products-list-fields: DRY RUN (nothing written)',
  )
  console.log(`  scanned                           ${counts.scanned}`)
  console.log(`  already current                   ${counts.current}`)
  console.log(`  stamp deletedAt: null             ${counts.deletedAt}`)
  console.log(`  stamp search keys                 ${counts.keys}`)
  console.log(`  stamp priceFromCents / soldOut    ${counts.storefront}`)
  console.log(`  stamp createdAtMs                 ${counts.createdAt}`)
  console.log(`  stamp legacy status / type        ${counts.legacy}`)
  console.log(`  not hosts/*/products (left alone) ${counts.otherCollections}`)
  if (args.apply) console.log(`  written                           ${counts.written}`)
}

/*
 * Run only when invoked, never when imported: the seeders import
 * `productListFieldsOf`, and ARGUMENTS FAIL CLOSED (AGL-1489) — parsing a
 * seeder's own argv here would refuse it.
 */
const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const args = parseDeployArgs({
    command: 'backfill-products-list-fields',
    summary:
      'Stamp `deletedAt: null`, the search, price and stock keys, `createdAtMs` and ' +
      'the legacy status/type onto products that predate them, so the products ' +
      'table and the storefront catalog list and filter them. Writes to the live ' +
      'project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
      { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one site.' },
    ],
  })
  if (args.selfTest) selfTest()
  else await run(args)
}

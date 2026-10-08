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
 * Stamp the orders list's query fields onto every order written before them
 * (AGL-3321).
 *
 *   gcloud auth application-default login
 *   GOOGLE_CLOUD_PROJECT=<project-id> \
 *     node tools/scripts/backfill-orders-list-fields.mjs [--apply] [--host=<hostId>]
 *
 *   node tools/scripts/backfill-orders-list-fields.mjs --self-test
 *
 * DRY RUN BY DEFAULT. Credentials are Application Default Credentials: the
 * `gcloud` login above, or `GOOGLE_APPLICATION_CREDENTIALS` naming a service
 * account key with Firestore write access. `GOOGLE_CLOUD_PROJECT` names the
 * project; without it the credentials' own project is used, and the run
 * prints which one it is before it reads anything.
 *
 * ## What the fields are
 *
 * The commerce Orders list puts every filter and its quick search on its
 * Firestore query, and a query can only ask about what a document stores.
 * Every writer of `hosts/{hostId}/orders` now spreads `orderListFields`
 * (`libs/plugins/commerce/src/lib/model/order-list-fields.ts`) over what it
 * writes: `status` and `channel` always present, `productIds`, `disputeKey`,
 * `number`, `customerEmailLower`, `customerEmailTokens`, `orderLabelTokens`
 * and `searchTokens`. An order written before that lacks some or all of them, and
 * a query cannot find a document by a field it does not have — so without
 * this, older orders still LIST, newest first, and are missed by every filter
 * and by the search.
 *
 * ## What it touches
 *
 * `hosts/{hostId}/orders/{orderId}` only (any other collection named `orders`
 * is counted and left alone), and on each only those nine fields, computed
 * from what the order already says.
 *
 * The Orders grid SORTS by `number` and `customerEmailLower` (AGL-3680), and
 * an `orderBy` drops every document that LACKS its field — so on those two an
 * ABSENT field is written as `null` (an unnumbered order, an order with no
 * address), where for the rest absent and `null` read the same and nothing is
 * written. An order's own `number` is never changed, only stated.
 *
 * `status` and `channel` are written only where the order has none, as
 * `paid` and `online` — what `liftLegacyOrder` has always read an absent one
 * as. A Commerce Starter order that stored a
 * product id and no line items is searchable by that product's CURRENT name,
 * read from `hosts/{hostId}/products/{productId}` once per product; the
 * writers since have always snapshotted a name onto the line item.
 *
 * An order with no numeric `createdAtMs` is skipped and counted: the list is
 * ordered by that field, so it never reads such a document, and stamping a
 * document of unknown shape is not this script's to guess at.
 *
 * ## Idempotence and interruption
 *
 * A field whose stored value already equals the computed one is not written,
 * and an order with none to write is counted as current — so a second run
 * writes nothing, and an interrupted run is finished by the next. Writes are
 * `update()`s in batches of {@link BATCH}. Nothing is deleted.
 *
 * The derivation is restated below from `orderListFields`, which a plain
 * Node script cannot import (it is TypeScript behind path aliases). The name
 * keys come from `lib/name-search-tokens.mjs` and the address tokens from
 * `lib/email-search-tokens.mjs`, the one script-side twin of each. The two are held to the same worked examples,
 * `lib/order-list-fields.fixtures.json`: the library's spec asserts them and
 * so does `--self-test`, so this cannot stamp a token the writers and the
 * list's query do not use.
 *
 * The seeders import {@link orderListFieldsOf} from here for the same reason,
 * so a seeded order is found by the filters exactly as a sold one is.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import { emailSearchTokens } from './lib/email-search-tokens.mjs'
import { nameSearchKey, nameSearchTokens } from './lib/name-search-tokens.mjs'

const here = dirname(fileURLToPath(import.meta.url))

/** Orders read, and at most written, per batch. Firestore allows 500. */
const BATCH = 400

/** `ORDER_SEARCH_TOKEN_LIMIT` in the commerce model. */
const SEARCH_TOKEN_LIMIT = 200

/** `formatOrderNumber`: `#1042`, or a document-id stub for an unnumbered row. */
function orderLabel(number, docId) {
  if (number != null) return `#${number}`
  return docId ? `#${docId.slice(-6).toUpperCase()}` : '#—'
}

/** `orderLabelTokens`: the number's prefixes with and without its `#`. */
function orderLabelTokens(number, docId) {
  const label = nameSearchKey(orderLabel(number, docId))
  const bare = label.replace(/^#+/, '')
  return nameSearchTokens(bare && bare !== label ? `${label} ${bare}` : label)
}

/** Stripe dispute statuses that mean it is over (`commerce-dispute.ts`). */
const SETTLED_DISPUTE_STATUSES = new Set(['won', 'lost', 'warning_closed'])

/** `orderDisputeKey`: `describeOrderDispute(…).tone`, or null. */
function disputeKey(dispute) {
  if (!dispute || typeof dispute !== 'object') return null
  const open =
    !dispute.outcome &&
    !dispute.closedAtMs &&
    !SETTLED_DISPUTE_STATUSES.has(String(dispute.status ?? ''))
  if (open) return 'open'
  const outcome = String(dispute.outcome ?? dispute.status ?? '')
  if (outcome === 'lost') return 'lost'
  if (outcome === 'won') return 'won'
  return 'settled'
}

const text = (value) => (typeof value === 'string' ? value : '')

/**
 * `orderListFields`, restated. `legacyProductName` names the product of an
 * order that stored an id and no line items.
 *
 * @param {Record<string, any>} order
 * @param {string} docId
 * @param {{ legacyProductName?: string }} [options]
 */
export function orderListFieldsOf(order, docId, options = {}) {
  const lineItems = Array.isArray(order?.lineItems) ? order.lineItems : []
  const productIds = [
    ...new Set(
      [...lineItems.map((line) => line?.productId), order?.productId].filter(
        (id) => typeof id === 'string' && id !== '',
      ),
    ),
  ]
  const email = text(order?.customerEmail)
  const emailTokens = emailSearchTokens(email)
  const labelTokens = orderLabelTokens(order?.number, docId)
  const names = lineItems.map((line) => text(line?.name)).filter(Boolean)
  if (!names.length && options.legacyProductName) names.push(options.legacyProductName)
  const searchTokens = [
    ...new Set([...labelTokens, ...emailTokens, ...names.flatMap((name) => nameSearchTokens(name))]),
  ].slice(0, SEARCH_TOKEN_LIMIT)
  return {
    status: text(order?.status) || 'paid',
    channel: text(order?.channel) || 'online',
    productIds,
    disputeKey: disputeKey(order?.dispute),
    number: typeof order?.number === 'number' && Number.isFinite(order.number) ? order.number : null,
    customerEmailLower: nameSearchKey(email) || null,
    customerEmailTokens: emailTokens,
    orderLabelTokens: labelTokens,
    searchTokens,
  }
}

const same = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null)

/**
 * The fields the Orders grid's headers order by (AGL-3680): present on every
 * order, `null` included, or the order drops out of that sort.
 */
const SORTED_FIELDS = new Set(['number', 'customerEmailLower'])

/**
 * One order's verdict, so the dry run and the apply run cannot disagree:
 * the fields to write, or why nothing is.
 *
 * @param {string} path the document path
 * @param {Record<string, any>} data the document
 * @param {{ legacyProductName?: string }} [options]
 */
export function planOrder(path, data, options = {}) {
  const segments = path.split('/')
  if (segments.length !== 4 || segments[0] !== 'hosts' || segments[2] !== 'orders') {
    return { action: 'skip', reason: 'not a site order' }
  }
  if (typeof data?.createdAtMs !== 'number') {
    return { action: 'skip', reason: 'no numeric createdAtMs — the list never reads it' }
  }
  const computed = orderListFieldsOf(data, segments[3], options)
  const write = {}
  for (const [key, value] of Object.entries(computed)) {
    if (!same(data[key], value) || (SORTED_FIELDS.has(key) && !(key in data))) write[key] = value
  }
  return Object.keys(write).length ? { action: 'update', write } : { action: 'current' }
}

/** Whether an order is a Commerce Starter row whose product name must be read. */
const needsProductName = (data) =>
  !(Array.isArray(data?.lineItems) && data.lineItems.some((line) => text(line?.name))) &&
  typeof data?.productId === 'string' &&
  data.productId !== ''

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

  const productNames = new Map()
  const productName = async (hostId, productId) => {
    const key = `${hostId}/${productId}`
    if (!productNames.has(key)) {
      const snapshot = await firestore
        .collection('hosts')
        .doc(hostId)
        .collection('products')
        .doc(productId)
        .get()
        .catch(() => null)
      const name = snapshot?.exists ? snapshot.get('name') : undefined
      productNames.set(key, typeof name === 'string' && name ? name : undefined)
    }
    return productNames.get(key)
  }

  const base = args.host
    ? firestore.collection('hosts').doc(args.host).collection('orders')
    : firestore.collectionGroup('orders')
  const totals = { scanned: 0, current: 0, updated: 0, skipped: 0 }
  const fieldCounts = new Map()
  const skipReasons = new Map()
  let cursor = null
  for (;;) {
    // Paged by document name: every order has one, so the walk is total.
    let page = base.orderBy(FieldPath.documentId()).limit(BATCH)
    if (cursor) page = page.startAfter(cursor)
    const snapshot = await page.get()
    if (snapshot.empty) break
    const batch = firestore.batch()
    let writes = 0
    for (const doc of snapshot.docs) {
      totals.scanned += 1
      const data = doc.data()
      const hostId = doc.ref.parent.parent?.id
      const legacyProductName =
        hostId && needsProductName(data) ? await productName(hostId, data.productId) : undefined
      const verdict = planOrder(doc.ref.path, data, { legacyProductName })
      if (verdict.action === 'current') {
        totals.current += 1
      } else if (verdict.action === 'skip') {
        totals.skipped += 1
        skipReasons.set(verdict.reason, (skipReasons.get(verdict.reason) ?? 0) + 1)
      } else {
        totals.updated += 1
        for (const key of Object.keys(verdict.write)) {
          fieldCounts.set(key, (fieldCounts.get(key) ?? 0) + 1)
        }
        batch.update(doc.ref, verdict.write)
        writes += 1
      }
    }
    if (args.apply && writes) await batch.commit()
    cursor = snapshot.docs[snapshot.docs.length - 1]
    if (snapshot.size < BATCH) break
  }

  console.log(
    `\n${totals.scanned} order(s) scanned: ${totals.current} already current, ` +
      `${totals.updated} ${args.apply ? 'updated' : 'would be updated'}, ${totals.skipped} skipped`,
  )
  for (const [key, count] of fieldCounts) console.log(`  ${key}: ${count}`)
  for (const [reason, count] of skipReasons) console.log(`  skipped ${count}: ${reason}`)
  if (!args.apply) console.log('\nDRY RUN — re-run with --apply to write.')
}

/** The verdicts that decide whether this is safe to run. No Firestore. */
function runSelfTest() {
  const cases = []
  const check = (name, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected)
    cases.push({ name, ok, actual, expected })
  }

  // The copy answers the worked examples the library's spec asserts.
  const fixtures = JSON.parse(
    readFileSync(join(here, 'lib', 'order-list-fields.fixtures.json'), 'utf8'),
  )
  for (const one of fixtures.orders) {
    check(
      `fixture ${one.name}`,
      orderListFieldsOf(one.order, one.docId, one.options ?? {}),
      one.expected,
    )
  }
  for (const one of fixtures.emails) {
    check(`email ${JSON.stringify(one.email)}`, emailSearchTokens(one.email), one.expected)
  }

  const fixture = fixtures.orders[0]
  const order = { ...fixture.order, createdAtMs: 1 }
  const stamped = { ...order, ...orderListFieldsOf(order, fixture.docId) }
  const path = `hosts/h1/orders/${fixture.docId}`
  // `status` and `channel` it already names; an absent `disputeKey` already
  // says "no dispute", which is what the computed null says too.
  check(
    'stamps an order that carries none of the fields',
    Object.keys(planOrder(path, order).write ?? {}),
    ['productIds', 'customerEmailLower', 'customerEmailTokens', 'orderLabelTokens', 'searchTokens'],
  )
  check('is idempotent: a stamped order is current', planOrder(path, stamped), {
    action: 'current',
  })
  check(
    'writes only the fields that moved',
    Object.keys(planOrder(path, { ...stamped, disputeKey: 'open' }).write ?? {}),
    ['disputeKey'],
  )
  check(
    'never rewrites a status or channel the order names',
    Object.keys(planOrder(path, { ...stamped, status: 'refunded', channel: 'pos' })),
    ['action'],
  )
  check(
    'lifts an absent status and channel the way the console reads them',
    (({ status, channel }) => ({ status, channel }))(
      planOrder('hosts/h1/orders/legacy', { createdAtMs: 1, productId: 'p1' }).write,
    ),
    { status: 'paid', channel: 'online' },
  )
  const { number: _number, customerEmailLower: _email, ...lacking } = orderListFieldsOf(
    { createdAtMs: 1 },
    'pos1',
  )
  check(
    'states an absent number and address as null, so the header sorts reach the order',
    planOrder('hosts/h1/orders/pos1', { ...lacking, createdAtMs: 1 }).write,
    { number: null, customerEmailLower: null },
  )
  check(
    'leaves a stored null number and address alone',
    planOrder('hosts/h1/orders/pos1', { ...orderListFieldsOf({ createdAtMs: 1 }, 'pos1'), createdAtMs: 1 }),
    { action: 'current' },
  )
  check(
    'skips an order the list cannot read',
    planOrder('hosts/h1/orders/o1', { status: 'paid' }),
    { action: 'skip', reason: 'no numeric createdAtMs — the list never reads it' },
  )
  check(
    'leaves another collection named orders alone',
    planOrder('orgs/o1/orders/o1', { createdAtMs: 1 }),
    { action: 'skip', reason: 'not a site order' },
  )
  check(
    'reads a legacy product name only when the order holds no line item name',
    [
      needsProductName({ productId: 'p1' }),
      needsProductName({ productId: 'p1', lineItems: [{ productId: 'p1', name: 'Mug' }] }),
      needsProductName({ lineItems: [] }),
    ],
    [true, false, false],
  )

  for (const entry of cases) {
    console.log(
      `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}` +
        (entry.ok ? '' : ` — got ${JSON.stringify(entry.actual)}`),
    )
  }
  const failed = cases.filter((entry) => !entry.ok).length
  console.log(`\n${cases.length - failed}/${cases.length} passed`)
  if (failed) process.exitCode = 1
}

/*
 * Run only when invoked, never when imported: the seeders import
 * `orderListFieldsOf`, and ARGUMENTS FAIL CLOSED (AGL-1489) — parsing a
 * seeder's own argv here would refuse it.
 */
const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (invoked) {
  const args = parseDeployArgs({
    command: 'backfill-orders-list-fields',
    summary:
      'Stamp the orders list’s query fields (status, channel, productIds, disputeKey, ' +
      'customer email keys, order-number and search tokens) onto orders that predate ' +
      'them. Writes to the live project with --apply.',
    effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
    flags: [
      { flag: '--apply', key: 'apply', describe: 'Write. Without it, a dry run.' },
      { flag: '--self-test', key: 'selfTest', describe: 'Run the fixtures, touching no project.' },
      { flag: '--host', key: 'host', value: 'string', describe: 'Limit to one site (host document id).' },
    ],
  })
  if (args.selfTest) runSelfTest()
  else await run(args)
}

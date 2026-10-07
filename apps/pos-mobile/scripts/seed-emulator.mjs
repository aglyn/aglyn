/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seeds a store for Aglyn POS on a LOCAL Firebase emulator stack (AGL-3618),
 * on top of the e2e fixtures (`npm run seed:e2e`): a register, categories,
 * products with options, modifiers and quick keys, today's bookings and the
 * register's tip settings, on the e2e site `demo`. Sign in to the app as the
 * e2e member the e2e seed creates.
 *
 *   node apps/pos-mobile/scripts/seed-emulator.mjs [--firestore localhost:8082] [--project aglyn-main] [--host demo]
 *
 * Emulator only: the Firestore host must be local, and writes use the
 * emulator's `owner` bearer, which the emulator alone honors.
 */

import { nameSearchFields } from '../../../libs/aglyn/src/lib/app-utils/name-search.ts'

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] : fallback
}

const FIRESTORE = arg('firestore', process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8082')
const PROJECT = arg('project', 'aglyn-main')
const HOST = arg('host', 'demo')

if (!/^(localhost|127\.0\.0\.1):\d+$/.test(FIRESTORE)) {
  console.error('seed-emulator: the Firestore host must be a local emulator.')
  process.exit(1)
}

function encode(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } }
}

async function put(path, data) {
  const url = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`
  const response = await fetch(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: encode(data).mapValue.fields }),
  })
  if (!response.ok) throw new Error(`PATCH ${path}: ${response.status} ${await response.text()}`)
}

const now = Date.now()
const variant = (id, priceUsd, extra = {}) => ({ id, options: {}, priceUsd, ...extra })

function product(id, name, fields) {
  const variants = fields.variants
  return [
    `hosts/${HOST}/products/${id}`,
    {
      ...nameSearchFields(name),
      slug: id,
      type: 'physical',
      status: 'active',
      deletedAt: null,
      skus: variants.map((entry) => entry.sku).filter(Boolean).map((sku) => sku.toLowerCase()),
      barcodes: variants.map((entry) => entry.barcode).filter(Boolean).map((code) => code.toLowerCase()),
      priceFromCents: Math.min(...variants.map((entry) => Math.round(entry.priceUsd * 100))),
      createdAtMs: now,
      ...fields,
    },
  ]
}

const size = (id, label, priceUsd, extra = {}) => ({ id, options: { Size: label }, priceUsd, ...extra })
const milk = {
  id: 'milk',
  name: 'Milk',
  min: 1,
  max: 1,
  options: [
    { id: 'whole', name: 'Whole milk', priceCents: 0 },
    { id: 'oat', name: 'Oat milk', priceCents: 75 },
    { id: 'almond', name: 'Almond milk', priceCents: 75 },
  ],
}
const extras = {
  id: 'extras',
  name: 'Extras',
  min: 0,
  max: 3,
  options: [
    { id: 'shot', name: 'Extra shot', priceCents: 100 },
    { id: 'vanilla', name: 'Vanilla syrup', priceCents: 50 },
    { id: 'whip', name: 'Whipped cream', priceCents: 0 },
  ],
}

const docs = [
  [`hosts/${HOST}/registers/front`, { name: 'Front counter', createdAt: null }],
  [`hosts/${HOST}/pluginSettings/commerce`, { posTippingEnabled: true, posTipPercentages: '15, 18, 20, 25' }],
  [`hosts/${HOST}/productCategories/coffee`, { name: 'Coffee', slug: 'coffee', order: 1, parentId: null }],
  [`hosts/${HOST}/productCategories/bakery`, { name: 'Bakery', slug: 'bakery', order: 2, parentId: null }],
  [`hosts/${HOST}/productCategories/retail`, { name: 'Retail', slug: 'retail', order: 3, parentId: null }],
  product('latte', 'Latte', {
    categoryIds: ['coffee'],
    posQuickKey: true,
    options: [{ name: 'Size', values: ['Small', 'Large'] }],
    variants: [size('latte-s', 'Small', 4.25, { sku: 'LAT-S' }), size('latte-l', 'Large', 5.25, { sku: 'LAT-L' })],
    modifierGroups: [milk, extras],
  }),
  product('cappuccino', 'Cappuccino', {
    categoryIds: ['coffee'],
    posQuickKey: true,
    variants: [variant('default', 4.5)],
    modifierGroups: [milk],
  }),
  product('drip', 'Drip coffee', { categoryIds: ['coffee'], posQuickKey: true, variants: [variant('default', 2.75)] }),
  product('cold-brew', 'Cold brew', { categoryIds: ['coffee'], variants: [variant('default', 4.75)] }),
  product('croissant', 'Butter croissant', {
    categoryIds: ['bakery'],
    posQuickKey: true,
    variants: [variant('default', 3.95, { barcode: '0012345678905', inventory: 14 })],
  }),
  product('muffin', 'Blueberry muffin', { categoryIds: ['bakery'], variants: [variant('default', 3.5, { inventory: 0 })] }),
  product('sourdough', 'Sourdough loaf', { categoryIds: ['bakery'], posQuickKey: true, variants: [variant('default', 9)] }),
  product('mug', 'Bakery mug', {
    categoryIds: ['retail'],
    options: [{ name: 'Color', values: ['Cream', 'Sage'] }],
    variants: [
      { id: 'mug-cream', options: { Color: 'Cream' }, priceUsd: 18, sku: 'MUG-CR' },
      { id: 'mug-sage', options: { Color: 'Sage' }, priceUsd: 18, sku: 'MUG-SG' },
    ],
  }),
  product('beans', 'House beans 12 oz', {
    categoryIds: ['retail', 'coffee'],
    variants: [variant('default', 16.5, { barcode: '0098765432109', inventory: 22 })],
  }),
  [`hosts/${HOST}/services/haircut`, { name: 'Pastry class', priceUsd: 45, priceDisplay: 'fixed' }],
  [`hosts/${HOST}/services/consult`, { name: 'Custom cake consultation', priceUsd: 0, priceDisplay: 'varies' }],
]

const hour = 60 * 60 * 1000
const today = new Date()
today.setHours(9, 0, 0, 0)
const at = (hours) => today.getTime() + hours * hour
docs.push(
  [
    `hosts/${HOST}/bookings/b-ada`,
    { serviceId: 'haircut', serviceName: 'Pastry class', name: 'Ada Lovelace', email: 'ada@example.test', startsAtMs: at(1), endsAtMs: at(2), status: 'confirmed' },
  ],
  [
    `hosts/${HOST}/bookings/b-grace`,
    { serviceId: 'consult', serviceName: 'Custom cake consultation', name: 'Grace Hopper', email: 'grace@example.test', startsAtMs: at(3), endsAtMs: at(3.5), status: 'confirmed' },
  ],
  [
    `hosts/${HOST}/bookings/b-alan`,
    { serviceId: 'haircut', serviceName: 'Pastry class', name: 'Alan Turing', email: 'alan@example.test', startsAtMs: at(5), endsAtMs: at(6), status: 'confirmed', paidAmountCents: 4860 },
  ],
)

for (const [path, data] of docs) await put(path, data)
console.log(`seed-emulator: ${docs.length} documents on site ${HOST} (project ${PROJECT}, Firestore ${FIRESTORE}).`)

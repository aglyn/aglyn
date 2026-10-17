/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The register of the demo site (from AGL-3618's seed), so Aglyn POS has a
 * store to ring up: a register, categories, products with options, modifiers
 * and quick keys, the register's tip settings, and two services with today's
 * bookings to take payment for.
 */

import { imageFields } from './store.mjs'
const variant = (id, priceUsd, extra = {}) => ({ id, options: {}, priceUsd, ...extra })
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

const IMAGES = { mug: 'mug-cream', beans: 'beans-pos' }

export async function seedPos({ put, hostId, now: date, nameSearchFields }) {
  const now = date.getTime()
  const product = (id, name, fields) => {
    const variants = fields.variants
    return [
      `hosts/${hostId}/products/${id}`,
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
        ...imageFields(IMAGES[id] ?? id),
        ...fields,
      },
    ]
  }

  const docs = [
    [`hosts/${hostId}/registers/front`, { name: 'Front counter', createdAt: null }],
    [`hosts/${hostId}/pluginSettings/commerce`, { posTippingEnabled: true, posTipPercentages: '15, 18, 20, 25' }],
    [`hosts/${hostId}/productCategories/coffee`, { name: 'Coffee', slug: 'coffee', order: 1, parentId: null }],
    [`hosts/${hostId}/productCategories/bakery`, { name: 'Bakery', slug: 'bakery', order: 2, parentId: null }],
    [`hosts/${hostId}/productCategories/retail`, { name: 'Retail', slug: 'retail', order: 3, parentId: null }],
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
  ]

  const hour = 60 * 60 * 1000
  const today = new Date(now)
  today.setHours(9, 0, 0, 0)
  const at = (hours) => today.getTime() + hours * hour
  docs.push(
    [
      `hosts/${hostId}/bookings/pos-ada`,
      { serviceId: 's-cut', serviceName: 'Pastry class', name: 'Elise Carter', email: 'elise@example.test', startsAtMs: at(1), endsAtMs: at(2), status: 'confirmed' },
    ],
    [
      `hosts/${hostId}/bookings/pos-grace`,
      { serviceId: 's-color', serviceName: 'Custom cake consultation', name: 'Noah Bennett', email: 'noah@example.test', startsAtMs: at(3), endsAtMs: at(3.5), status: 'confirmed' },
    ],
    [
      `hosts/${hostId}/bookings/pos-alan`,
      { serviceId: 's-cut', serviceName: 'Pastry class', name: 'Zoe Ramirez', email: 'zoe@example.test', startsAtMs: at(5), endsAtMs: at(6), status: 'confirmed', paidAmountCents: 4860 },
    ],
  )

  for (const [path, data] of docs) await put(path, data)
  // The register sells the site's own services (seeded with the store), priced for the counter: a merge, so the same two
  // services are listed once wherever services are, never as twins under other ids.
  await put(`hosts/${hostId}/services/s-cut`, { priceUsd: 45, priceDisplay: 'fixed' }, { merge: true })
  await put(`hosts/${hostId}/services/s-color`, { priceUsd: 0, priceDisplay: 'varies' }, { merge: true })
  return `a register, 3 categories, 9 register products with modifiers and quick keys, 2 services, 3 bookings`
}

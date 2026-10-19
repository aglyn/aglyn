/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The store and bookings of the demo site (from AGL-3621's seed), so the
 * Aglyn app's Orders, Products, Scan, Sales and Bookings screens have
 * something to show: products with barcodes and stock, orders in every state,
 * a month of traffic, two services and this week's bookings, in the shapes the
 * console writes.
 */

const HOUR = 60 * 60_000
const DAY = 24 * HOUR
const ZONE = 'America/Chicago'

/** An instant at `hour:minute` in the site's zone, `dayOffset` days from `now`. */
function zonedAt(now, dayOffset, hour, minute = 0) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date(now))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset, hour, minute)
  const shown = new Date(guess).toLocaleString('en-US', { timeZone: ZONE, hour12: false, hour: 'numeric' })
  return guess + (hour - (Number(shown) % 24)) * HOUR
}

const words = (text) => [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))]

/**
 * Product photos are optional: set `AGLYN_SEED_IMAGE_BASE` to a folder of `<name>.jpg` files
 * (a hosted bucket or a local static server) and every product carries one; unset, no product has a photo.
 */
const IMG = (process.env.AGLYN_SEED_IMAGE_BASE || '').replace(/\/$/, '')
export const imageUrl = (name) => (IMG ? `${IMG}/${name}.jpg` : undefined)
export const imageFields = (name) => {
  const url = imageUrl(name)
  return url ? { mediaUrls: [url], imageUrl: url } : {}
}

export const COMMERCE_PRODUCTS = [
  { id: 'p-mug', name: 'Stoneware Mug', price: 24, sku: 'MUG-01', barcode: '0123456789012', stock: 18 },
  { id: 'p-beans', name: 'House Blend Coffee Beans', price: 16.5, sku: 'BEAN-12', barcode: '0850012345678', stock: 4 },
  { id: 'p-tote', name: 'Canvas Tote Bag', price: 19, sku: 'TOTE-01', barcode: '0850098765432', stock: 32 },
  { id: 'p-pour', name: 'Pour-Over Kettle', price: 58, sku: 'KETL-01', barcode: '0850011122233', stock: 0 },
  { id: 'p-cinnamon', name: 'Cinnamon Roll Box (6)', price: 22, sku: 'ROLL-06', barcode: '0850055566677', stock: 11, img: 'cinnamon' },
  { id: 'p-cookies', name: 'Holiday Cookie Tin', price: 28, sku: 'COOK-TIN', barcode: '0850044455566', stock: 26, img: 'cookies' },
  { id: 'p-concentrate', name: 'Cold Brew Concentrate', price: 14, sku: 'CB-32', barcode: '0850033344455', stock: 40, img: 'coldbrew-conc' },
  { id: 'p-cake', name: 'Birthday Cake, 8 inch', price: 48, sku: 'CAKE-08', barcode: '', stock: null, img: 'cake' },
  { id: 'p-gift', name: 'Gift Card', price: 50, sku: 'GIFT-50', barcode: '', stock: null, type: 'digital', img: 'gift' },
]
const PRODUCT_IMAGES = { 'p-mug': 'mug', 'p-beans': 'beans', 'p-tote': 'tote', 'p-pour': 'pour' }

/** The customers the orders name, and the order statuses they cycle through (`returns.mjs` reads both). */
export const COMMERCE_PEOPLE = [
  ['Maya Rodriguez', 'maya@example.com'],
  ['Daniel Kim', 'daniel@example.com'],
  ['Priya Nair', 'priya@example.com'],
  ['Renee Fournier', 'renee@example.com'],
  ['Sam Whitaker', 'sam@example.com'],
  ['Chloe Martin', 'chloe@example.com'],
  ['Aaliyah Grant', 'aaliyah@example.com'],
  ['Tyler Brooks', 'tyler@example.com'],
  ['Isabel Moreno', 'isabel@example.com'],
  ['Owen Parker', 'owen@example.com'],
  ['Naomi Brooks', 'naomi@example.com'],
  ['Marcus Hale', 'marcus@example.com'],
]
export const COMMERCE_ORDER_STATUSES = ['paid', 'paid', 'partially_fulfilled', 'fulfilled', 'delivered', 'refunded', 'paid', 'fulfilled']

export async function seedCommerce({ put, hostId, now: date, nameSearchFields }) {
  const now = date.getTime()
  const products = COMMERCE_PRODUCTS
  for (const product of products) {
    const variants = [
      {
        id: 'default',
        sku: product.sku,
        ...(product.barcode ? { barcode: product.barcode } : {}),
        priceUsd: product.price,
        inventory: product.stock,
      },
    ]
    await put(`hosts/${hostId}/products/${product.id}`, {
      ...nameSearchFields(product.name),
      slug: product.id.slice(2),
      ...imageFields(product.img ?? PRODUCT_IMAGES[product.id]),
      type: product.type ?? 'physical',
      status: 'active',
      variants,
      skus: [product.sku.toLowerCase()],
      ...(product.barcode ? { barcodes: [product.barcode] } : {}),
      inventory: product.stock,
      priceFromCents: Math.round(product.price * 100),
      deletedAt: null,
      createdAtMs: now - 30 * DAY,
      updatedAtMs: now - DAY,
    })
  }

  await put(`hosts/${hostId}/settings/store`, { currency: 'USD', name: 'Juniper Street Bakery', tax: { mode: 'manual', pricesIncludeTax: false, origin: { country: 'US', state: 'TX' }, rates: [{ country: 'US', state: 'TX', pct: 8.25, label: 'TX sales tax' }] } })
  await put(`hosts/${hostId}`, { timeZone: ZONE }, { merge: true })

  let number = 1040
  for (let index = 0; index < 16; index += 1) {
    number += 1
    const [name, email] = COMMERCE_PEOPLE[(index * 5 + (index >> 2)) % COMMERCE_PEOPLE.length]
    const status = COMMERCE_ORDER_STATUSES[index % COMMERCE_ORDER_STATUSES.length]
    const pool = products.filter((entry) => entry.type !== 'digital')
    const pick = pool[(index * 5) % pool.length]
    const quantity = (index % 3) + 1
    const itemsCents = Math.round(pick.price * 100) * quantity
    const shippingCents = 599
    const taxCents = Math.round(itemsCents * 0.0825)
    const totalCents = itemsCents + shippingCents + taxCents
    const createdAtMs = now - index * 0.9 * DAY - 2 * HOUR
    await put(`hosts/${hostId}/orders/o-${number}`, {
      number,
      status,
      channel: index % 5 === 4 ? 'pos' : 'online',
      customerName: name,
      customerEmail: email,
      searchTokens: [...words(name), ...words(email), String(number)],
      productIds: [pick.id],
      lineItems: [
        {
          productId: pick.id,
          variantId: 'default',
          name: pick.name,
          quantity,
          unitAmountCents: Math.round(pick.price * 100),
          productType: 'physical',
          requiresShipping: true,
          sku: pick.sku,
        },
      ],
      totals: { itemsCents, shippingCents, taxCents, discountCents: 0, totalCents, feeCents: Math.round(totalCents * 0.029) + 30 },
      ...(status === 'refunded' ? { refundedCents: totalCents } : {}),
      ...(status === 'fulfilled' || status === 'delivered' || status === 'partially_fulfilled'
        ? {
            fulfillments: [
              {
                id: `f-${number}`,
                lineItemIds: [0],
                lines: [{ lineItemId: 0, quantity: status === 'partially_fulfilled' ? 1 : quantity }],
                carrier: 'usps',
                trackingNumber: `9400111202555${String(number).padStart(9, '0')}`,
                atMs: createdAtMs + DAY,
              },
            ],
          }
        : {}),
      shippingAddress: { name, line1: '100 Main St', city: 'Austin', state: 'TX', postalCode: '78701', country: 'US' },
      paymentIntentId: `pi_demo_${number}`,
      livemode: true,
      createdAtMs,
    })
  }

  for (let day = 0; day < 31; day += 1) {
    const id = new Date(now - day * DAY).toISOString().slice(0, 10)
    const visitors = 60 + ((day * 37) % 50)
    await put(`hosts/${hostId}/analytics/${id}`, { total: visitors * 3, visitors })
  }

  const weekdays = Object.fromEntries([1, 2, 3, 4, 5, 6].map((day) => [day, [{ start: 9 * 60, end: 17 * 60 }]]))
  await put(`hosts/${hostId}/services/s-cut`, {
    name: 'Pastry class',
    durationMinutes: 45,
    priceUsd: 45,
    timezone: ZONE,
    windows: weekdays,
    status: 'active',
  })
  await put(`hosts/${hostId}/services/s-color`, {
    name: 'Custom cake consultation',
    durationMinutes: 30,
    timezone: ZONE,
    windows: weekdays,
    status: 'active',
  })

  const at = (day, hour, minute) => zonedAt(now, day, hour, minute)
  const bookings = [
    ['b-1', 's-cut', 'Pastry class', 'Maya Rodriguez', 'maya@example.com', 0, 9, 0, { paidAmountCents: 4500, checkedInAtMs: at(0, 8, 55) }],
    ['b-2', 's-color', 'Custom cake consultation', 'Daniel Kim', 'daniel@example.com', 0, 10, 30, { phone: '+1 512 555 0142' }],
    ['b-3', 's-cut', 'Pastry class', 'Priya Nair', 'priya@example.com', 0, 13, 0, { paidAmountCents: 4500 }],
    ['b-4', 's-cut', 'Pastry class', 'Chloe Martin', 'chloe@example.com', 0, 15, 15, {}],
    ['b-5', 's-color', 'Custom cake consultation', 'Renee Fournier', 'renee@example.com', 1, 11, 0, {}],
    ['b-6', 's-cut', 'Pastry class', 'Sam Whitaker', 'sam@example.com', 2, 14, 0, { paidAmountCents: 4500 }],
    ['b-7', 's-cut', 'Pastry class', 'Maya Rodriguez', 'maya@example.com', 3, 9, 45, {}],
    ['b-8', 's-color', 'Custom cake consultation', 'Priya Nair', 'priya@example.com', 4, 16, 0, { status: 'canceled' }],
  ]
  for (const [id, serviceId, serviceName, name, email, day, hour, minute, extra] of bookings) {
    const startsAtMs = at(day, hour, minute)
    const minutes = serviceId === 's-cut' ? 45 : 30
    await put(`hosts/${hostId}/bookings/${id}`, {
      serviceId,
      serviceName,
      name,
      email,
      status: 'confirmed',
      startsAtMs,
      endsAtMs: startsAtMs + minutes * 60_000,
      timezone: ZONE,
      createdAt: new Date(now - 3 * DAY),
      ...extra,
    })
  }
  return `${products.length} products, 16 orders, 31 days of traffic, 2 services, ${bookings.length} bookings`
}

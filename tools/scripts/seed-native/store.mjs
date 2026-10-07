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

export const COMMERCE_PRODUCTS = [
  { id: 'p-mug', name: 'Stoneware Mug', price: 24, sku: 'MUG-01', barcode: '0123456789012', stock: 18 },
  { id: 'p-beans', name: 'House Blend Coffee Beans', price: 16.5, sku: 'BEAN-12', barcode: '0850012345678', stock: 4 },
  { id: 'p-tote', name: 'Canvas Tote Bag', price: 19, sku: 'TOTE-01', barcode: '0850098765432', stock: 32 },
  { id: 'p-pour', name: 'Pour-Over Kettle', price: 58, sku: 'KETL-01', barcode: '0850011122233', stock: 0 },
  { id: 'p-gift', name: 'Gift Card', price: 50, sku: 'GIFT-50', barcode: '', stock: null, type: 'digital' },
]

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

  await put(`hosts/${hostId}/settings/store`, { currency: 'USD', name: 'Demo Coffee Co.' })
  await put(`hosts/${hostId}`, { timeZone: ZONE }, { merge: true })

  const people = [
    ['Ada Lovelace', 'ada@example.com'],
    ['Grace Hopper', 'grace@example.com'],
    ['Alan Turing', 'alan@example.com'],
    ['Katherine Johnson', 'katherine@example.com'],
    ['Linus Pauling', 'linus@example.com'],
    ['Hedy Lamarr', 'hedy@example.com'],
  ]
  const statuses = ['paid', 'paid', 'partially_fulfilled', 'fulfilled', 'delivered', 'refunded', 'paid', 'fulfilled']
  let number = 1040
  for (let index = 0; index < 16; index += 1) {
    number += 1
    const [name, email] = people[index % people.length]
    const status = statuses[index % statuses.length]
    const pick = products[index % 4]
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
      livemode: false,
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
    name: 'Haircut',
    durationMinutes: 45,
    priceUsd: 45,
    timezone: ZONE,
    windows: weekdays,
    status: 'active',
  })
  await put(`hosts/${hostId}/services/s-color`, {
    name: 'Color consultation',
    durationMinutes: 30,
    timezone: ZONE,
    windows: weekdays,
    status: 'active',
  })

  const at = (day, hour, minute) => zonedAt(now, day, hour, minute)
  const bookings = [
    ['b-1', 's-cut', 'Haircut', 'Ada Lovelace', 'ada@example.com', 0, 9, 0, { paidAmountCents: 4500, checkedInAtMs: at(0, 8, 55) }],
    ['b-2', 's-color', 'Color consultation', 'Grace Hopper', 'grace@example.com', 0, 10, 30, { phone: '+1 512 555 0142' }],
    ['b-3', 's-cut', 'Haircut', 'Alan Turing', 'alan@example.com', 0, 13, 0, { paidAmountCents: 4500 }],
    ['b-4', 's-cut', 'Haircut', 'Hedy Lamarr', 'hedy@example.com', 0, 15, 15, {}],
    ['b-5', 's-color', 'Color consultation', 'Katherine Johnson', 'katherine@example.com', 1, 11, 0, {}],
    ['b-6', 's-cut', 'Haircut', 'Linus Pauling', 'linus@example.com', 2, 14, 0, { paidAmountCents: 4500 }],
    ['b-7', 's-cut', 'Haircut', 'Ada Lovelace', 'ada@example.com', 3, 9, 45, {}],
    ['b-8', 's-color', 'Color consultation', 'Alan Turing', 'alan@example.com', 4, 16, 0, { status: 'canceled' }],
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

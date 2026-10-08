/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Analytics and events of the demo site (AGL-3670), so the Aglyn app's
 * Analytics, Events and Bookings screens show every state they draw: a month
 * of traffic with pages, referrers, devices and campaign labels (as
 * `/api/analytics/collect` writes them), the per-page day documents behind
 * the Pages table and the site's `screens` map that names them, published,
 * draft and deleted events, and the booking states the store seed does not
 * hold (an expired payment hold, one awaiting payment, one moved).
 */

const HOUR = 60 * 60_000
const DAY = 24 * HOUR

const PAGES = [
  ['home', '/', 9],
  ['menu', '/menu', 5],
  ['about', '/about', 3],
  ['book', '/book', 2],
]
const REFERRERS = [['google_com', 6], ['instagram_com', 3], ['news_ycombinator_com', 1]]

export async function seedInsights({ put, hostId, now: date }) {
  const now = date.getTime()
  await put(
    `hosts/${hostId}`,
    { screens: Object.fromEntries(PAGES.map(([id, path]) => [id, path])) },
    { merge: true },
  )
  let pageDocs = 0
  for (let day = 0; day < 31; day += 1) {
    const id = new Date(now - day * DAY).toISOString().slice(0, 10)
    const visitors = 60 + ((day * 37) % 50)
    const total = visitors * 3
    const share = (weight, of) => Math.max(1, Math.round((total * weight) / of))
    const pageWeights = PAGES.reduce((sum, [, , weight]) => sum + weight, 0)
    const referrerWeights = REFERRERS.reduce((sum, [, weight]) => sum + weight, 0)
    await put(`hosts/${hostId}/analytics/${id}`, {
      total,
      visitors,
      paths: Object.fromEntries(PAGES.map(([, path, weight]) => [path, share(weight, pageWeights)])),
      referrers: Object.fromEntries(REFERRERS.map(([host, weight]) => [host, share(weight, referrerWeights * 3)])),
      devices: { mobile: share(6, 10), desktop: share(3, 10), tablet: share(1, 10) },
      utm: {
        source: { newsletter: share(1, 8), instagram: share(1, 12) },
        medium: { email: share(1, 8) },
        campaign: { 'fall-menu': share(1, 9), 'brunch-launch': share(1, 20) },
      },
    })
    for (const [screenId, , weight] of PAGES) {
      await put(`hosts/${hostId}/screenAnalytics/${screenId}:${id}`, {
        screenId,
        day: id,
        total: share(weight, pageWeights),
        devices: { mobile: share(weight * 6, pageWeights * 10), desktop: share(weight * 4, pageWeights * 10) },
        referrers: { google_com: share(weight * 2, pageWeights * 5) },
        dwellMs: 45_000 * weight,
        dwellSamples: weight,
      })
      pageDocs += 1
    }
  }

  const events = [
    ['ev-tasting', 'Fall menu tasting', 5, 18, 2, 'published', { location: 'Main dining room', organizer: 'Chef Ana' }],
    ['ev-latte', 'Latte art workshop', 9, 10, 1.5, 'published', { location: 'Coffee bar', description: 'Bring a friend; milk and cups provided.' }],
    ['ev-brunch', 'Holiday brunch', 40, 11, 3, 'draft', {}],
    ['ev-past', 'Summer patio night', -30, 19, 3, 'published', { location: 'Patio' }],
    ['ev-gone', 'Canceled pop-up', 12, 17, 2, 'deleted', { deletedAt: new Date(now - DAY) }],
  ]
  for (const [id, title, dayOffset, hour, hours, status, extra] of events) {
    const start = new Date(now + dayOffset * DAY)
    start.setUTCHours(hour + 5, 0, 0, 0)
    const startsAtMs = start.getTime()
    await put(`hosts/${hostId}/events/${id}`, {
      title,
      startsAtMs,
      endsAtMs: startsAtMs + hours * HOUR,
      status,
      createdAt: new Date(now - 7 * DAY),
      updatedAt: new Date(now - DAY),
      ...extra,
    })
  }

  const later = (days, hour) => {
    const at = new Date(now + days * DAY)
    at.setUTCHours(hour + 5, 0, 0, 0)
    return at.getTime()
  }
  const more = [
    ['b-9', 'Haircut', 's-cut', 'Mary Jackson', 'mary@example.com', later(1, 14), 45, { status: 'pendingPayment', expiresAtMs: now + 10 * 60_000 }],
    ['b-10', 'Haircut', 's-cut', 'Dorothy Vaughan', 'dorothy@example.com', later(2, 10), 45, { status: 'pendingPayment', expiresAtMs: now - HOUR }],
    ['b-11', 'Color consultation', 's-color', 'Margaret Hamilton', 'margaret@example.com', later(1, 16), 30, { rescheduledFromMs: later(0, 16), address: '12 Lake Rd, Austin TX' }],
    ['b-12', 'Haircut', 's-cut', 'Ada Lovelace', 'ada@example.com', later(-6, 11), 45, { paidAmountCents: 4500, refundedCents: 4500, status: 'canceled' }],
  ]
  for (const [id, serviceName, serviceId, name, email, startsAtMs, minutes, extra] of more) {
    await put(`hosts/${hostId}/bookings/${id}`, {
      serviceId,
      serviceName,
      name,
      email,
      status: 'confirmed',
      startsAtMs,
      endsAtMs: startsAtMs + minutes * 60_000,
      timezone: 'America/Chicago',
      createdAt: new Date(now - 2 * DAY),
      ...extra,
    })
  }
  return `31 days of traffic with pages and campaigns, ${pageDocs} page-day documents, ${events.length} events, ${more.length} more bookings`
}

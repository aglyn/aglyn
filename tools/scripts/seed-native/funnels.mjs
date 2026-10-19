/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The demo site's funnels and the visits they measure (AGL-3966), so the
 * Aglyn app's Funnels screen lists funnels and its results read numbers:
 *
 * - `hosts/{hostId}/funnels`: `StoredFunnel` (funnels.types.ts), as the save
 *   route writes one, plus a `draft` an AI build left for review.
 * - `hosts/{hostId}/funnelJourneys`: a fortnight of recorded visits in the
 *   shape the site collector writes and `readJourneys` reads (`steps` of
 *   `{ t, k, at }`, `source`, `startedAt`), dropping off along the way.
 */

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export async function seedFunnels({ put, uid, hostId, now: date }) {
  const now = date.getTime()
  const funnels = [
    {
      id: 'seed-funnel-order',
      name: 'Menu to order',
      steps: [
        { type: 'page', key: '/', match: 'exact', label: 'Home' },
        { type: 'page', key: '/pricing', match: 'prefix', label: 'Pricing' },
        { type: 'cart', key: '', label: 'Added to cart' },
        { type: 'order', key: '', label: 'Ordered' },
      ],
    },
    {
      id: 'seed-funnel-catering',
      name: 'Catering quote',
      steps: [
        { type: 'page', key: '/catering', match: 'exact', label: 'Catering' },
        { type: 'form', key: 'quote-request', label: 'Quote request' },
      ],
    },
    {
      id: 'seed-funnel-class',
      name: 'Pastry class sign-up',
      status: 'draft',
      steps: [
        { type: 'page', key: '/custom-cakes', match: 'exact', label: 'Custom cakes' },
        { type: 'booking', key: 's-cut', label: 'Booked a class' },
      ],
    },
  ]
  for (const { id, ...funnel } of funnels) {
    await put(`hosts/${hostId}/funnels/${id}`, {
      ...funnel,
      createdBy: uid,
      createdAt: new Date(now - 12 * DAY),
      updatedAt: new Date(now - 2 * DAY),
    })
  }

  // Each visit walks the order funnel, or the catering one, as far as its number says.
  const sources = [{ referrerHost: 'google.com' }, { utmSource: 'instagram', utmMedium: 'social' }, {}, { referrerHost: 'yelp.com' }]
  let visits = 0
  for (let index = 0; index < 48; index += 1) {
    const startedAtMs = now - (index % 14) * DAY - (index * 37 % 600) * MINUTE - 5 * MINUTE
    const catering = index % 4 === 3
    const path = catering
      ? [['page', '/catering'], ['form', 'quote-request']].slice(0, index % 3 === 0 ? 1 : 2)
      : [['page', '/'], ['page', '/pricing'], ['cart', ''], ['order', '']].slice(0, 1 + (index % 7 === 0 ? 3 : index % 3))
    const steps = path.map(([t, k], at) => ({ t, k, at: startedAtMs + at * 2 * MINUTE }))
    await put(`hosts/${hostId}/funnelJourneys/seed-visit-${String(index).padStart(2, '0')}`, {
      steps,
      source: sources[index % sources.length],
      startedAt: new Date(startedAtMs),
      lastAt: steps[steps.length - 1].at,
      expiresAt: new Date(startedAtMs + 90 * DAY),
    })
    visits += 1
  }
  return `${funnels.length} funnels, ${visits} visits`
}

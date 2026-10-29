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
 * The bakery fixtures the docs captures photograph (`tools/e2e/seed-docs-fixtures.mjs`),
 * as pure builders, so the store-review workspace (`seed-review-org.mjs`) seeds
 * the same API-key list, chargeback, traffic curve, business profile and AI
 * memory without a second copy of any of them.
 *
 * Every builder returns plain data. Times are produced through `at(ms)`, which
 * defaults to a `Date`; the emulator seed passes `Timestamp.fromMillis` so its
 * documents are byte-for-byte what they were before the builders moved here.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** @param {number} ms */
const asDate = (ms) => new Date(ms)

/**
 * One day of the site's traffic counter, `hosts/{host}/analytics/{YYYY-MM-DD}`,
 * in the shape the tenant's collector writes (map keys with `.` `$` `#` `[`
 * `]` replaced by `_`). Deterministic in `back`, so two runs draw the same
 * curve: a weekly rhythm, a slow climb, and a spring-menu campaign in the last
 * fortnight.
 *
 * @param {number} back days before `nowMs`, 0 = today
 * @param {number} nowMs
 * @returns {{ id: string, data: Record<string, unknown> }}
 */
export function trafficDay(back, nowMs) {
  const at = nowMs - back * DAY_MS
  const id = new Date(at).toISOString().slice(0, 10)
  const weekday = new Date(at).getUTCDay()
  const weekend = weekday === 0 || weekday === 6
  const trend = 1 + (60 - back) / 90
  const campaign = back < 14 ? 1.25 : 1
  const wobble = 1 + (((back * 37) % 11) - 5) / 40
  const total = Math.round(120 * trend * campaign * wobble * (weekend ? 1.35 : 1))
  const share = (fraction) => Math.max(1, Math.round(total * fraction))
  return {
    id,
    data: {
      total,
      visitors: Math.round(total * 0.62),
      paths: {
        '/': share(0.38),
        '/menu': share(0.24),
        '/order': share(0.14),
        '/blog/spring-menu': share(back < 14 ? 0.12 : 0.03),
        '/about': share(0.07),
        '/visit': share(0.05),
      },
      referrers: {
        www_google_com: share(0.21),
        instagram_com: share(0.12),
        www_yelp_com: share(0.06),
        l_facebook_com: share(0.04),
      },
      devices: { mobile: share(0.58), desktop: share(0.36), tablet: share(0.06) },
      ...(back < 14 && {
        utm: {
          source: { instagram: share(0.07), newsletter: share(0.05) },
          medium: { social: share(0.07), email: share(0.05) },
          campaign: { 'spring-menu': share(0.12) },
        },
      }),
    },
  }
}

/**
 * `days` days of {@link trafficDay}, newest first. Sixty by default, so the
 * 30-day range has a prior window to compare against.
 *
 * @param {number} nowMs
 * @param {number} [days]
 */
export function trafficDays(nowMs, days = 60) {
  return Array.from({ length: days }, (_, back) => trafficDay(back, nowMs))
}

/**
 * The API-key list (docs shot A8): two live keys, one used three hours ago and
 * one never, plus a REVOKED one the card is expected to leave out.
 *
 * The collection is top-level `apiKeys` and a real key's document id is the
 * SHA-256 of its token. These ids are the hash of nothing, so no string ever
 * authenticates against them: `verifyApiKey` hashes what it is given and finds
 * no document. `idFor` picks the ids, so each caller keeps its own.
 *
 * @param {{ orgId: string, createdBy: string, nowMs: number,
 *   idFor?: (keyId: string, index: number) => string,
 *   at?: (ms: number) => unknown }} options
 * @returns {Array<{ id: string, data: Record<string, unknown> }>}
 */
export function apiKeyFixtures({ orgId, createdBy, nowMs, idFor, at = asDate }) {
  const daysAgo = (days) => at(nowMs - days * DAY_MS)
  const keys = [
    {
      id: 'd0c5'.repeat(16),
      keyId: 'key_docsZapierA',
      name: 'zapier-orders-sync',
      keyPrefix: 'aglyn_sk_7f3a9c…',
      scopes: ['orders:read', 'products:read'],
      createdAt: daysAgo(38),
      // A key in daily use.
      lastUsedAt: at(nowMs - 3 * HOUR_MS),
      revokedAt: null,
    },
    {
      id: 'e1b7'.repeat(16),
      keyId: 'key_docsFormsB',
      name: 'nightly-forms-export',
      keyPrefix: 'aglyn_sk_2c81e4…',
      scopes: ['forms:read', 'datasets:read'],
      createdAt: daysAgo(6),
      // Never used: renders `Last used —`.
      lastUsedAt: null,
      revokedAt: null,
    },
    {
      // Revoked: `OrgApiKeysCard` filters it out, so it must NOT render.
      id: 'a9f2'.repeat(16),
      keyId: 'key_docsRevokedC',
      name: 'old-migration-script',
      keyPrefix: 'aglyn_sk_9b40df…',
      scopes: ['datasets:read', 'datasets:write'],
      createdAt: daysAgo(120),
      lastUsedAt: daysAgo(96),
      revokedAt: daysAgo(95),
    },
  ]
  return keys.map(({ id, ...key }, index) => ({
    id: idFor ? idFor(key.keyId, index) : id,
    data: { ...key, orgId, createdBy, expiresAt: null },
  }))
}

/**
 * A charged-back order (docs shot A13), in `HostOrder`'s field names.
 *
 * `status` stays `refunded`: the chargeback chip renders BESIDE the Refunded
 * chip, and the pair is the point, a lost dispute being a refund the merchant
 * did not choose.
 *
 * @param {{ number: number, nowMs: number, productId: string, productName: string,
 *   unitAmountCents?: number, quantity?: number, customerName?: string,
 *   customerEmail?: string, at?: (ms: number) => unknown }} options
 */
export function chargebackOrder({
  number,
  nowMs,
  productId,
  productName,
  unitAmountCents = 2600,
  quantity = 2,
  customerName = 'Jordan Avery',
  customerEmail = 'jordan.avery@example.com',
  at = asDate,
}) {
  const daysAgoMs = (days) => nowMs - days * DAY_MS
  const itemsCents = unitAmountCents * quantity
  const shippingCents = 600
  const taxCents = 400
  const totalCents = itemsCents + shippingCents + taxCents
  return {
    number,
    status: 'refunded',
    channel: 'online',
    customerEmail,
    customerName,
    lineItems: [{ productId, name: productName, quantity, unitAmountCents }],
    totals: { itemsCents, shippingCents, taxCents, discountCents: 0, totalCents, feeCents: 210 },
    // Reversals land in the same field a merchant refund does (AGL-1787); the
    // dispute block is what tells the two apart.
    refundedCents: totalCents,
    dispute: {
      id: 'dp_docsfixture',
      // Both, and both `lost`: `describeOrderDispute` reads `outcome ?? status`.
      status: 'lost',
      outcome: 'lost',
      reason: 'product_not_received',
      amountCents: totalCents,
      openedAtMs: daysAgoMs(11),
      evidenceDueByMs: daysAgoMs(4),
      closedAtMs: daysAgoMs(3),
      reversedCents: totalCents,
    },
    createdAtMs: daysAgoMs(14),
    createdAt: at(daysAgoMs(14)),
  }
}

/**
 * What Aglyn AI has learned about the owner's edits, `hosts/{host}/aiMemory`.
 *
 * @param {{ nowMs: number, idFor?: (id: string) => string }} options
 * @returns {Array<{ id: string, data: Record<string, unknown> }>}
 */
export function aiMemoryFixtures({ nowMs, idFor = (id) => id }) {
  return [
    ['copy-short', 'length', 'Prefers short, concise copy', 3, 0],
    ['removes-testimonials', 'removes-testimonials', 'Removes testimonial and review sections', 2, 1],
    ['no-emoji', 'emoji', 'Does not want emoji in copy', 1, 2],
  ].map(([id, group, text, count, ageDays]) => ({
    id: idFor(id),
    data: { group, text, count, lastSeenAtMs: nowMs - ageDays * DAY_MS, source: 'assist-edit' },
  }))
}

/**
 * Setup → Business profile: the site's profile document
 * (`hosts/{host}/businessProfile/profile`) and the workspace defaults
 * (`orgs/{org}/businessProfile/defaults`), each with a source per field. A
 * `founded` year (AGL-4092) is the guided start's, and is stored only when
 * given, so a seed that passes none writes what it wrote before.
 *
 * @param {{ at: unknown, whatYouDo?: string, services?: string[], audience?: string,
 *   tone?: string, serviceArea?: string, toneNotes?: string, founded?: string }} options
 */
export function businessProfileFixtures({
  at,
  whatYouDo = 'A neighborhood bakery baking sourdough, pastries and cakes to order every morning',
  services = ['Sourdough loaves', 'Morning pastries', 'Custom celebration cakes', 'Wholesale for cafés'],
  audience = 'Neighbors who want fresh bread and families planning a celebration',
  tone = 'friendly',
  serviceArea = 'Austin, Texas',
  toneNotes = 'Warm and plain. No exclamation marks.',
  founded,
}) {
  return {
    profile: {
      whatYouDo,
      services,
      audience,
      tone,
      ...(founded ? { founded } : {}),
      sources: { whatYouDo: 'start', services: 'start', audience: 'ai', tone: 'ai', ...(founded ? { founded: 'start' } : {}) },
      updatedAt: at,
      updatedBy: null,
    },
    defaults: {
      serviceArea,
      toneNotes,
      sources: { serviceArea: 'owner', toneNotes: 'owner' },
      updatedAt: at,
    },
  }
}

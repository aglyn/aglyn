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

// ADDITIVE fixtures for the documentation captures (AGL-1950), layered on top
// of `seed-e2e.mjs` rather than folded into it.
//
// Separate file on purpose. These fixtures exist to be PHOTOGRAPHED — they are
// shaped for what a docs image has to show, which is not the same goal as the
// e2e suite's fixtures, and three of the plan's shots were blocked only because
// the base seed carries no populated API-key list, no site-scoped collaborator
// and no orders at all. Keeping them here means the e2e seed's assertions
// (seat counts, member counts, empty-state pages) do not silently move under a
// suite that never asked for a third member or a disputed order.
//
//   FIRESTORE_EMULATOR_HOST=localhost:8082 \
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//     node tools/e2e/seed-docs-fixtures.mjs [--host demo] [--project aglyn-main]
//
// Idempotent: deterministic `docs-…` ids, merge-set writes.

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
) {
  console.error(
    'Refusing to run: FIRESTORE_EMULATOR_HOST and ' +
      'FIREBASE_AUTH_EMULATOR_HOST must both point at local emulators. ' +
      'These fixtures are emulator-only by design.',
  )
  process.exit(1)
}

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index !== -1 ? args[index + 1] : fallback
}

const projectId = argValue('--project', 'aglyn-main')
const hostId = argValue('--host', 'demo')
// Matches seed-e2e.mjs: the org doc id is the owner's uid.
const orgId = 'e2e-owner'

if (!getApps().length) initializeApp({ projectId })
const firestore = getFirestore()

const put = async (ref, data) => {
  await ref.set(data, { merge: true })
  console.log(`  ${ref.path}`)
}

const now = Timestamp.now()
const daysAgo = (days) =>
  Timestamp.fromMillis(now.toMillis() - days * 24 * 60 * 60 * 1000)

// ── A8. API keys ────────────────────────────────────────────────────────────
// The collection is TOP-LEVEL `apiKeys` and the DOCUMENT ID IS THE SHA-256 OF
// THE RAW TOKEN — so a fixture needs no token to exist. These ids are the
// hashes of nothing: no key was ever minted, no string authenticates against
// them, and `verifyApiKey` hashes what it is given and finds no document.
//
// That is what makes this shot safe where A10 is not. A10 photographs a live
// credential and can only be made safe by revoking it afterwards; this one
// photographs a list whose secrets never existed. Do not "improve" it by
// minting real keys through the API — that reintroduces exactly the hazard the
// plan spends a paragraph on.
console.log('API keys (A8):')
const apiKeys = [
  {
    // 64 hex chars, deterministic, and deliberately not the hash of anything.
    id: 'd0c5'.repeat(16),
    keyId: 'key_docsZapierA',
    name: 'zapier-orders-sync',
    keyPrefix: 'aglyn_sk_7f3a9c…',
    scopes: ['orders:read', 'products:read'],
    createdAt: daysAgo(38),
    // A key in daily use — the caption's populated half.
    lastUsedAt: Timestamp.fromMillis(now.toMillis() - 3 * 60 * 60 * 1000),
  },
  {
    id: 'e1b7'.repeat(16),
    keyId: 'key_docsFormsB',
    name: 'nightly-forms-export',
    keyPrefix: 'aglyn_sk_2c81e4…',
    scopes: ['forms:read', 'datasets:read'],
    createdAt: daysAgo(6),
    // Never used: renders `Last used —`. Both halves of the caption in one
    // frame, which is what callout ③ is pointing at.
    lastUsedAt: null,
  },
]
for (const key of apiKeys) {
  await put(firestore.collection('apiKeys').doc(key.id), {
    keyId: key.keyId,
    orgId,
    name: key.name,
    keyPrefix: key.keyPrefix,
    scopes: key.scopes,
    createdBy: 'e2e-owner',
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt,
    revokedAt: null,
    expiresAt: null,
  })
}

// A REVOKED key, seeded on purpose and expected NOT to render.
//
// The plan asks A8 to show "one revoked so the revoked state is visible".
// There is no such state: `OrgApiKeysCard` filters the list with
// `keys.filter((key) => !key.revokedAt)` before it maps rows, so a revoked key
// leaves the card entirely. This document is the negative control that proves
// it — seed it, shoot the card, and the row count says whether the filter is
// still there. Without it the correction in SCREENSHOT_PLAN.md would be a
// claim about code rather than something the capture itself demonstrates.
await put(firestore.collection('apiKeys').doc('a9f2'.repeat(16)), {
  keyId: 'key_docsRevokedC',
  orgId,
  name: 'old-migration-script',
  keyPrefix: 'aglyn_sk_9b40df…',
  scopes: ['datasets:read', 'datasets:write'],
  createdBy: 'e2e-owner',
  createdAt: daysAgo(120),
  lastUsedAt: daysAgo(96),
  revokedAt: daysAgo(95),
  expiresAt: null,
})

// ── A11. A site-scoped collaborator ─────────────────────────────────────────
// The distinction the shot exists to show is NOT a role value — managers and
// collaborators share one vocabulary (`owner|admin|editor|viewer`). It is
// reach: `isOrgWideMember` returns false only for a member that carries
// `allHosts: false` AND a non-empty `hostAccess`. Both are required. A doc
// with neither is read as a LEGACY org-wide member and would render `Team
// manager`, which is the quiet way this fixture could produce the wrong image.
//
// Seat accounting follows from the same predicate: `countManagerSeats` counts
// org-wide members only, so this row moves the "N site collaborators" half of
// the seat line and leaves the manager count where the e2e suite expects it.
console.log('Site collaborator (A11):')
await put(
  firestore.collection('orgs').doc(orgId).collection('members').doc('docs-collab'),
  {
    email: 'docs-collab@aglyn.test',
    displayName: 'Priya Raman',
    role: 'editor',
    status: 'active',
    allHosts: false,
    hostAccess: { [hostId]: 'editor' },
    joinedAt: daysAgo(21),
    createdAt: daysAgo(21),
  },
)
// The reverse index the console reads for "which orgs am I in", kept in step
// with the member doc — `orgWide: false` is its mirror of `allHosts`.
await put(
  firestore.collection('users').doc('docs-collab').collection('orgs').doc(orgId),
  {
    orgName: 'E2E Bakery Co',
    slug: 'e2e-bakery',
    role: 'editor',
    orgWide: false,
    createdAt: daysAgo(21),
  },
)
await put(
  firestore
    .collection('users')
    .doc('docs-collab')
    .collection('hostMemberships')
    .doc(hostId),
  {
    hostId,
    orgId,
    role: 'editor',
    displayName: 'Demo Bakery',
    createdAt: daysAgo(21),
  },
)

// ── A13. A charged-back order (and enough neighbours to be a list) ──────────
// Field names come from `HostOrder`, NOT from the demo-brands seeder. That
// seeder writes `orderNumber`/`email`/`items[].unitPriceCents`, none of which
// the model reads — an order seeded in its shape renders with a doc-id order
// number, an em-dash customer and a blank line item, which photographs as a
// broken console rather than as a chargeback.
//
// `status` stays `refunded` and the `Refunded` status chip stays in frame: the
// chargeback chip is rendered BESIDE it, not instead of it, and the pair is the
// point — a lost dispute is a refund the merchant did not choose. A fixture
// that set status to something tidier would quietly delete the distinction the
// docs page is trying to draw.
console.log('Orders (A13):')
const hostOrdersRef = firestore.collection('hosts').doc(hostId).collection('orders')
const orderAt = (days) => ({
  createdAtMs: daysAgo(days).toMillis(),
  createdAt: daysAgo(days),
})

await put(hostOrdersRef.doc('docs-order-chargeback'), {
  number: 1042,
  status: 'refunded',
  channel: 'online',
  customerEmail: 'jordan.avery@example.com',
  customerName: 'Jordan Avery',
  lineItems: [
    {
      productId: 'seed-product-sourdough',
      name: 'Sourdough loaf — subscription box',
      quantity: 2,
      unitAmountCents: 2600,
    },
  ],
  totals: {
    itemsCents: 5200,
    shippingCents: 600,
    taxCents: 400,
    discountCents: 0,
    totalCents: 6200,
    feeCents: 210,
  },
  // Reversals land in the same field a merchant refund does (AGL-1787); the
  // dispute block is what tells the two apart.
  refundedCents: 6200,
  dispute: {
    id: 'dp_docsfixture',
    // Both, and both `lost`: `describeOrderDispute` reads `outcome ?? status`,
    // and the webhook overwrites `status` with the outcome when it closes.
    status: 'lost',
    outcome: 'lost',
    reason: 'product_not_received',
    amountCents: 6200,
    openedAtMs: daysAgo(11).toMillis(),
    // Still set after close, deliberately — it is not an open/closed test.
    evidenceDueByMs: daysAgo(4).toMillis(),
    closedAtMs: daysAgo(3).toMillis(),
    reversedCents: 6200,
  },
  ...orderAt(14),
})

// Ordinary neighbours. With zero orders the card renders its empty-state
// invitation and neither the filter row nor the table exists at all, so the
// Disputes filter in callout ③ has to have a list to sit above.
await put(hostOrdersRef.doc('docs-order-paid'), {
  number: 1043,
  status: 'paid',
  channel: 'online',
  customerEmail: 'wholesale@example.com',
  customerName: 'Robin Wholesale',
  lineItems: [
    {
      productId: 'seed-product-baguette',
      name: 'Baguette — dozen',
      quantity: 1,
      unitAmountCents: 3400,
    },
  ],
  totals: {
    itemsCents: 3400,
    shippingCents: 600,
    taxCents: 260,
    discountCents: 0,
    totalCents: 4260,
    feeCents: 150,
  },
  ...orderAt(5),
})
await put(hostOrdersRef.doc('docs-order-fulfilled'), {
  number: 1044,
  status: 'fulfilled',
  channel: 'pos',
  customerEmail: 'casey.lin@example.com',
  customerName: 'Casey Lin',
  lineItems: [
    {
      productId: 'seed-product-croissant',
      name: 'Croissant — half dozen',
      quantity: 3,
      unitAmountCents: 1800,
    },
  ],
  totals: {
    itemsCents: 5400,
    shippingCents: 0,
    taxCents: 410,
    discountCents: 500,
    totalCents: 5310,
    feeCents: 190,
  },
  ...orderAt(2),
})

// ── A14. An org on a plan WITHOUT commerce, whose site still sells ──────────
// The exact state the overview's admonition describes, and the reason the shot
// is worth taking: the plugin switchboard is an ORG field (`enabledPlugins`)
// and the plan gate is a separate entitlement, so the two can disagree. An org
// that drops to Free keeps `commerce` in `enabledPlugins` — the console page
// still renders, the Draft order button is still there, and the refusal only
// arrives when the draft is submitted.
//
// This is a SEPARATE org on purpose. Flipping the bakery's plan to `free`
// would have been one line, but every other shot in this plan is taken on that
// org and half of them read its plan (the retention funnel's over-Free-limits
// warning, the billing cards, the seat line). A fixture that mutates a shared
// org photographs the other shots as a side effect.
//
// Only `free` lacks `commerce` — every self-serve tier from Starter up carries
// it (`plan-entitlements.ts`), so `free` is the only plan that produces this.
console.log('\nFree-plan org that still has the commerce plugin on (A14):')
const freeOrgId = 'docs-free-org'
const freeOrgSlug = 'docs-free'
const freeHostId = 'docs-free-site'
const freeOrgName = 'Docs Downgraded Co'
await put(firestore.collection('orgs').doc(freeOrgId), {
  name: freeOrgName,
  slug: freeOrgSlug,
  ownerUid: 'e2e-owner',
  // The whole fixture is this one word.
  plan: 'free',
  // …and this list still carrying `commerce`. Dropping a plan does not
  // uninstall a plugin.
  enabledPlugins: ['mui', 'commerce'],
  subscription: { status: 'canceled' },
  createdAt: daysAgo(60),
})
await put(
  firestore.collection('orgs').doc(freeOrgId).collection('members').doc('e2e-owner'),
  {
    email: 'e2e@aglyn.test',
    displayName: 'E2E Owner',
    role: 'owner',
    status: 'active',
    createdAt: daysAgo(60),
  },
)
await put(
  firestore.collection('users').doc('e2e-owner').collection('orgs').doc(freeOrgId),
  { orgName: freeOrgName, slug: freeOrgSlug, role: 'owner', createdAt: daysAgo(60) },
)
await put(firestore.collection('orgSlugs').doc(freeOrgSlug), {
  orgId: freeOrgId,
  createdAt: daysAgo(60),
})
await put(firestore.collection('hostIndex').doc(freeHostId), { orgId: freeOrgId })
await put(firestore.collection('hosts').doc(freeHostId), {
  subdomain: freeHostId,
  displayName: 'Downgraded Bakery',
  orgId: freeOrgId,
  memberRoles: { 'e2e-owner': 'admin' },
  screens: {},
  createdAt: daysAgo(60),
})
await put(
  firestore
    .collection('users')
    .doc('e2e-owner')
    .collection('hostMemberships')
    .doc(freeHostId),
  {
    orgId: freeOrgId,
    subdomain: freeHostId,
    displayName: 'Downgraded Bakery',
    nameLower: 'downgraded bakery',
    role: 'admin',
    createdAt: daysAgo(60),
  },
)
// One product, because the draft dialog cannot be filled in without one — the
// refusal the shot is about sits BEHIND a valid draft, not in place of it.
await put(
  firestore.collection('hosts').doc(freeHostId).collection('products').doc('docs-free-loaf'),
  {
    name: 'Sourdough loaf',
    slug: 'sourdough-loaf',
    description: 'Naturally leavened, baked daily.',
    type: 'physical',
    status: 'active',
    variants: [{ id: 'default', priceUsd: 9, inventory: 24 }],
    priceUsd: 9,
    inventory: 24,
    createdAtMs: now.toMillis(),
  },
)

console.log('\nDocs fixtures seeded.')

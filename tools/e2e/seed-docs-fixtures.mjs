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
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'

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
  customerName: 'Robin Hale',
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

// ── The staff-only guard's subject (AGL-3319) ─────────────────────────────
// The capture preflight has to SEE the one nav tab that ships flagged off,
// Sequences (`release_outreach`), before it can prove the tab is hidden from
// every shot. The org strip draws that tab only for an org with the plugin on
// AND its `outreach` entitlement, which no plan carries, so without these two
// fields there is no marker to find and the preflight refuses to capture
// anything. Staff still see it ⚑-badged; the harness hides it, which is the
// strip a customer's console renders.
console.log('Plugins (Sequences for the staff-only guard, member accounts):')
await firestore.collection('orgs').doc(orgId).set(
  {
    // `accounts` too: the member-accounts guide signs a visitor up on the
    // published site, and the tenant answers /signup and /signin with a 404
    // for an org without the plugin that owns them.
    // `forms` for the same reason: the survey guide's Form element lives in
    // that bundle, and the base seed's list predates the move.
    enabledPlugins: FieldValue.arrayUnion('outreach', 'accounts', 'forms'),
    entitlements: { features: { outreach: true } },
  },
  { merge: true },
)
console.log(`  orgs/${orgId}`)

// ── Traffic (AGL-3319) ────────────────────────────────────────────────────
// The site dashboard's Traffic card and the Analytics page read one counter
// document per UTC day, `hosts/{host}/analytics/{YYYY-MM-DD}`, in the shape
// the tenant's collector writes (`apps/tenant/app/api/analytics/collect`):
// map keys with `.` `$` `#` `[` `]` replaced by `_`. Sixty days, so the
// 30-day range has a prior window to compare against. Deterministic, so two
// runs photograph the same curve: a weekly rhythm, a slow climb, and a
// spring-menu campaign in the last fortnight.
console.log('Traffic:')
const analyticsRef = firestore.collection('hosts').doc(hostId).collection('analytics')
const DAY_MS = 24 * 60 * 60 * 1000
for (let back = 0; back < 60; back += 1) {
  const at = now.toMillis() - back * DAY_MS
  const day = new Date(at).toISOString().slice(0, 10)
  const weekday = new Date(at).getUTCDay()
  const weekend = weekday === 0 || weekday === 6
  const trend = 1 + (60 - back) / 90
  const campaign = back < 14 ? 1.25 : 1
  const wobble = 1 + (((back * 37) % 11) - 5) / 40
  const total = Math.round(120 * trend * campaign * wobble * (weekend ? 1.35 : 1))
  const share = (fraction) => Math.max(1, Math.round(total * fraction))
  await analyticsRef.doc(day).set({
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
      'www_google_com': share(0.21),
      'instagram_com': share(0.12),
      'www_yelp_com': share(0.06),
      'l_facebook_com': share(0.04),
    },
    devices: { mobile: share(0.58), desktop: share(0.36), tablet: share(0.06) },
    ...(back < 14 && {
      utm: {
        source: { instagram: share(0.07), newsletter: share(0.05) },
        medium: { social: share(0.07), email: share(0.05) },
        campaign: { 'spring-menu': share(0.12) },
      },
    }),
  })
}
console.log(`  hosts/${hostId}/analytics (60 days)`)

// ── The storefront and member sign-up (AGL-3319) ──────────────────────────
// The guide fixtures picture their products with picsum.photos URLs, and the
// tenant's enforced `img-src` blocks any external host the site has not
// approved, so the storefront shots showed broken-image icons. Approving the
// host is what a merchant using an outside image CDN does (Admin → Security);
// picsum answers from `fastly.picsum.photos`.
await put(firestore.collection('hosts').doc(hostId), {
  approvedImageHosts: FieldValue.arrayUnion('picsum.photos', 'fastly.picsum.photos'),
  // …and the per-site opt-in member accounts need beside the org's switch:
  // `accounts` is off on a site until the site turns it on.
  enabledPlugins: FieldValue.arrayUnion('accounts'),
})

// ── The product-updates prompt (AGL-3319) ─────────────────────────────────
// The console asks every account that has not answered whether it wants
// product email, in a banner above the Sites page. A dismissal (not an
// answer: no consent is recorded either way) snoozes it for ninety days, so
// the capture account's pages show what an account that has seen it once
// shows, not an ask sitting on top of every org page.
await put(firestore.collection('users').doc('e2e-owner'), {
  marketingConsentPromptDismissedAtMs: now.toMillis(),
})

// ── Addresses a reader sees (AGL-3319) ────────────────────────────────────
// The CRM book (`tools/scripts/lib/crm-fixtures.mjs`) names invented people
// at invented businesses, but on `.com` domains somebody may really own, and
// one address is a Gmail inbox. A published image must not print an address
// a real person reads, so the docs frame moves every one of them onto the
// reserved `.example` TLD (RFC 2606), which can never be registered.
console.log('CRM addresses:')
const reserve = (value) =>
  typeof value === 'string'
    ? value
        .replace(/@gmail\.com\b/g, '@mail.example')
        .replace(/\b([a-z0-9-]+)\.com\b/g, (match, name) =>
          name === 'example' ? match : `${name}.example`,
        )
    : Array.isArray(value)
      ? value.map(reserve)
      : value && typeof value === 'object' && value.constructor === Object
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, reserve(v)]))
        : value
for (const name of ['contacts', 'leads', 'companies', 'crmActivities', 'crmTasks', 'deals']) {
  const snapshot = await firestore.collection('orgs').doc(orgId).collection(name).get()
  let moved = 0
  for (const doc of snapshot.docs) {
    const data = doc.data()
    const next = reserve(data)
    if (JSON.stringify(next) !== JSON.stringify(data)) {
      await doc.ref.set(next)
      moved += 1
    }
  }
  console.log(`  orgs/${orgId}/${name}: ${moved}`)
}

// The base seed's placeholder people: two bookings named for famous
// computer scientists, and three contacts named for the inbox they wrote
// from. Ordinary, invented names in their place.
console.log('People:')
const bookingsRef = firestore.collection('hosts').doc(hostId).collection('bookings')
await put(bookingsRef.doc('seed-booking-past'), {
  name: 'Ada Brennan',
  email: 'ada.brennan@example.com',
})
await put(bookingsRef.doc('seed-booking-next'), {
  name: 'Grace Whitaker',
  email: 'grace.whitaker@example.com',
})
const contactsRef = firestore.collection('orgs').doc(orgId).collection('contacts')
await put(contactsRef.doc('seed-contact-1'), { name: 'Robin Hale' })
await put(contactsRef.doc('seed-contact-2'), { name: 'Casey Morales' })
await put(contactsRef.doc('seed-contact-3'), { name: 'Alex Kim' })
await put(
  firestore.collection('hosts').doc(hostId).collection('siteMembers').doc('seed-site-member'),
  { displayName: 'Rae Donovan' },
)

// ── Names a reader sees (AGL-3319) ────────────────────────────────────────
// `seed-e2e.mjs` names its fixtures for the suite that asserts on them —
// `E2E Bakery Co`, `E2E Owner` — and every console header, team row and avatar
// in a published image printed that. The docs frame gets ordinary, fictional
// names instead. Renamed here rather than in the base seed, whose specs wait
// on the old strings; `seed:e2e` converges them back on its next run.
console.log('Display names:')
const ORG_NAMES = {
  'E2E Bakery Co': 'Demo Bakery Co',
  'E2E Studio': 'Northside Studio',
  'E2E Client Co': 'Lakeview Florist',
  'E2E Unverified Co': 'Copper Kettle Cafe',
}
const PERSON_NAMES = {
  'E2E Owner': 'Sam Rivera',
  'E2E Teammate': 'Priya Shah',
  'E2E Org Owner': 'Jordan Blake',
  'E2E Unverified Owner': 'Casey Morgan',
}
for (const doc of (await firestore.collection('orgs').get()).docs) {
  const renamed = ORG_NAMES[doc.get('name')]
  if (renamed) await put(doc.ref, { name: renamed })
}
for (const doc of (await firestore.collectionGroup('orgs').get()).docs) {
  // users/{uid}/orgs/{orgId}, the switcher's mirror of the org name.
  const renamed = ORG_NAMES[doc.get('orgName')]
  if (doc.ref.parent.parent && renamed) await put(doc.ref, { orgName: renamed })
}
for (const doc of (await firestore.collectionGroup('members').get()).docs) {
  const renamed = PERSON_NAMES[doc.get('displayName')]
  if (renamed) await put(doc.ref, { displayName: renamed })
}
for (const doc of (await firestore.collection('users').get()).docs) {
  const renamed = PERSON_NAMES[doc.get('displayName')]
  if (renamed) await put(doc.ref, { displayName: renamed })
}
const auth = getAuth()
for (const user of (await auth.listUsers(1000)).users) {
  const renamed = PERSON_NAMES[user.displayName]
  if (renamed) {
    await auth.updateUser(user.uid, { displayName: renamed })
    console.log(`  auth/${user.uid}`)
  }
}

console.log('\nDocs fixtures seeded.')

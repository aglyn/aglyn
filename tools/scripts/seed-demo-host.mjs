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

// Seeds the demo host with representative fixtures for every recent
// feature (AGL-144), so demos and onboarding start populated:
// variables, functions, workflows, an action, datasets (Team + Menu),
// a blog collection with entries, media docs (placeholder URLs), leads,
// an invited team member, and a bookable service.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/seed-demo-host.mjs [--host demo]
//
// Idempotent: every fixture has a deterministic `seed-…` doc id, so
// re-runs converge instead of duplicating. Nothing outside the target
// host is touched; team-member seeding writes to the owning tenant.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const args = process.argv.slice(2)
const hostArgIndex = args.indexOf('--host')
const hostTarget = hostArgIndex !== -1 ? args[hostArgIndex + 1] : 'demo'

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
  )
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const firestore = getFirestore()

// ── Resolve the host ────────────────────────────────────────────────────────
let hostRef = firestore.collection('hosts').doc(hostTarget)
if (!(await hostRef.get()).exists) {
  const bySubdomain = await firestore
    .collection('hosts')
    .where('subdomain', '==', hostTarget)
    .limit(1)
    .get()
  if (bySubdomain.empty) {
    console.error(`No host with id or subdomain "${hostTarget}"`)
    process.exit(1)
  }
  hostRef = bySubdomain.docs[0].ref
}
console.log(`Seeding host ${hostRef.id}…`)
const now = FieldValue.serverTimestamp()
let written = 0
const put = async (ref, data) => {
  await ref.set({ ...data, updatedAt: now }, { merge: true })
  written += 1
}

// ── Variables (AGL-91) ──────────────────────────────────────────────────────
await put(hostRef.collection('variables').doc('seed-site-name'), {
  name: 'siteName',
  type: 'text',
  value: 'Demo Bakery',
  createdAt: now,
})
await put(hostRef.collection('variables').doc('seed-tagline'), {
  name: 'tagline',
  type: 'text',
  value: 'Fresh every morning',
  createdAt: now,
})
await put(hostRef.collection('variables').doc('seed-base-price'), {
  name: 'basePrice',
  type: 'number',
  value: '4',
  createdAt: now,
})

// ── Functions (AGL-93) ──────────────────────────────────────────────────────
await put(hostRef.collection('functions').doc('seed-order-total'), {
  name: 'OrderTotal',
  parameters: [
    { name: 'Qty', type: 'number', required: true },
    { name: 'Price', type: 'number', required: false },
  ],
  variables: [{ name: 'Total', type: 'number' }],
  operations: [
    {
      if: { left: 'Qty', comparator: '>=', right: '12' },
      then: [{ set: 'Total', expression: 'Qty * Price * 0.9' }],
      otherwise: [{ set: 'Total', expression: 'Qty * Price' }],
    },
  ],
  returnValue: 'Total',
  createdAt: now,
})

// ── Workflows (AGL-101/128) ─────────────────────────────────────────────────
await put(hostRef.collection('workflows').doc('seed-quote'), {
  name: 'DozenQuote',
  steps: [
    {
      functionName: 'OrderTotal',
      args: ['12', 'basePrice'],
      resultName: 'dozenPrice',
    },
  ],
  returnValue: 'dozenPrice',
  trigger: { event: 'formSubmission' },
  createdAt: now,
})

// ── Action (AGL-148) ────────────────────────────────────────────────────────
await put(hostRef.collection('actions').doc('seed-welcome'), {
  name: 'Form thank-you',
  trigger: { event: 'formSubmission' },
  steps: [
    {
      type: 'siteAlert',
      severity: 'success',
      message: 'Thanks — we read every message the same day!',
    },
  ],
  enabled: true,
  createdAt: now,
})

// ── Datasets (AGL-102): Team + Menu (nav use-case) ─────────────────────────
const teamDataset = hostRef.collection('datasets').doc('seed-team')
await put(teamDataset, {
  name: 'Team',
  fields: ['name', 'role', 'photo'],
  createdAt: now,
})
const teamRows = [
  ['Avery Quinn', 'Head Baker', 'https://picsum.photos/seed/avery/240'],
  ['Sam Rivera', 'Pastry Chef', 'https://picsum.photos/seed/sam/240'],
  ['Jordan Lee', 'Front of House', 'https://picsum.photos/seed/jordan/240'],
]
for (const [index, [name, role, photo]] of teamRows.entries()) {
  await put(teamDataset.collection('records').doc(`seed-${index}`), {
    values: { name, role, photo },
    order: index,
    createdAt: now,
  })
}
const menuDataset = hostRef.collection('datasets').doc('seed-menu')
await put(menuDataset, {
  name: 'Menu',
  fields: ['label', 'href'],
  createdAt: now,
})
const menuRows = [
  ['Home', '/'],
  ['Our story', '/about'],
  ['Order', '/order'],
]
for (const [index, [label, href]] of menuRows.entries()) {
  await put(menuDataset.collection('records').doc(`seed-${index}`), {
    values: { label, href },
    order: index,
    createdAt: now,
  })
}

// ── Blog collection + entries (AGL-81) ─────────────────────────────────────
const blog = hostRef.collection('collections').doc('seed-blog')
await put(blog, {
  displayName: 'Blog',
  slug: 'blog',
  createdAt: now,
})
await put(blog.collection('entries').doc('seed-sourdough'), {
  title: 'Why our sourdough takes three days',
  slug: 'three-day-sourdough',
  excerpt: 'Slow fermentation is the whole secret.',
  coverImage: 'https://picsum.photos/seed/sourdough/960/540',
  status: 'published',
  body:
    '## The starter\n\nOur starter is **nine years old** and lives in the ' +
    'walk-in.\n\n- Day 1: feed and rest\n- Day 2: shape and cold proof\n' +
    '- Day 3: bake\n\n*Patience tastes better.*',
  publishedAt: now,
  createdAt: now,
})
await put(blog.collection('entries').doc('seed-croissant'), {
  title: 'Croissant lamination, step by step',
  slug: 'croissant-lamination',
  excerpt: 'Twenty-seven layers, zero shortcuts.',
  coverImage: 'https://picsum.photos/seed/croissant/960/540',
  status: 'published',
  body:
    '## Butter matters\n\nWe use [cultured butter](https://example.com) at ' +
    '82% fat.\n\n## The folds\n\nThree letter folds with a full rest ' +
    'between each.',
  publishedAt: now,
  createdAt: now,
})

// ── Media docs with folders/tags (AGL-124/134) ─────────────────────────────
const mediaFixtures = [
  ['seed-hero', 'hero.jpg', 'Marketing', ['hero', 'home'], 'hero/1200/600'],
  ['seed-team-photo', 'team.jpg', 'About', ['team'], 'teamphoto/800/500'],
  ['seed-loaf', 'loaf.jpg', 'Products', ['bread'], 'loaf/600/600'],
]
for (const [id, fileName, folder, tags, seed] of mediaFixtures) {
  await put(hostRef.collection('media').doc(id), {
    fileName,
    contentType: 'image/jpeg',
    sizeBytes: 120000,
    url: `https://picsum.photos/seed/${seed}`,
    folder,
    tags,
    alt: fileName.replace('.jpg', ''),
    createdAt: now,
  })
}

// ── Leads + a site member record (AGL-76/109) ──────────────────────────────
await put(hostRef.collection('leads').doc('seed-lead-1'), {
  email: 'wholesale@example.com',
  source: 'signup',
  createdAt: now,
})
await put(hostRef.collection('leads').doc('seed-lead-2'), {
  email: 'events@example.com',
  source: 'booking',
  createdAt: now,
})
await put(hostRef.collection('siteMembers').doc('seed-member'), {
  email: 'regular@example.com',
  displayName: 'Demo Regular',
  createdAt: now,
})

// ── Bookable service (AGL-159) ─────────────────────────────────────────────
await put(hostRef.collection('services').doc('seed-tasting'), {
  name: 'Cake tasting',
  durationMinutes: 30,
  priceUsd: 0,
  description: 'Pick your wedding or event cake over coffee.',
  timezone: 'America/Chicago',
  windows: {
    2: [{ start: 10 * 60, end: 16 * 60 }],
    4: [{ start: 10 * 60, end: 16 * 60 }],
  },
  createdAt: now,
})

// ── Invited team member with a role (AGL-108/120) ──────────────────────────
const hostSnapshot = await hostRef.get()
const tenantId = hostSnapshot.get('tenantId')
if (tenantId) {
  await put(
    firestore
      .collection('tenants')
      .doc(tenantId)
      .collection('members')
      .doc('seed-teammate'),
    {
      email: 'teammate@example.com',
      status: 'invited',
      role: 'editor',
      permissions: {},
      createdAt: now,
    },
  )
} else {
  console.warn('Host has no tenantId — skipped team-member fixture')
}

// ════════════════════════════════════════════════════════════════════════════
// Full-feature demo fixtures (AGL-377): every recent surface starts
// populated so demos and screenshots don't require manual setup. Org-
// scoped collections (datasets, contacts, lists, segments) resolve the
// owning org from the host doc, falling back to the host path (AGL-240).
// ════════════════════════════════════════════════════════════════════════════
const hostSnap2 = await hostRef.get()
const orgId = hostSnap2.get('orgId')
const orgRef = orgId ? firestore.collection('orgs').doc(orgId) : null
const dataRef = orgRef ?? hostRef

// ── Commerce catalog (AGL-276/279): physical w/ variants, digital,
//    subscription — flat legacy fields included so lifts are unnecessary.
const nowMs = Date.now()
const cat = hostRef.collection('productCategories').doc('seed-cat-parts')
await put(cat, { name: 'Brake parts', slug: 'brake-parts', createdAt: now })
const coll = hostRef.collection('collections').doc('seed-coll-featured')
await put(coll, {
  name: 'Featured',
  slug: 'featured',
  mode: 'manual',
  productIds: ['seed-prod-rotor', 'seed-prod-guide'],
  createdAt: now,
})
await put(hostRef.collection('products').doc('seed-prod-rotor'), {
  name: 'Vented brake rotor',
  slug: 'vented-brake-rotor',
  status: 'active',
  description: 'Cross-drilled, vented rotor for improved cooling.',
  categoryIds: ['seed-cat-parts'],
  tags: ['brakes', 'performance'],
  mediaUrls: ['https://picsum.photos/seed/rotor/800/800'],
  imageUrl: 'https://picsum.photos/seed/rotor/800/800',
  priceUsd: 129,
  inventory: 24,
  options: [{ name: 'Size', values: ['320mm', '340mm'] }],
  variants: [
    {
      id: 'v-320',
      options: { Size: '320mm' },
      priceUsd: 129,
      inventoryByLocation: { 'seed-loc-main': 24 },
    },
    {
      id: 'v-340',
      options: { Size: '340mm' },
      priceUsd: 149,
      inventoryByLocation: { 'seed-loc-main': 12 },
    },
  ],
  lowStockThreshold: 5,
  createdAtMs: nowMs,
  createdAt: now,
})
await put(hostRef.collection('products').doc('seed-prod-guide'), {
  name: 'Trail Riding Program (digital)',
  slug: 'trail-riding-program',
  status: 'active',
  description: 'Downloadable training plan with monthly updates.',
  tags: ['digital', 'training'],
  priceUsd: 39,
  imageUrl: 'https://picsum.photos/seed/guide/800/800',
  mediaUrls: ['https://picsum.photos/seed/guide/800/800'],
  variants: [{ id: 'v-default', options: {}, priceUsd: 39 }],
  digitalFiles: [
    { url: 'https://example.com/program.pdf', fileName: 'program.pdf', version: '1' },
  ],
  subscription: { interval: 'month', trialDays: 7 },
  gatedVideos: [{ title: 'Week 1', url: 'https://example.com/w1.m3u8' }],
  createdAtMs: nowMs,
  createdAt: now,
})
await put(hostRef.collection('locations').doc('seed-loc-main'), {
  name: 'Main warehouse',
  createdAt: now,
})

// ── Orders (AGL-281): one paid order with snapshots + totals in cents.
await put(hostRef.collection('orders').doc('seed-order-1001'), {
  orderNumber: 1001,
  email: 'rider@example.com',
  status: 'paid',
  items: [
    {
      productId: 'seed-prod-rotor',
      variantId: 'v-340',
      name: 'Vented brake rotor — 340mm',
      quantity: 1,
      unitPriceCents: 14900,
    },
  ],
  totals: {
    itemsCents: 14900,
    shippingCents: 900,
    taxCents: 1230,
    discountCents: 0,
    totalCents: 17030,
    feeCents: 340,
  },
  createdAtMs: nowMs,
  createdAt: now,
})

// ── Discounts, coupons, gift cards, reviews (AGL-305/322/324/325).
await put(hostRef.collection('discounts').doc('seed-disc-summer'), {
  name: 'Summer 10%',
  type: 'automatic',
  percentOff: 10,
  active: true,
  createdAt: now,
})
await put(hostRef.collection('coupons').doc('seed-coupon-welcome'), {
  code: 'WELCOME15',
  percentOff: 15,
  active: true,
  redemptions: 3,
  createdAt: now,
})
await put(hostRef.collection('giftCards').doc('seed-gift-1'), {
  code: 'GIFT-DEMO-0001',
  balanceCents: 5000,
  initialCents: 5000,
  active: true,
  createdAt: now,
})
await put(hostRef.collection('reviews').doc('seed-review-1'), {
  productId: 'seed-prod-rotor',
  rating: 5,
  title: 'Great stopping power',
  body: 'Noticeable improvement on track days.',
  authorName: 'Sam R.',
  status: 'approved',
  verified: true,
  createdAt: now,
})

// ── Reservations (AGL-310): a bookable cabin + a reservation.
await put(hostRef.collection('bookableUnits').doc('seed-cabin-a'), {
  name: 'Pinecrest Cabin',
  nightlyRateCents: 18000,
  depositCents: 5000,
  createdAt: now,
})
await put(hostRef.collection('reservations').doc('seed-resv-1'), {
  unitId: 'seed-cabin-a',
  email: 'guest@example.com',
  startDay: '2026-08-01',
  endDay: '2026-08-04',
  nights: 3,
  status: 'confirmed',
  totalCents: 54000,
  createdAtMs: nowMs,
  createdAt: now,
})

// ── Marketing: campaign, designed email screen, overlay + bar, experiment.
await put(hostRef.collection('campaigns').doc('seed-campaign-1'), {
  subject: 'New arrivals this week',
  body: 'Check out the latest parts in stock.',
  audience: 'leads',
  status: 'sent',
  stats: { recipients: 2, sent: 2, opens: 1, clicks: 0 },
  sentAt: now,
})
// Designed email template as an email-kind screen (AGL-347).
const emailScreen = hostRef.collection('screens').doc('seed-email-welcome')
await put(emailScreen, {
  displayName: 'Welcome email',
  kind: 'email',
  versionId: 'seed-email-v1',
  emailSubject: 'Welcome to the shop, {{contact.firstName}}',
  emailPreheader: 'Your 15% code is inside',
  createdAt: now,
})
await put(emailScreen.collection('versions').doc('seed-email-v1'), {
  screenId: 'seed-email-welcome',
  nodes: {
    root: { $id: 'root', componentId: 'div', nodes: ['sec'] },
    sec: {
      $id: 'sec',
      componentId: 'emailSection',
      pluginId: 'email',
      parentId: 'root',
      nodes: ['txt', 'btn'],
    },
    txt: {
      $id: 'txt',
      componentId: 'emailText',
      pluginId: 'email',
      parentId: 'sec',
      props: { children: 'Hi {{contact.firstName}}, welcome!', variant: 'heading' },
    },
    btn: {
      $id: 'btn',
      componentId: 'emailButton',
      pluginId: 'email',
      parentId: 'sec',
      props: { children: 'Shop now', href: '{{site.url}}' },
    },
  },
  createdAt: now,
})
await put(hostRef.collection('overlays').doc('seed-overlay-sale'), {
  name: 'Summer sale bar',
  kind: 'bar',
  bar: { text: 'Free shipping over $75', link: '/collections/featured' },
  enabled: true,
  createdAt: now,
})
await put(hostRef.collection('overlays').doc('seed-overlay-popup'), {
  name: 'Newsletter popup',
  kind: 'popup',
  popup: { title: 'Get 15% off', body: 'Join our newsletter.' },
  enabled: true,
  frequency: 'oncePerVisitor',
  createdAt: now,
})
await put(hostRef.collection('experiments').doc('seed-exp-cta'), {
  name: 'CTA copy test',
  target: 'section',
  status: 'running',
  variants: [
    { id: 'a', name: 'Shop now' },
    { id: 'b', name: 'Browse parts' },
  ],
  createdAt: now,
})

// ── Redirects v2 (AGL-375): exact, prefix, regex.
await put(hostRef.collection('redirects').doc('seed-redir-exact'), {
  source: '/old-home',
  destination: '/',
  statusCode: 301,
  kind: 'exact',
  priority: 10,
  enabled: true,
  createdAt: now,
})
await put(hostRef.collection('redirects').doc('seed-redir-prefix'), {
  source: '/shop',
  destination: '/products',
  statusCode: 302,
  kind: 'prefix',
  priority: 50,
  enabled: true,
  createdAt: now,
})
await put(hostRef.collection('redirects').doc('seed-redir-regex'), {
  source: '/p/(\\d+)',
  destination: '/products/item-$1',
  statusCode: 301,
  kind: 'regex',
  priority: 100,
  enabled: true,
  createdAt: now,
})

// ── Org-scoped data (AGL-240): contacts, segment, list, extra dataset.
await put(dataRef.collection('contacts').doc('seed-contact-1'), {
  email: 'rider@example.com',
  name: 'Riley Rider',
  tags: ['customer', 'vip'],
  sources: { order: true, newsletter: true },
  purchaseCents: 17030,
  createdAt: now,
})
await put(dataRef.collection('contactSegments').doc('seed-seg-vip'), {
  name: 'VIP customers',
  tags: ['vip'],
  sources: [],
  createdAt: now,
})
await put(dataRef.collection('lists').doc('seed-list-news'), {
  name: 'Newsletter subscribers',
  createdAt: now,
})
await put(dataRef.collection('datasets').doc('seed-inventory-log'), {
  name: 'Inventory log',
  model: {
    fields: [
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'delta', label: 'Delta', type: 'number' },
    ],
  },
  createdAt: now,
})

// ── Community listing (AGL-45): a published reusable component.
await put(firestore.collection('communityListings').doc('seed-listing-hero'), {
  displayName: 'Hero banner',
  description: 'A reusable hero section with a headline and CTA.',
  category: 'Sections',
  latestVersion: 1,
  installCount: 4,
  priceUsd: 0,
  deletedAt: null,
  createdAt: now,
})

console.log(`Done — ${written} fixture documents written to ${hostRef.id}.`)

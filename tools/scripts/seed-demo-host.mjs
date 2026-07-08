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

console.log(`Done — ${written} fixture documents written to ${hostRef.id}.`)

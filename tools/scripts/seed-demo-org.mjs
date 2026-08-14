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

// Stands up the multi-site demo org (AGL-1734): one organization holding
// several visibly different client sites, which is what the founding demo
// spends minutes 3–10 on ("switch between several sites in one org;
// roles/permissions; one billing view", Design-Partner-Outreach.md §4).
//
// Emulator (creates the org, the owner, and every host):
//
//   FIRESTORE_EMULATOR_HOST=localhost:8082 \
//   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 \
//     node tools/scripts/seed-demo-org.mjs
//
// Existing org in a real project (never creates the org or the owner; it
// still CREATES HOSTS unless they exist, which bypasses the site quota —
// see --create-hosts below):
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/seed-demo-org.mjs --org <orgId|orgSlug> --create-hosts
//
//   --org <id|slug>       target org (default: the emulator demo org)
//   --brands a,b,c        packs to seed, one host each (default: the four
//                         agency-ICP clients — dental, legal, restaurant,
//                         fitness)
//   --create-hosts        create any missing host. Required outside the
//                         emulator: a direct host write skips the plan's
//                         site quota, so it is never implicit against a
//                         real project.
//   --reset               prune every seeded host's fixtures and exit
//   --dry-run             print the plan and change nothing
//
// Re-runnable: hosts converge on deterministic ids and every seeding pass
// deletes the previous `seed-…` documents first, so a second live demo run
// looks exactly like the first.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { AGENCY_DEMO_BRANDS, resolveBrand } from './lib/demo-brands.mjs'
import {
  ensureHost,
  nameLower,
  pruneSeedFixtures,
  seedBrand,
  seedMarketplaceListing,
} from './lib/seed-demo.mjs'

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index !== -1 ? args[index + 1] : fallback
}
const dryRun = args.includes('--dry-run')
const createHosts = args.includes('--create-hosts')

// ── Emulator demo org defaults ──────────────────────────────────────────────
const DEMO_OWNER_UID = 'demo-owner'
const DEMO_OWNER_EMAIL = 'demo@aglyn.test'
const DEMO_ORG_ID = DEMO_OWNER_UID // Org doc id = owner uid, matching signups.
const DEMO_ORG_SLUG = 'demo-agency'
const DEMO_ORG_NAME = 'Beacon Studio'
/**
 * An org-wide teammate, alongside the per-site invites each brand pack
 * carries. Two shapes of access in one roster is what makes the demo's
 * "roles/permissions" minute worth spending: one editor who reaches every
 * client, and four collaborators who each reach exactly one.
 */
const DEMO_TEAMMATE_UID = 'demo-teammate'
const DEMO_TEAMMATE_EMAIL = 'teammate@aglyn.test'

const brandIds = argValue('--brands', AGENCY_DEMO_BRANDS.join(','))
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean)
const brands = brandIds.map(resolveBrand)

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (!emulated && (!projectId || !clientEmail || !privateKey)) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars.\n' +
      'To seed the local emulator instead, set FIRESTORE_EMULATOR_HOST=localhost:8082.',
  )
  process.exit(1)
}
if (!emulated && !createHosts) {
  console.error(
    'Refusing to run against a real project without --create-hosts.\n\n' +
      '  Creating a host by direct write skips /api/hosts/create, and with it\n' +
      "  the plan's site quota and the subdomain reservation the console does.\n" +
      '  Either pass --create-hosts deliberately, or create the sites in the\n' +
      '  console first and seed each one with:\n\n' +
      '      node tools/scripts/seed-demo-host.mjs --host <sub> --brand <id>\n',
  )
  process.exit(1)
}
if (!getApps().length) {
  initializeApp(
    emulated
      ? { projectId: projectId ?? 'aglyn-main' }
      : { credential: cert({ projectId, clientEmail, privateKey }) },
  )
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)
const log = (message) => console.log(`  ${message}`)

// ── Resolve (or, in the emulator, create) the org ───────────────────────────
const orgTarget = argValue('--org', emulated ? DEMO_ORG_ID : undefined)
if (!orgTarget) {
  console.error('--org <orgId|orgSlug> is required outside the emulator')
  process.exit(1)
}

let orgId = orgTarget
if (!(await firestore.collection('orgs').doc(orgId).get()).exists) {
  const bySlug = await firestore.collection('orgSlugs').doc(orgTarget).get()
  if (bySlug.exists) orgId = bySlug.get('orgId')
}
let orgSnapshot = await firestore.collection('orgs').doc(orgId).get()

if (!orgSnapshot.exists) {
  if (!emulated) {
    console.error(
      `No org with id or slug "${orgTarget}".\n\n` +
        '  This script will not create an organization in a real project —\n' +
        '  a real org carries billing identity and a Stripe customer, and\n' +
        '  minting one from a seeder is not a fixture, it is a decision.\n' +
        '  Create it in the console and re-run with its id or slug.',
    )
    process.exit(1)
  }
  if (dryRun) {
    console.log(`[dry run] would create org ${DEMO_ORG_ID} (${DEMO_ORG_SLUG})`)
  } else {
    await createEmulatorOrg()
    orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
  }
}

const orgName = orgSnapshot.get?.('name') ?? DEMO_ORG_NAME

// ── Plan ────────────────────────────────────────────────────────────────────
const plan = brands.map((brand) => ({
  brand,
  hostId: `demo-${brand.id}`,
  subdomain: brand.subdomain,
  displayName: brand.displayName,
}))

console.log(
  `${dryRun ? '[dry run] ' : ''}Demo org "${orgName}" (${orgId}) — ` +
    `${plan.length} site(s):`,
)
for (const site of plan) {
  console.log(
    `  · ${site.displayName.padEnd(22)} ${site.subdomain.padEnd(18)} ` +
      `brand=${site.brand.id}`,
  )
}
if (dryRun) process.exit(0)

// ── Reset ───────────────────────────────────────────────────────────────────
if (args.includes('--reset')) {
  const orgRef = firestore.collection('orgs').doc(orgId)
  for (const site of plan) {
    const hostRef = firestore.collection('hosts').doc(site.hostId)
    if (!(await hostRef.get()).exists) continue
    await pruneSeedFixtures({ firestore, hostRef, orgRef, log })
  }
  console.log('Reset — no seed fixtures remain on the demo sites.')
  process.exit(0)
}

// ── Seed ────────────────────────────────────────────────────────────────────
let total = 0
for (const site of plan) {
  console.log(`\n${site.displayName} (${site.subdomain})`)
  const hostRef = firestore.collection('hosts').doc(site.hostId)
  const exists = (await hostRef.get()).exists
  if (!exists && !createHosts && !emulated) {
    console.error(
      `  Host ${site.hostId} does not exist and --create-hosts was not passed`,
    )
    process.exit(1)
  }
  // Always, not only when creating. `ensureHost` is a merge, and the
  // projections it maintains — `memberRoles`, the switcher rows, the org's
  // `hosts` map — drift as the roster changes. Running it only on create
  // meant a role correction never reached a site that already existed, which
  // is precisely the site a demo is going to open.
  await ensureHost({
    firestore,
    hostId: site.hostId,
    subdomain: site.subdomain,
    displayName: site.displayName,
    orgId,
    log,
  })
  total += await seedBrand({ firestore, hostRef, brand: site.brand, log })
}
await seedMarketplaceListing({ firestore })

console.log(
  `\nDone — ${plan.length} sites, ${total} fixture documents, one org.\n` +
    `Console: /${orgSnapshot.get?.('slug') ?? DEMO_ORG_SLUG}/hosts`,
)

// ── Emulator-only org bootstrap ─────────────────────────────────────────────

/**
 * Creates the demo org, its owner, and an org-wide teammate.
 *
 * Emulator only, by construction — it mints Auth users and an org with a
 * plan, neither of which a seeder has any business doing in a real project.
 * Mirrors `createOrganization`: the slug reservation, the org doc, the
 * member roster, and the `users/{uid}/orgs` reverse index all have to exist
 * or the console cannot route to the workspace at all.
 */
async function createEmulatorOrg() {
  const { getAuth } = await import('firebase-admin/auth')
  const auth = getAuth()
  const password = process.env.DEMO_PASSWORD ?? 'Demo-Password-1'
  for (const [uid, email, displayName] of [
    [DEMO_OWNER_UID, DEMO_OWNER_EMAIL, 'Demo Owner'],
    [DEMO_TEAMMATE_UID, DEMO_TEAMMATE_EMAIL, 'Demo Teammate'],
  ]) {
    try {
      await auth.getUser(uid)
      await auth.updateUser(uid, { password, emailVerified: true })
    } catch {
      await auth.createUser({
        uid,
        email,
        password,
        emailVerified: true,
        displayName,
      })
    }
  }

  const now = FieldValue.serverTimestamp()
  const orgRef = firestore.collection('orgs').doc(DEMO_ORG_ID)
  await orgRef.set(
    {
      name: DEMO_ORG_NAME,
      slug: DEMO_ORG_SLUG,
      ownerUid: DEMO_OWNER_UID,
      hosts: {},
      // Business: hostLimit 10, which is both what the pitch quotes
      // ("10 sites in one org for $99/mo flat") and enough headroom that
      // the demo's fourth site does not trip a quota banner on screen.
      plan: 'business',
      subscription: { status: 'active' },
      enabledPlugins: [
        'mui',
        'bookings',
        'commerce',
        'marketplace',
        'contacts',
        'data',
        'email',
        'events-calendar',
        'inbox',
        'logic',
        'marketing',
        'redirects',
        'workflows',
      ],
      createdAt: now,
      updatedAt: now,
    },
    { merge: true },
  )
  await firestore
    .collection('orgSlugs')
    .doc(DEMO_ORG_SLUG)
    .set({ orgId: DEMO_ORG_ID, createdAt: now }, { merge: true })
  for (const [uid, email, displayName, role] of [
    [DEMO_OWNER_UID, DEMO_OWNER_EMAIL, 'Demo Owner', 'owner'],
    [DEMO_TEAMMATE_UID, DEMO_TEAMMATE_EMAIL, 'Demo Teammate', 'editor'],
  ]) {
    await orgRef.collection('members').doc(uid).set(
      {
        email,
        displayName,
        nameLower: nameLower(displayName),
        role,
        // Org-wide reach, in contrast with the per-site invites the brand
        // packs add — the roles table then shows both shapes at once.
        allHosts: true,
        status: 'active',
        joinedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      { merge: true },
    )
    await firestore
      .collection('users')
      .doc(uid)
      .collection('orgs')
      .doc(DEMO_ORG_ID)
      .set(
        {
          orgName: DEMO_ORG_NAME,
          slug: DEMO_ORG_SLUG,
          role,
          orgWide: true,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      )
  }
  console.log(
    `Created org ${DEMO_ORG_ID} (${DEMO_ORG_SLUG}) — sign in as ` +
      `${DEMO_OWNER_EMAIL} / ${password}`,
  )
}

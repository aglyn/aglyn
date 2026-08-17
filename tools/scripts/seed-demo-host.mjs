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

// Seeds ONE host with a brand pack's fixtures, covering every recent
// feature (AGL-144/377) so demos and onboarding start populated: theme,
// home screen, variables, functions, workflows, an action, datasets, a
// content collection with entries, media, leads, commerce, reservations,
// marketing, redirects, org data, and a scoped team invite.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/seed-demo-host.mjs [--host demo] [--brand bakery]
//
// `--brand` picks the fixture pack (AGL-1734). Without it the host is
// seeded as the bakery, which is what this script always did. To seed a
// whole multi-site demo org in one command, use `seed-demo-org.mjs`.
//
//   --list-brands   print the available packs and exit
//   --reset         delete this host's `seed-…` fixtures and exit
//   --no-prune      merge over the existing fixtures instead of replacing
//
// Idempotent: every fixture has a deterministic `seed-…` doc id, and each
// run deletes the previous `seed-…` documents before writing — so re-runs
// converge even when the BRAND changed, which a merge alone cannot do.
// Nothing outside the target host and its org is touched.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  BRAND_IDS,
  BRANDS,
  DEFAULT_BRAND,
  resolveBrand,
} from './lib/demo-brands.mjs'
import {
  pruneSeedFixtures,
  seedBrand,
  seedMarketplaceListing,
} from './lib/seed-demo.mjs'

const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const index = args.indexOf(flag)
  return index !== -1 ? args[index + 1] : fallback
}

if (args.includes('--list-brands')) {
  for (const id of BRAND_IDS) {
    const brand = BRANDS[id]
    const modules = [
      brand.commerce ? 'commerce' : null,
      brand.services?.length ? 'services' : null,
      brand.reservations ? 'reservations' : null,
      brand.siteMembers?.length ? 'members' : null,
    ].filter(Boolean)
    console.log(
      `${id.padEnd(12)} ${brand.displayName.padEnd(22)} ` +
        `${brand.subdomain.padEnd(18)} ${modules.join(', ') || '—'}`,
    )
  }
  process.exit(0)
}

const hostTarget = argValue('--host', 'demo')
const brandId = argValue('--brand', DEFAULT_BRAND)
const brand = resolveBrand(brandId)

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
const emulated = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
if (!emulated && (!projectId || !clientEmail || !privateKey)) {
  console.error(
    'Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars',
  )
  process.exit(1)
}
if (!getApps().length) {
  // Against the emulator the Admin SDK needs no credential, and demanding a
  // service-account key to seed a local emulator is what pushes people to
  // run this against production instead.
  initializeApp(
    emulated
      ? { projectId: projectId ?? 'aglyn-main' }
      : { credential: cert({ projectId, clientEmail, privateKey }) },
  )
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

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

const log = (message) => console.log(message)

if (args.includes('--reset')) {
  const orgId = (await hostRef.get()).get('orgId')
  await pruneSeedFixtures({
    firestore,
    hostRef,
    orgRef: orgId ? firestore.collection('orgs').doc(orgId) : null,
    log,
  })
  console.log(`Reset ${hostRef.id} — no seed fixtures remain.`)
  process.exit(0)
}

console.log(`Seeding host ${hostRef.id} as "${brand.id}" (${brand.displayName})…`)
const written = await seedBrand({
  firestore,
  hostRef,
  brand,
  log,
  prune: !args.includes('--no-prune'),
})
await seedMarketplaceListing({ firestore })

console.log(`Done — ${written} fixture documents written to ${hostRef.id}.`)

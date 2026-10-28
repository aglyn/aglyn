#!/usr/bin/env node
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

// Lists the platform's own site starters in the marketplace (AGL-4049): the
// starter site, and a base and an AI starter for each kind of site the AI
// start offers, every one a free listing of the platform's org. What each
// listing holds, and which fields a run may change, is
// `tools/scripts/lib/first-party-starters.mjs`.
//
//   node --env-file=.env tools/scripts/seed-first-party-starters.mjs --org <orgId> [--write] [--verify]
//
//   --org <id>   the publishing org. In the emulator (FIRESTORE_EMULATOR_HOST
//                set) any org; anywhere else only the platform's own, named by
//                AGLYN_PLATFORM_ORG_ID in the env, and never written to without
//                the service account's credentials.
//   --dry        print every listing and what a write would do (the default)
//   --write      write the listings and their versions
//   --verify     read every planned listing back: its stored version must
//                start a site, its seed-owned fields must match the plan, and
//                staff edits are reported, never changed
//
// Before a write, the org must exist and have a publisher profile with a
// handle and the current Publisher Agreement accepted, as any publisher must:
// the seed writes with the Admin SDK and so passes no publish door, and these
// checks are what keep it to the same terms.
//
// Re-runnable: listing ids are fixed, every write is a merge-set, and a run
// with nothing to change writes nothing. A changed default site or kind is a
// new version of the listings it reaches. No Firebase Auth user, nothing
// billing-shaped and no email.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import { parseDeployArgs } from './lib/deploy-args.mjs'
import {
  FIRST_PARTY_STARTER_MODULE_PATHS,
  FIRST_PARTY_STARTER_SEED_SOURCE,
  buildFirstPartyStarterPlan,
  hasStarterLinksModule,
  loadFirstPartyStarterSources,
  reconcileFirstPartyStarter,
} from './lib/first-party-starters.mjs'
import { listingQueryFieldsPatch } from './lib/listing-query-fields.mjs'

const args = parseDeployArgs({
  command: 'seed-first-party-starters',
  summary:
    "List the platform's own site starters in the marketplace. A dry run unless --write; " +
    'outside the emulator, only the org AGLYN_PLATFORM_ORG_ID names.',
  effect: { gerund: 'writing', past: 'WRITTEN', failure: 'could not run' },
  flags: [
    { flag: '--org', key: 'org', value: 'string', describe: 'The publishing org id.' },
    { flag: '--dry', key: 'dry', describe: 'Print the plan and write nothing (the default).' },
    { flag: '--write', key: 'write', describe: 'Write the listings and their versions.' },
    { flag: '--verify', key: 'verify', describe: 'Read every planned listing back and report any difference.' },
  ],
})

const fail = (message) => {
  console.error(`seed-first-party-starters: ${message}\nNothing was written.`)
  process.exit(1)
}

const orgId = typeof args.org === 'string' ? args.org.trim() : ''
if (!orgId) fail('--org <orgId> is required.')
if (args.write && args.dry) fail('--dry and --write ask for opposite things; pass one.')

// ── The target ─────────────────────────────────────────────────────────────
const emulator = process.env.FIRESTORE_EMULATOR_HOST
const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!emulator) {
  if (!projectId || !clientEmail || !privateKey) {
    fail(
      'FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY are not set (run with --env-file=.env), ' +
        'or set FIRESTORE_EMULATOR_HOST to seed the emulator.',
    )
  }
  const platformOrgId = process.env.AGLYN_PLATFORM_ORG_ID?.trim()
  if (!platformOrgId) {
    fail('AGLYN_PLATFORM_ORG_ID is not set. Outside the emulator this seed lists starters only for the platform’s own org, and that variable names it.')
  }
  if (orgId !== platformOrgId) {
    fail(`--org ${orgId} is not the platform's org (AGLYN_PLATFORM_ORG_ID). Outside the emulator no other org is accepted.`)
  }
}
if (!getApps().length) {
  initializeApp(
    emulator ? { projectId: projectId ?? 'demo-aglyn' } : { credential: cert({ projectId, clientEmail, privateKey }) },
  )
}
const firestore = getFirestore()
const target = emulator ? `the emulator at ${emulator}` : `project ${projectId}`

// ── The plan ───────────────────────────────────────────────────────────────
if (!hasStarterLinksModule()) {
  fail(
    `${FIRST_PARTY_STARTER_MODULE_PATHS.links} is not in this checkout. It rewrites the layout's links to Home ` +
      'for a starter and lands with the starter publish door; merge origin/main and run again.',
  )
}
const sources = await loadFirstPartyStarterSources()
let plan
try {
  plan = buildFirstPartyStarterPlan({ orgId, ...sources })
} catch (error) {
  fail(`the plan was refused: ${error.message}`)
}
const known = {
  kinds: new Set(sources.kinds.map((kind) => kind.id)),
  bases: new Set(sources.bases),
  fonts: new Set(sources.pairings.map((pairing) => pairing.id)),
}

// ── The publisher, as any publisher must be ────────────────────────────────
const [orgSnapshot, profileSnapshot] = await firestore.getAll(
  firestore.collection('orgs').doc(orgId),
  firestore.collection('publisherProfiles').doc(orgId),
)
const blockers = []
if (!orgSnapshot.exists) blockers.push(`org ${orgId} does not exist.`)
if (!profileSnapshot.exists || !String(profileSnapshot.get('handle') ?? '').trim()) {
  blockers.push('Set up the publisher profile and accept the Publisher Agreement first — Marketplace → Profile.')
} else if (!sources.agreement.isCurrent(profileSnapshot.get('publisherAgreement'))) {
  blockers.push(
    `Accept the current Publisher Agreement (${sources.agreement.version}) first — Marketplace → Profile.`,
  )
}

// ── What is stored ─────────────────────────────────────────────────────────
const listingRefs = plan.map((entry) => firestore.collection('marketplaceListings').doc(entry.listingId))
const listingSnapshots = await firestore.getAll(...listingRefs)
const versionRefs = listingSnapshots.map((snapshot) => {
  const latest = snapshot.exists ? Number(snapshot.get('latestVersion') ?? 0) : 0
  return latest > 0 ? snapshot.ref.collection('versions').doc(String(latest)) : null
})
const presentVersionRefs = versionRefs.filter(Boolean)
const versionSnapshots = presentVersionRefs.length ? await firestore.getAll(...presentVersionRefs) : []
const versionByPath = new Map(versionSnapshots.map((snapshot) => [snapshot.ref.path, snapshot]))
const storedFor = (index) => {
  const listing = listingSnapshots[index]
  const versionRef = versionRefs[index]
  const version = versionRef ? versionByPath.get(versionRef.path) : null
  return {
    listing: listing.exists ? listing.data() : null,
    version: version?.exists ? version.data() : null,
  }
}

const runMs = Date.now()
const values = {
  now: () => FieldValue.serverTimestamp(),
  publishedAt: () => Timestamp.fromMillis(runMs),
  // The picker lists official starters newest first, so the plan's order is
  // kept by its creation times: the starter site newest, the rest a second
  // apart after it.
  createdAt: (order) => Timestamp.fromMillis(runMs - order * 1000),
  appendHistory: (entry) => FieldValue.arrayUnion(entry),
}
let reconciled
try {
  reconciled = plan.map((entry, index) => ({ entry, ...reconcileFirstPartyStarter(entry, storedFor(index), values) }))
} catch (error) {
  fail(error.message)
}

// Listings this seed wrote for this org that the plan no longer names: shown, never removed.
const seeded = await firestore.collection('marketplaceListings').where('seedSource', '==', FIRST_PARTY_STARTER_SEED_SOURCE).get()
const planned = new Set(plan.map((entry) => entry.listingId))
const orphans = seeded.docs.filter((doc) => doc.get('profileId') === orgId && !planned.has(doc.id)).map((doc) => doc.id)

// ── Report ─────────────────────────────────────────────────────────────────
const cell = (value, width) => String(value ?? '-').slice(0, width).padEnd(width)
function printPlan() {
  console.log(`\n${plan.length} first-party starter listings for org ${orgId} in ${target}:\n`)
  console.log(
    [
      cell('action', 9),
      cell('listing', 28),
      cell('name', 30),
      cell('mode', 4),
      cell('kind', 12),
      cell('base', 11),
      cell('fonts', 11),
      cell('pages', 5),
      cell('theme', 7),
      cell('price', 5),
      cell('status', 9),
      'version',
    ].join(' '),
  )
  for (const row of reconciled) {
    const { entry } = row
    const stored = storedFor(entry.order).listing
    // Staff-owned fields show as stored once a listing exists: a run never changes them.
    const shown = stored ?? entry.listing
    const versionText =
      row.versionWrite ? `${row.action === 'create' ? 'create' : 'write'} v${row.version}` : `same v${row.version}`
    console.log(
      [
        cell(row.action, 9),
        cell(entry.listingId, 28),
        cell(shown.displayName, 30),
        cell(entry.listing.starterMode, 4),
        cell(entry.listing.starterKind, 12),
        cell(entry.listing.starterBase, 11),
        cell(entry.listing.starterFonts, 11),
        cell(entry.listing.starterPages, 5),
        cell(entry.version.starter.theme.kind, 7),
        cell(`$${Number(shown.priceUsd ?? 0)}`, 5),
        cell(shown.reviewStatus, 9),
        versionText,
      ].join(' '),
    )
    if (row.action === 'update' && row.seedChanges.length) console.log(`          rewrites ${row.seedChanges.join(', ')}`)
    for (const drift of row.staffDrift) {
      console.log(`          staff set ${drift.field} to ${JSON.stringify(drift.stored)} (plan: ${JSON.stringify(drift.planned)}); kept`)
    }
  }
  const count = (action) => reconciled.filter((row) => row.action === action).length
  const versions = reconciled.filter((row) => row.versionWrite).length
  console.log(`\n${count('create')} to create, ${count('update')} to update, ${count('unchanged')} unchanged; ${versions} version(s) to write.`)
  if (orphans.length) console.log(`Seeded listings the plan no longer names (left as they are): ${orphans.join(', ')}`)
  console.log(blockers.length ? `\n--write would be refused:\n  ${blockers.join('\n  ')}` : '\nThe publisher may list: org, profile and agreement are in place.')
}

async function write() {
  let listings = 0
  let versions = 0
  for (const row of reconciled) {
    if (!row.listingWrite && !row.versionWrite) continue
    const listingRef = firestore.collection('marketplaceListings').doc(row.entry.listingId)
    const batch = firestore.batch()
    if (row.listingWrite) {
      batch.set(listingRef, row.listingWrite, { merge: true })
      listings += 1
    }
    if (row.versionWrite) {
      const { version, data } = row.versionWrite
      batch.set(listingRef.collection('versions').doc(String(version)), data)
      versions += 1
    }
    await batch.commit()
  }
  console.log(`\nWrote ${listings} listing(s) and ${versions} version(s) to ${target}.`)
}

/** Reads every planned listing back. Returns how many problems it found. */
async function verify() {
  const problems = []
  let drifted = 0
  const listings = await firestore.getAll(...listingRefs)
  for (const [index, entry] of plan.entries()) {
    const snapshot = listings[index]
    if (!snapshot.exists) {
      problems.push(`${entry.listingId}: missing`)
      continue
    }
    const listing = snapshot.data()
    const latest = Number(listing.latestVersion ?? 0)
    const version = latest > 0 ? await snapshot.ref.collection('versions').doc(String(latest)).get() : null
    const starter = version?.exists ? version.get('starter') : null
    if (!starter) {
      problems.push(`${entry.listingId}: no starter at versions/${latest}`)
      continue
    }
    const refusal = sources.core.siteStarterRefusal(starter, known)
    if (refusal) problems.push(`${entry.listingId}: versions/${latest} cannot start a site: ${refusal}`)
    let row
    try {
      row = reconcileFirstPartyStarter(entry, { listing, version: version.data() }, values)
    } catch (error) {
      problems.push(error.message)
      continue
    }
    if (row.seedChanges.length) problems.push(`${entry.listingId}: out of date: ${row.seedChanges.join(', ')}`)
    if (row.versionWrite) problems.push(`${entry.listingId}: versions/${latest} is not the planned content (a write makes v${row.version})`)
    const queryPatch = listingQueryFieldsPatch(listing)
    if (queryPatch) problems.push(`${entry.listingId}: stale query fields: ${Object.keys(queryPatch).join(', ')}`)
    for (const drift of row.staffDrift) {
      drifted += 1
      console.log(`  ${entry.listingId}: staff set ${drift.field} to ${JSON.stringify(drift.stored)} (plan: ${JSON.stringify(drift.planned)})`)
    }
  }
  console.log(
    problems.length
      ? `\nVerify: ${problems.length} problem(s):\n  ${problems.join('\n  ')}`
      : `\nVerify: all ${plan.length} listings are stored as planned, each version starts a site` +
          (drifted ? `; ${drifted} staff edit(s) kept, listed above.` : '; no staff edits.'),
  )
  return problems.length
}

printPlan()
if (args.write) {
  if (blockers.length) fail(`--write refused:\n  ${blockers.join('\n  ')}`)
  await write()
}
if (args.verify) {
  const problems = await verify()
  if (problems) process.exit(1)
}
if (!args.write) console.log('\nDry run: nothing was written. Pass --write to write.')

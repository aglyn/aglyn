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

// A workspace on FREE, for the CRM plan gate's end to end (AGL-2809): its own
// owner, organization, site, three people, two leads and a company, written by
// `seed-e2e.mjs` and re-written by `tools/e2e/crm-free-plan.e2e.mjs` before and
// after it runs.
//
// ## A workspace of its own
//
// Every other CRM spec drives the primary e2e org, which is on Business so the
// whole suite is open to it. Turning that org to Free for one spec would leave
// it Free for the next whenever the spec died between the turn and the turn
// back, and every suite after it would fail on a gate it was never about. This
// org is Free whenever it is seeded, and nothing else reads it.
//
// ## A customer's account
//
// The owner holds no staff claim. The gate asks the plan and refuses staff as
// it refuses anyone (AGL-2787), but the console draws staff-only chrome for a
// staff reader, so the console a Free customer has is the one a customer's
// account renders.
//
// ## The people arrived on their own
//
// A form, a newsletter sign-up and an order: the capture doors that fill a
// workspace's contacts without the suite. Each is written the way
// `crm-fixtures.mjs` writes a person — the shared identity on top, the site's
// profile in its facet, the site's token in `visibleTo` — and the company the
// way it writes a company, because a workspace that left a paid plan keeps the
// records it made there.
//
// ## The leads are what Free reads
//
// On a plan without the suite the CRM opens on Leads, read-only (AGL-2790), and
// every form files one. Two are seeded the way `addHostLead` writes them, keyed
// by the person key — the id an erasure marks a site's lead by: Rosa, whose
// catering inquiry also made her a contact, and Priya, worked while the
// workspace was on a paid plan, so Free reads a status, an owner and notes it
// cannot change.
//
// ## Plain `set`, and what a run leaves behind
//
// Every document here is REPLACED, so a re-seed takes back the org's plan and
// the erasure marker the spec files on a person. A run can also leave documents
// the fixture never wrote — the erasure request, a contact or a company the
// Starter control admits, a lead it removes — so those are withdrawn or
// written back too.

import { createHash } from 'node:crypto'
import { Timestamp } from 'firebase-admin/firestore'
import { nameSearchFields } from './crm-fixtures.mjs'

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * `PERSON_ERASURES_COLLECTION` in `libs/aglyn/src/lib/app-utils/person-erasure.ts`.
 * A literal because this module runs under plain node and cannot import
 * TypeScript.
 */
const PERSON_ERASURES_COLLECTION = 'personErasures'

/** The primary e2e org's plugin switchboard, so both workspaces load one console. */
const ENABLED_PLUGINS = [
  'mui',
  'bookings',
  'commerce',
  'marketplace',
  'crm',
  'data',
  'email',
  'events-calendar',
  'inbox',
  'logic',
  'marketing',
  'redirects',
  'workflows',
]

/** The workspace, by name, for the spec to address. */
export const FREE_PLAN_FIXTURE = {
  ownerUid: 'e2e-free-owner',
  /** Derived from the uid, as every seeded address is (AGL-1617). */
  ownerEmail: 'e2e-free-owner@aglyn.test',
  ownerName: 'E2E Free Owner',
  /** The org document id is the owner's uid, as a real signup's is. */
  orgId: 'e2e-free-owner',
  orgSlug: 'e2e-free',
  orgName: 'E2E Corner Cafe',
  hostId: 'free-demo',
  hostName: 'Corner Cafe',
  company: {
    id: 'seed-free-company-riverside',
    name: 'Riverside Market',
    domain: 'riverside-market.example',
  },
  contacts: {
    rosa: { id: 'seed-free-contact-rosa', email: 'rosa.alvarez@example.com', name: 'Rosa Alvarez' },
    ben: { id: 'seed-free-contact-ben', email: 'ben.okafor@example.com', name: 'Ben Okafor' },
    lena: { id: 'seed-free-contact-lena', email: 'lena.park@example.com', name: 'Lena Park' },
  },
  /** The site's leads; each document id is `leadIdFor(email)`. */
  leads: {
    rosa: { email: 'rosa.alvarez@example.com', name: 'Rosa Alvarez' },
    priya: { email: 'priya.shah@example.com', name: 'Priya Shah' },
  },
}

/**
 * A lead's document id: `personKey` in `libs/aglyn/src/lib/app-utils/person-key.ts`,
 * the sha256 of the trimmed, lower-cased address. Restated because this module
 * runs under plain node.
 *
 * @param {string} email
 */
export function leadIdFor(email) {
  return createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex')
}

/**
 * Writes the Free workspace, replacing what is there, and withdraws what a
 * run added to it.
 *
 * @param {object} options
 * @param {import('firebase-admin/firestore').Firestore} options.firestore
 * @param {import('firebase-admin/auth').Auth} options.auth
 * @param {string} options.password The seeded accounts' shared password.
 * @param {(ref: FirebaseFirestore.DocumentReference, data: object) => Promise<void>} [options.write]
 *   The writer, for a caller that counts writes. Defaults to a plain `set`.
 * @param {number} [options.nowMs] The clock the relative dates hang off.
 */
export async function seedFreePlanWorkspace(options) {
  const {
    firestore,
    auth,
    password,
    nowMs = Date.now(),
    write = (ref, data) => ref.set(data),
  } = options
  const F = FREE_PLAN_FIXTURE

  try {
    await auth.getUser(F.ownerUid)
    await auth.updateUser(F.ownerUid, { email: F.ownerEmail, password, emailVerified: true })
  } catch {
    await auth.createUser({
      uid: F.ownerUid,
      email: F.ownerEmail,
      password,
      emailVerified: true,
      displayName: F.ownerName,
    })
  }
  // Cleared on every run, so this account can never drift into staff.
  await auth.setCustomUserClaims(F.ownerUid, {})

  const daysAgo = (days) => Timestamp.fromMillis(nowMs - days * DAY_MS)
  const opened = daysAgo(40)
  const updatedAt = Timestamp.fromMillis(nowMs)
  const userRef = firestore.collection('users').doc(F.ownerUid)
  const orgRef = firestore.collection('orgs').doc(F.orgId)
  const hostRef = firestore.collection('hosts').doc(F.hostId)
  const visibleTo = [`host:${F.hostId}`]

  // The current terms, accepted, as `seed-e2e.mjs` records them for the
  // primary owner — without it every page opens under the re-acceptance banner.
  await write(userRef.collection('legalAcceptances').doc('v1'), {
    version: 'v1',
    documents: [],
    method: 'clickwrap',
    context: 'seed-e2e',
    acceptedAt: opened,
    ipAddress: null,
    userAgent: null,
    updatedAt,
  })
  await write(orgRef, {
    name: F.orgName,
    slug: F.orgSlug,
    ownerUid: F.ownerUid,
    // The plan under test. No subscription: Free has none to be alive or dead.
    plan: 'free',
    enabledPlugins: ENABLED_PLUGINS,
    createdAt: opened,
    updatedAt,
  })
  // The membership a signup writes for its owner (`organizations.ts`): org-wide,
  // with the scope tokens the rules read, so the owner the spec signs in as is
  // the one a real Free workspace has.
  await write(orgRef.collection('members').doc(F.ownerUid), {
    email: F.ownerEmail,
    displayName: F.ownerName,
    role: 'owner',
    status: 'active',
    allHosts: true,
    scopeTokens: ['org'],
    createdAt: opened,
    updatedAt,
  })
  await write(userRef.collection('orgs').doc(F.orgId), {
    orgName: F.orgName,
    slug: F.orgSlug,
    role: 'owner',
    createdAt: opened,
    updatedAt,
  })
  await write(firestore.collection('orgSlugs').doc(F.orgSlug), {
    orgId: F.orgId,
    createdAt: opened,
    updatedAt,
  })
  await write(firestore.collection('hostIndex').doc(F.hostId), {
    orgId: F.orgId,
    subdomain: F.hostId,
    updatedAt,
  })
  await write(hostRef, {
    subdomain: F.hostId,
    displayName: F.hostName,
    orgId: F.orgId,
    memberRoles: { [F.ownerUid]: 'admin' },
    screens: {},
    createdAt: opened,
    updatedAt,
  })
  await write(userRef.collection('hostMemberships').doc(F.hostId), {
    orgId: F.orgId,
    subdomain: F.hostId,
    displayName: F.hostName,
    nameLower: F.hostName.trim().replace(/\s+/g, ' ').toLowerCase(),
    role: 'admin',
    createdAt: opened,
    updatedAt,
  })

  const person = ({ id, email, name }, { capturedDaysAgo, sources, tags, interaction }) => {
    const interactions = [
      { ...interaction, atMs: nowMs - capturedDaysAgo * DAY_MS, hostId: F.hostId },
    ]
    return write(orgRef.collection('contacts').doc(id), {
      email,
      name,
      sources,
      interactions,
      tags,
      capturedByHostIds: [F.hostId],
      visibleTo,
      hostId: F.hostId,
      facets: { [F.hostId]: { sources, tags, interactions } },
      createdAt: daysAgo(capturedDaysAgo),
      updatedAt: daysAgo(capturedDaysAgo),
    })
  }
  await person(F.contacts.rosa, {
    capturedDaysAgo: 9,
    sources: { form: true },
    tags: ['catering'],
    interaction: { type: 'form', summary: 'Catering inquiry', path: '/catering' },
  })
  await person(F.contacts.ben, {
    capturedDaysAgo: 4,
    sources: { newsletter: true },
    tags: ['newsletter'],
    interaction: { type: 'newsletter', summary: 'Subscribed to the weekly menu', path: '/' },
  })
  await person(F.contacts.lena, {
    capturedDaysAgo: 2,
    sources: { order: true },
    tags: [],
    interaction: { type: 'order', summary: 'Order #2001 — $18.50', refId: 'seed-free-order-2001' },
  })
  await write(orgRef.collection('companies').doc(F.company.id), {
    ...nameSearchFields(F.company.name),
    domain: F.company.domain,
    website: `https://${F.company.domain}`,
    createdByUid: F.ownerUid,
    visibleTo,
    hostId: F.hostId,
    createdAt: daysAgo(30),
    updatedAt: daysAgo(30),
  })

  // The leads, as `addHostLead` writes them: one document per person.
  const leadsRef = hostRef.collection('leads')
  const lead = ({ email, name }, { firstSeenDaysAgo, lastSeenDaysAgo, submissionCount, ...worked }) =>
    write(leadsRef.doc(leadIdFor(email)), {
      email,
      name,
      sources: ['form'],
      submissionCount,
      firstSeenAtMs: nowMs - firstSeenDaysAgo * DAY_MS,
      lastSeenAtMs: nowMs - lastSeenDaysAgo * DAY_MS,
      capturedByHostIds: [F.hostId],
      createdAt: daysAgo(firstSeenDaysAgo),
      ...worked,
    })
  await lead(F.leads.rosa, { firstSeenDaysAgo: 9, lastSeenDaysAgo: 9, submissionCount: 1 })
  await lead(F.leads.priya, {
    firstSeenDaysAgo: 20,
    lastSeenDaysAgo: 1,
    submissionCount: 2,
    status: 'working',
    ownerUid: F.ownerUid,
    notes: 'Asked for a catering quote for 40 guests.',
  })

  const people = new Set(Object.values(F.contacts).map((contact) => contact.id))
  for (const doc of (await orgRef.collection('contacts').get()).docs) {
    if (!people.has(doc.id)) await doc.ref.delete()
  }
  for (const doc of (await orgRef.collection('companies').get()).docs) {
    if (doc.id !== F.company.id) await doc.ref.delete()
  }
  const leadIds = new Set(Object.values(F.leads).map((entry) => leadIdFor(entry.email)))
  for (const doc of (await leadsRef.get()).docs) {
    if (!leadIds.has(doc.id)) await doc.ref.delete()
  }
  const erasures = await firestore
    .collection(PERSON_ERASURES_COLLECTION)
    .where('orgId', '==', F.orgId)
    .get()
  for (const doc of erasures.docs) await doc.ref.delete()
}

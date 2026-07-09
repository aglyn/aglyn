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

// One-shot v1 → orgs backfill (AGL-233, docs/MULTI_TENANT_FIRESTORE.md).
// Direct migration — the product is pre-launch, so no dual-write:
//
//   1. Every `tenants/{ownerUid}` becomes `orgs/{orgId}` (billing fields
//      mirrored; source of truth stays on tenants until AGL-237).
//      Tenant managers (AGL-127) become org admins.
//   2. Host admins (per-host uid maps) become org editors with
//      hostAccess { hostId: 'admin' }, merged across hosts.
//   3. Hosts get orgId + the memberRoles rules projection; the org's
//      hosts directory, hostIndex mirror, and users/{uid}/orgs reverse
//      index are written.
//
// Idempotent: owners that already have a reverse-index entry are skipped.
//
//   FIREBASE_PROJECT_ID=… FIREBASE_CLIENT_EMAIL=… FIREBASE_PRIVATE_KEY=… \
//     node tools/scripts/backfill-orgs.mjs [--apply]
//
// Dry-run by default; pass --apply to write.

import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const APPLY = process.argv.includes('--apply')

const projectId = process.env.FIREBASE_PROJECT_ID
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
if (!projectId || !clientEmail || !privateKey) {
  console.error('Missing FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY env vars')
  process.exit(1)
}
if (!getApps().length) {
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
}
const db = getFirestore()
const auth = getAuth()

// Mirrors isValidOrgSlug/generateOrgSlug in @aglyn/aglyn (organizations.ts).
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,29}$/
const RESERVED = new Set([
  'www', 'app', 'api', 'admin', 'console', 'mail', 'demo', 'staging', 'dev',
  'test', 'docs', 'blog', 'help', 'support', 'status', 'cdn', 'assets',
  'static', 'ftp', 'smtp', 'ns1', 'ns2', 'aglyn', 'billing', 'account',
  'login', 'signup', 'auth', 'staff', 'org', 'orgs', 'workspace',
])
function slugify(name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '')
  return SLUG_PATTERN.test(slug) && !RESERVED.has(slug) ? slug : ''
}
const randomId = () =>
  Array.from({ length: 20 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
  ).join('')

const BILLING_KEYS = [
  'plan', 'entitlements', 'seatAddons', 'stripeCustomerId', 'subscription',
  'suspendedAt', 'suspendedReason', 'erasureRequestedAt',
]

async function ownerProfile(uid) {
  try {
    const record = await auth.getUser(uid)
    return { email: record.email ?? null, displayName: record.displayName ?? null }
  } catch {
    return { email: null, displayName: null }
  }
}

// ---------------------------------------------------------------------
// Pass 1: plan orgs from tenants + hosts.
// ---------------------------------------------------------------------
const tenantDocs = (await db.collection('tenants').get()).docs
const hostDocs = (await db.collection('hosts').get()).docs

/** ownerUid -> planned org */
const orgs = new Map()

async function planOrg(ownerUid, tenantData) {
  if (orgs.has(ownerUid)) return orgs.get(ownerUid)
  const existing = await db
    .collection('users').doc(ownerUid).collection('orgs').limit(1).get()
  if (!existing.empty) {
    const orgId = existing.docs[0].id
    const snapshot = await db.collection('orgs').doc(orgId).get()
    const plan = {
      orgId,
      ownerUid,
      name: snapshot.data()?.name ?? 'workspace',
      slug: snapshot.data()?.slug ?? '',
      billing: {},
      members: new Map(),
      hosts: [],
      alreadyExists: true,
    }
    orgs.set(ownerUid, plan)
    return plan
  }
  const profile = await ownerProfile(ownerUid)
  const name = (
    tenantData?.displayName ||
    profile.displayName ||
    profile.email?.split('@')[0] ||
    'workspace'
  ).slice(0, 80)
  const billing = {}
  for (const key of BILLING_KEYS) {
    if (tenantData?.[key] !== undefined) billing[key] = tenantData[key]
  }
  const plan = {
    orgId: randomId(),
    ownerUid,
    name,
    slug: slugify(name) || `org-${randomId().slice(0, 8)}`,
    billing,
    members: new Map([[ownerUid, {
      role: 'owner', allHosts: true,
      email: profile.email, displayName: profile.displayName,
    }]]),
    hosts: [],
    alreadyExists: false,
  }
  orgs.set(ownerUid, plan)
  return plan
}

for (const doc of tenantDocs) {
  const org = await planOrg(doc.id, doc.data())
  if (org.alreadyExists) continue
  // Tenant managers (AGL-127) become org admins.
  const managers = await doc.ref.collection('members').get()
  for (const manager of managers.docs) {
    if (manager.id === doc.id || org.members.has(manager.id)) continue
    const profile = await ownerProfile(manager.id)
    org.members.set(manager.id, {
      role: 'admin', allHosts: true,
      email: profile.email, displayName: profile.displayName,
    })
  }
}

for (const doc of hostDocs) {
  const host = doc.data()
  const ownerUid = host.tenantId || Object.keys(host.admins ?? {})[0]
  if (!ownerUid) {
    console.warn(`! host ${doc.id} has no tenantId and no admins — skipped`)
    continue
  }
  const org = await planOrg(ownerUid, null)
  org.hosts.push({ hostId: doc.id, subdomain: host.subdomain ?? null })
  // Non-owner host admins become editors with admin access on that host.
  for (const uid of Object.keys(host.admins ?? {})) {
    if (org.members.has(uid)) continue
    const profile = await ownerProfile(uid)
    org.members.set(uid, {
      role: 'editor', allHosts: false, hostAccess: {},
      email: profile.email, displayName: profile.displayName,
    })
  }
  for (const uid of Object.keys(host.admins ?? {})) {
    const member = org.members.get(uid)
    if (member?.role === 'editor') {
      member.hostAccess = { ...(member.hostAccess ?? {}), [doc.id]: 'admin' }
    }
  }
}

// ---------------------------------------------------------------------
// Pass 2: report, then write.
// ---------------------------------------------------------------------
const usedSlugs = new Set()
for (const org of orgs.values()) {
  while (usedSlugs.has(org.slug)) org.slug = `${org.slug.slice(0, 26)}-2`
  usedSlugs.add(org.slug)
}

for (const org of orgs.values()) {
  console.log(
    `${org.alreadyExists ? '= existing' : '+ create '} org ${org.slug} ` +
    `(owner ${org.ownerUid}, ${org.members.size ?? 0} members, ` +
    `${org.hosts.length} hosts)`,
  )
}
if (!APPLY) {
  console.log(`\nDry run: ${orgs.size} orgs planned. Re-run with --apply to write.`)
  process.exit(0)
}

function memberRolesFor(org, hostId) {
  const projection = {}
  for (const [uid, member] of org.members) {
    if (member.role === 'owner' || member.role === 'admin') {
      projection[uid] = 'admin'
    } else if (member.hostAccess?.[hostId]) {
      projection[uid] = member.hostAccess[hostId]
    } else if (member.allHosts) {
      projection[uid] = member.role
    }
  }
  return projection
}

for (const org of orgs.values()) {
  if (org.alreadyExists) {
    // Ensure host wiring even for previously-created orgs.
    for (const { hostId, subdomain } of org.hosts) {
      await db.collection('hostIndex').doc(hostId)
        .set({ orgId: org.orgId, ...(subdomain ? { subdomain } : {}) })
      await db.collection('hosts').doc(hostId)
        .set({ orgId: org.orgId }, { merge: true })
      await db.collection('orgs').doc(org.orgId)
        .set({ hosts: { [hostId]: true } }, { merge: true })
    }
    continue
  }
  // Slug reservation + org doc.
  const reservation = await db.collection('orgSlugs').doc(org.slug).get()
  if (reservation.exists && reservation.data()?.orgId !== org.orgId) {
    org.slug = `org-${randomId().slice(0, 8)}`
  }
  await db.collection('orgSlugs').doc(org.slug).set({ orgId: org.orgId })
  await db.collection('orgs').doc(org.orgId).set({
    name: org.name,
    slug: org.slug,
    ownerUid: org.ownerUid,
    hosts: Object.fromEntries(org.hosts.map(({ hostId }) => [hostId, true])),
    ...org.billing,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  })
  // Members + reverse index.
  for (const [uid, member] of org.members) {
    await db.collection('orgs').doc(org.orgId)
      .collection('members').doc(uid).set({
        role: member.role,
        allHosts: member.allHosts === true,
        hostAccess: member.hostAccess ?? {},
        email: member.email,
        displayName: member.displayName,
        joinedAt: FieldValue.serverTimestamp(),
      })
    await db.collection('users').doc(uid)
      .collection('orgs').doc(org.orgId)
      .set({ role: member.role, orgName: org.name, slug: org.slug })
  }
  // Hosts: orgId + memberRoles projection + hostIndex.
  for (const { hostId, subdomain } of org.hosts) {
    await db.collection('hosts').doc(hostId).set({
      orgId: org.orgId,
      memberRoles: memberRolesFor(org, hostId),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await db.collection('hostIndex').doc(hostId)
      .set({ orgId: org.orgId, ...(subdomain ? { subdomain } : {}) })
  }
  console.log(`✓ ${org.slug} (${org.orgId})`)
}
console.log(`\nBackfilled ${orgs.size} orgs.`)

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

// Firestore rules matrix for the org tenancy model (AGL-235/238). Runs
// inside the emulator via `npm run test:rules` (firebase emulators:exec
// sets FIRESTORE_EMULATOR_HOST). Covers the member/non-member/wrong-org/
// viewer/editor/suspended/staff axes for orgs and hosts, plus the staff
// RBAC key-diff guards that moved here from the retired tenants rules.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'

const here = dirname(fileURLToPath(import.meta.url))

/** @type {import('@firebase/rules-unit-testing').RulesTestEnvironment} */
let env

const ORG = 'org-acme'
const OTHER_ORG = 'org-other'
const SUSPENDED_ORG = 'org-suspended'
const HOST = 'host-a'
const SUSPENDED_HOST = 'host-suspended'

const OWNER = 'uid-owner'
const EDITOR = 'uid-editor' // hostAccess: HOST=editor
const VIEWER = 'uid-viewer' // allHosts viewer
const LEGACY = 'uid-legacy' // only in the retired host admins map
const OUTSIDER = 'uid-outsider'
const STAFF = 'uid-staff'

const authed = (uid, tokens) => env.authenticatedContext(uid, tokens).firestore()
const anon = () => env.unauthenticatedContext().firestore()

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-check',
    firestore: {
      rules: readFileSync(join(here, '..', 'firebase-firestore.rules'), 'utf8'),
    },
  })
})
after(async () => {
  await env?.cleanup()
})

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await setDoc(doc(db, 'orgs', ORG), {
      name: 'Acme', slug: 'acme', ownerUid: OWNER,
      hosts: { [HOST]: true }, plan: 'pro',
    })
    await setDoc(doc(db, 'orgs', ORG, 'members', OWNER), {
      role: 'owner', allHosts: true,
    })
    await setDoc(doc(db, 'orgs', ORG, 'members', EDITOR), {
      role: 'editor', allHosts: false, hostAccess: { [HOST]: 'editor' },
    })
    await setDoc(doc(db, 'orgs', ORG, 'members', VIEWER), {
      role: 'viewer', allHosts: true,
    })
    await setDoc(doc(db, 'orgs', ORG, 'invites', 'invite-1'), {
      email: 'new@acme.test', role: 'editor', acceptedAt: null,
    })
    await setDoc(doc(db, 'orgs', OTHER_ORG), {
      name: 'Other', slug: 'other', ownerUid: OUTSIDER, hosts: {},
    })
    await setDoc(doc(db, 'orgs', OTHER_ORG, 'members', OUTSIDER), {
      role: 'owner', allHosts: true,
    })
    await setDoc(doc(db, 'orgSlugs', 'acme'), { orgId: ORG })
    await setDoc(doc(db, 'hostIndex', HOST), { orgId: ORG })
    await setDoc(doc(db, 'users', OWNER, 'orgs', ORG), {
      role: 'owner', orgName: 'Acme', slug: 'acme',
    })
    await setDoc(doc(db, 'hosts', HOST), {
      displayName: 'Site A', orgId: ORG,
      admins: { [LEGACY]: true }, // retired map — must NOT authorize
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor', [VIEWER]: 'viewer' },
    })
    await setDoc(doc(db, 'hosts', HOST, 'screens', 'screen-1'), { name: 'Home' })
    await setDoc(doc(db, 'hosts', HOST, 'variables', 'var-1'), { name: 'v', value: '1' })
    // Suspension write-block (AGL-238): host owned by a suspended org.
    await setDoc(doc(db, 'orgs', SUSPENDED_ORG), {
      name: 'Frozen', slug: 'frozen', ownerUid: OWNER,
      plan: 'pro', suspendedAt: new Date(),
    })
    await setDoc(doc(db, 'hosts', SUSPENDED_HOST), {
      displayName: 'Suspended', orgId: SUSPENDED_ORG,
      memberRoles: { [OWNER]: 'admin', [EDITOR]: 'editor' },
    })
    await setDoc(doc(db, 'hosts', SUSPENDED_HOST, 'screens', 's1'), { name: 'X' })
  })
})

describe('org docs', () => {
  it('members and staff read; outsiders and anon do not', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG)))
    await assertSucceeds(getDoc(doc(authed(STAFF, { staff: true }), 'orgs', ORG)))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG)))
    await assertFails(getDoc(doc(anon(), 'orgs', ORG)))
  })

  it('admins rename; editors cannot; billing keys are locked', async () => {
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { name: 'Acme Inc' }),
    )
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'orgs', ORG), { name: 'Nope' }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { plan: 'business' }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { slug: 'stolen' }),
    )
    await assertFails(setDoc(doc(authed(OWNER), 'orgs', 'org-new'), { name: 'X' }))
  })

  it('suspended members cannot rename', async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      await updateDoc(
        doc(context.firestore(), 'orgs', ORG, 'members', OWNER),
        { orgSuspended: true },
      )
    })
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { name: 'Still here' }),
    )
  })

  it('roster reads are org-wide; writes are API-only; invites are manager-only', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'members', OWNER)))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'members', OWNER)))
    await assertFails(
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'members', 'uid-sneak'), {
        role: 'admin',
      }),
    )
    await assertSucceeds(getDoc(doc(authed(OWNER), 'orgs', ORG, 'invites', 'invite-1')))
    await assertFails(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'invites', 'invite-1')))
  })
})

describe('resolution collections', () => {
  it('orgSlugs read publicly, never written', async () => {
    await assertSucceeds(getDoc(doc(anon(), 'orgSlugs', 'acme')))
    await assertFails(setDoc(doc(authed(OWNER), 'orgSlugs', 'grab'), { orgId: ORG }))
  })

  it('hostIndex is signed-in read, API-write', async () => {
    await assertSucceeds(getDoc(doc(authed(OUTSIDER), 'hostIndex', HOST)))
    await assertFails(getDoc(doc(anon(), 'hostIndex', HOST)))
    await assertFails(setDoc(doc(authed(OWNER), 'hostIndex', 'h2'), { orgId: ORG }))
  })

  it('reverse index readable only by its user', async () => {
    await assertSucceeds(getDoc(doc(authed(OWNER), 'users', OWNER, 'orgs', ORG)))
    await assertFails(getDoc(doc(authed(EDITOR), 'users', OWNER, 'orgs', ORG)))
    await assertFails(
      setDoc(doc(authed(OWNER), 'users', OWNER, 'orgs', 'org-fake'), {
        role: 'owner',
      }),
    )
  })
})

describe('hosts', () => {
  it('memberRoles grant reads to every role, writes to editor+', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'hosts', HOST)))
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'hosts', HOST, 'screens', 'screen-1')))
    await assertFails(
      updateDoc(doc(authed(VIEWER), 'hosts', HOST, 'screens', 'screen-1'), { name: 'No' }),
    )
    // Screen/layout DOC creates are API-only (AGL-473) — even editors
    // cannot create directly; updates/deletes on existing docs still work.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-2'), { name: 'New' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'layouts', 'layout-2'), { name: 'New' }),
    )
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1'), { name: 'Yes' }),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1')),
    )
    // Versions (and other screen subcollections) stay editor-writable —
    // they aren't quota-governed.
    await assertSucceeds(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'screens', 'screen-1', 'versions', 'v1'), { nodes: {} }),
    )
    // Quota-governed logic collections are API-create-only too (AGL-473):
    // editors cannot create, but can update/delete existing docs.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'variables', 'var-new'), { name: 'v' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'functions', 'fn-new'), { name: 'f' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'workflows', 'wf-new'), { name: 'w' }),
    )
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'variables', 'var-1'), { value: '2' }),
    )
    // Commerce/bookings/redirects/reusable-components/registers collections
    // are API-create-only too (registers gate the posRegisters cap).
    for (const coll of ['services', 'redirects', 'locations', 'products', 'components', 'registers']) {
      await assertFails(
        setDoc(doc(authed(EDITOR), 'hosts', HOST, coll, 'new-doc'), { name: 'x' }),
      )
    }
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { displayName: 'Renamed' }),
    )
    await assertFails(deleteDoc(doc(authed(EDITOR), 'hosts', HOST)))
    await assertSucceeds(deleteDoc(doc(authed(OWNER), 'hosts', HOST)))
  })

  it('the retired admins map no longer authorizes; outsiders and anon never do', async () => {
    await assertFails(getDoc(doc(authed(LEGACY), 'hosts', HOST)))
    await assertFails(
      setDoc(doc(authed(LEGACY), 'hosts', HOST, 'screens', 'legacy'), { name: 'L' }),
    )
    await assertFails(getDoc(doc(authed(OUTSIDER), 'hosts', HOST)))
    await assertFails(getDoc(doc(anon(), 'hosts', HOST, 'screens', 'screen-1')))
    await assertFails(
      setDoc(doc(authed(OUTSIDER), 'hosts', HOST, 'screens', 'attack'), { x: 1 }),
    )
  })

  it('client host creation is closed; staff reads anything', async () => {
    await assertFails(
      setDoc(doc(authed(OWNER), 'hosts', 'host-new'), {
        admins: { [OWNER]: true },
      }),
    )
    await assertSucceeds(getDoc(doc(authed(STAFF, { staff: true }), 'hosts', HOST)))
  })

  it('suspended orgs keep reads but lose writes', async () => {
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'hosts', SUSPENDED_HOST)))
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', SUSPENDED_HOST, 'screens', 's2'), { x: 1 }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', SUSPENDED_HOST), { displayName: 'N' }),
    )
  })
})

describe('org-shared data (AGL-237)', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds1'), { name: 'Team' })
      await setDoc(doc(db, 'orgs', ORG, 'datasets', 'ds1', 'records', 'r1'), { a: 1 })
      await setDoc(doc(db, 'orgs', ORG, 'contacts', 'c1'), { email: 'x@y.z' })
      await setDoc(doc(db, 'orgs', ORG, 'media', 'm1'), { url: 'u' })
      await setDoc(doc(db, 'orgs', ORG, 'installs', 'p1'), { version: '1' })
    })
  })

  it('members read; editors write datasets/contacts; viewers stay read-only', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'datasets', 'ds1')))
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'datasets', 'ds1', 'records', 'r1')))
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'contacts', 'c1')))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'datasets', 'ds1')))
    // Dataset/record CREATES are API-only (AGL-473) — the console route
    // enforces quotas server-side; even editors cannot create directly.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds2'), { name: 'New' }),
    )
    await assertFails(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1', 'records', 'r2'), { a: 2 }),
    )
    // Updates and deletes stay editor-writable — they don't consume quota.
    await assertSucceeds(
      setDoc(
        doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1', 'records', 'r1'),
        { a: 3 },
        { merge: true },
      ),
    )
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'orgs', ORG, 'datasets', 'ds1', 'records', 'r1')),
    )
    await assertSucceeds(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'contacts', 'c2'), { email: 'n@y.z' }),
    )
    await assertFails(
      setDoc(doc(authed(VIEWER), 'orgs', ORG, 'contacts', 'c3'), { email: 'v@y.z' }),
    )
  })

  it('media docs and folders are editor-writable (DAM parity); installs stay API-only', async () => {
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'orgs', ORG, 'media', 'm1')))
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'orgs', ORG, 'installs', 'p1')))
    await assertFails(getDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'media', 'm1')))
    await assertSucceeds(
      setDoc(doc(authed(EDITOR), 'orgs', ORG, 'media', 'm1'), { folderId: 'f1' }, { merge: true }),
    )
    await assertSucceeds(
      setDoc(doc(authed(OWNER), 'orgs', ORG, 'mediaFolders', 'f1'), { name: 'Brand' }),
    )
    await assertFails(
      setDoc(doc(authed(VIEWER), 'orgs', ORG, 'mediaFolders', 'f2'), { name: 'No' }),
    )
    await assertFails(
      setDoc(doc(authed(OUTSIDER), 'orgs', ORG, 'media', 'm2'), { url: 'x' }),
    )
    await assertFails(setDoc(doc(authed(OWNER), 'orgs', ORG, 'installs', 'p2'), { version: '2' }))
  })
})

describe('staff RBAC on org billing keys (AGL-206/238)', () => {
  it('billing staff writes plans but cannot smuggle a suspension or slug', async () => {
    const billingStaffDb = authed(STAFF, { staff: true, staffRole: 'billing' })
    await assertSucceeds(
      updateDoc(doc(billingStaffDb, 'orgs', ORG), { plan: 'business' }),
    )
    await assertFails(
      updateDoc(doc(billingStaffDb, 'orgs', ORG), {
        suspendedAt: new Date(),
      }),
    )
    await assertFails(
      updateDoc(doc(billingStaffDb, 'orgs', ORG), { slug: 'stolen' }),
    )
    const superStaffDb = authed(STAFF, { staff: true, staffRole: 'super' })
    await assertSucceeds(
      updateDoc(doc(superStaffDb, 'orgs', ORG), { suspendedAt: new Date() }),
    )
  })

  it('support staff reads orgs but cannot write billing keys', async () => {
    const supportStaffDb = authed(STAFF, { staff: true, staffRole: 'support' })
    await assertSucceeds(getDoc(doc(supportStaffDb, 'orgs', ORG)))
    await assertFails(
      updateDoc(doc(supportStaffDb, 'orgs', ORG), { plan: 'business' }),
    )
  })
})

// Pre-release hardening: field-level guards added by the security audit
// (AGL-493/494/501/502/503/508). Each proves the guard denies the abusive
// write/read while leaving the legitimate one intact.
describe('pre-release hardening guards', () => {
  const LISTING = 'listing-1'
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      // Publisher profile owned by OWNER (H3, M6 seed).
      await setDoc(doc(db, 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner',
      })
      // Secret-/PII-bearing host subcollections (M5).
      await setDoc(doc(db, 'hosts', HOST, 'webhooks', 'wh1'), {
        url: 'https://hook.example', secret: 'sh',
      })
      await setDoc(doc(db, 'hosts', HOST, 'orders', 'o1'), {
        total: 100, email: 'buyer@x.z',
      })
      // Host plugin install pin (M11).
      await setDoc(doc(db, 'hosts', HOST, 'installs', 'p1'), {
        version: '1.0.0', sha256: 'abc',
      })
      // Community listing owned by OWNER with server-managed fields (M6).
      await setDoc(doc(db, 'communityListings', LISTING), {
        profileId: OWNER, name: 'Plugin', installCount: 5, priceUsd: 10,
      })
    })
  })

  it('editors/admins cannot rewrite host identity keys; staff can (AGL-493)', async () => {
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { memberRoles: { [EDITOR]: 'admin' } }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'hosts', HOST), {
        memberRoles: { [OWNER]: 'admin', [OUTSIDER]: 'admin' },
      }),
    )
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { orgId: 'org-fake' }),
    )
    // Content updates still work; staff may still adjust the projection.
    await assertSucceeds(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST), { displayName: 'Renamed' }),
    )
    await assertSucceeds(
      updateDoc(doc(authed(STAFF, { staff: true }), 'hosts', HOST), {
        memberRoles: { [OWNER]: 'admin' },
      }),
    )
  })

  it('profile owner cannot set Stripe payout fields; metadata is fine (AGL-494)', async () => {
    await assertSucceeds(
      setDoc(doc(authed(OWNER), 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner', bio: 'hi',
      }),
    )
    await assertFails(
      setDoc(doc(authed(OWNER), 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner', stripeChargesEnabled: true,
      }),
    )
    await assertFails(
      setDoc(doc(authed(OWNER), 'profiles', OWNER), {
        handle: 'owner-pub', displayName: 'Owner', stripeAccountId: 'acct_x',
      }),
    )
    // A brand-new profile likewise can't smuggle the payout fields in on create.
    await assertFails(
      setDoc(doc(authed(EDITOR), 'profiles', EDITOR), {
        handle: 'ed-pub', displayName: 'Ed', stripeAccountId: 'acct_y',
      }),
    )
    await assertSucceeds(
      setDoc(doc(authed(EDITOR), 'profiles', EDITOR), {
        handle: 'ed-pub', displayName: 'Ed',
      }),
    )
  })

  it('org admins cannot self-enable plugins; super staff can (AGL-501)', async () => {
    await assertFails(
      updateDoc(doc(authed(OWNER), 'orgs', ORG), { enabledPlugins: ['paid'] }),
    )
    await assertFails(
      updateDoc(
        doc(authed(STAFF, { staff: true, staffRole: 'billing' }), 'orgs', ORG),
        { enabledPlugins: ['paid'] },
      ),
    )
    await assertSucceeds(
      updateDoc(
        doc(authed(STAFF, { staff: true, staffRole: 'super' }), 'orgs', ORG),
        { enabledPlugins: ['paid'] },
      ),
    )
  })

  it('webhook secrets and order PII are hidden from viewers (AGL-502)', async () => {
    await assertSucceeds(getDoc(doc(authed(EDITOR), 'hosts', HOST, 'webhooks', 'wh1')))
    await assertSucceeds(getDoc(doc(authed(OWNER), 'hosts', HOST, 'orders', 'o1')))
    await assertFails(getDoc(doc(authed(VIEWER), 'hosts', HOST, 'webhooks', 'wh1')))
    await assertFails(getDoc(doc(authed(VIEWER), 'hosts', HOST, 'orders', 'o1')))
    // A non-secret subcollection stays viewer-readable (catch-all unchanged).
    await assertSucceeds(getDoc(doc(authed(VIEWER), 'hosts', HOST, 'variables', 'var-1')))
  })

  it('listing owner cannot tamper server-managed fields (AGL-503)', async () => {
    await assertSucceeds(
      updateDoc(doc(authed(OWNER), 'communityListings', LISTING), { deletedAt: new Date() }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'communityListings', LISTING), { installCount: 9999 }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'communityListings', LISTING), { priceUsd: 0 }),
    )
    await assertFails(
      updateDoc(doc(authed(OWNER), 'communityListings', LISTING), { profileId: OUTSIDER }),
    )
    // Non-owners still can't touch someone else's listing.
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'communityListings', LISTING), { deletedAt: new Date() }),
    )
  })

  it('host install pins are create/update API-only but client-deletable (AGL-508)', async () => {
    await assertFails(
      setDoc(doc(authed(EDITOR), 'hosts', HOST, 'installs', 'p2'), { version: '2.0.0' }),
    )
    await assertFails(
      updateDoc(doc(authed(EDITOR), 'hosts', HOST, 'installs', 'p1'), { version: '9.0.0' }),
    )
    // Uninstall (delete) stays a client action for editors/admins.
    await assertSucceeds(
      deleteDoc(doc(authed(EDITOR), 'hosts', HOST, 'installs', 'p1')),
    )
  })
})

assert.ok(true)

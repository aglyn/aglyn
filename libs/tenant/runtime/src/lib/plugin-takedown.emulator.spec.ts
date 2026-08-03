/**
 * @jest-environment node
 */

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

/**
 * "Staff clicks Take down → the plugin stops running on a site", end to end
 * against a real Firestore (AGL-958).
 *
 * Every execution path already has unit tests over mocked Firestore, and the
 * writes were checked by hand against production — but nothing exercised the
 * REAL resolvers against REAL data, so the chain was only ever verified in
 * pieces. A kill switch verified in pieces is the kind that turns out not to
 * kill.
 *
 * Two resolvers, two mechanisms, and they are genuinely different:
 *
 *   getRealmPluginInstalls  drops the install entirely when the LISTING is
 *                           hidden (`hiddenAt`) — the realm loader never sees it
 *   getPluginInstalls       keeps the install and flags `revoked` from
 *                           `revocations/{listingId}` — the node renders the
 *                           disabled placeholder rather than vanishing
 *
 * Both are asserted, because a takedown that satisfied only one would leave
 * the plugin either invisibly still-loading or visibly gone-without-trace.
 *
 * Uses the Admin SDK against the emulator, which needs no auth — that is what
 * makes this runnable at all: gRPC auth does not survive the jest sandbox, so
 * a prod-credentialled version of this test dies in google-auth-library.
 *
 * Skipped unless FIRESTORE_EMULATOR_HOST is set, so a normal `nx test` run is
 * unaffected and this can never touch production.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main   (in cloud/)
 *   FIRESTORE_EMULATOR_HOST=localhost:8082 \
 *     npx jest -c libs/tenant/runtime/jest.config.ts --testPathPatterns plugin-takedown
 */

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

const EMULATED = Boolean(process.env.FIRESTORE_EMULATOR_HOST)

const ORG = 'e2e-takedown-org'
const HOST = 'e2e-takedown-host'
/** Installed at ORG tier — the common case for a marketplace plugin. */
const ORG_LISTING = 'e2e-listing-org'
/** Installed at HOST tier, to prove the more specific pin is covered too. */
const HOST_LISTING = 'e2e-listing-host'
/** Installed, but its listing doc is deleted — deliberately NOT a blocker. */
const ORPHAN_LISTING = 'e2e-listing-orphan'

const VERSION = '1.0.0'
const OTHER_VERSION = '1.0.1'
const SHA = 'a'.repeat(64)
/** Realm trust REQUIRES a signature — an unsigned version resolves to null. */
const SIGNATURE = 'sig-' + 'b'.repeat(60)

if (EMULATED && !getApps().length) {
  initializeApp({ projectId: 'aglyn-main' })
}

const describeEmulated = EMULATED ? describe : describe.skip

async function seed(db: Firestore): Promise<void> {
  // Reset first. The emulator keeps state between runs, and a previous run's
  // takedown left `revocations` behind — which reads as "this test is failing"
  // rather than "the fixture is dirty". Cost me one wrong diagnosis already.
  for (const listingId of [ORG_LISTING, HOST_LISTING, ORPHAN_LISTING]) {
    await db.collection('revocations').doc(listingId).delete()
    await db.recursiveDelete(db.collection('marketplaceListings').doc(listingId))
  }
  await db.recursiveDelete(db.collection('orgs').doc(ORG))
  await db.recursiveDelete(db.collection('hosts').doc(HOST))

  await db.collection('hosts').doc(HOST).set({ orgId: ORG, subdomain: HOST })
  // `resolveOrgIdForHost` reads hostIndex, NOT the host doc — the host→org
  // edge lives in its own lookup collection.
  await db.collection('hostIndex').doc(HOST).set({ orgId: ORG })
  await db.collection('orgs').doc(ORG).set({ slug: ORG })

  // Listings + version docs. `trust: 'realm'` is what makes these eligible
  // for the realm loader at all.
  for (const listingId of [ORG_LISTING, HOST_LISTING]) {
    await db.collection('marketplaceListings').doc(listingId).set({
      displayName: listingId,
      reviewStatus: 'listed',
    })
    for (const version of [VERSION, OTHER_VERSION]) {
      await db
        .collection('marketplaceListings')
        .doc(listingId)
        .collection('pluginVersions')
        .doc(version)
        .set({ sha256: SHA, signature: SIGNATURE, trust: 'realm', manifest: { hostAbi: 1 } })
    }
  }

  // The orphan: a version doc with NO listing doc above it. Firestore does not
  // cascade deletes into subcollections, so this shape exists in the wild.
  await db
    .collection('marketplaceListings')
    .doc(ORPHAN_LISTING)
    .collection('pluginVersions')
    .doc(VERSION)
    .set({ sha256: SHA, signature: SIGNATURE, trust: 'realm', manifest: { hostAbi: 1 } })

  await db
    .collection('orgs')
    .doc(ORG)
    .collection('installs')
    .doc(ORG_LISTING)
    .set({ version: VERSION, sha256: SHA, manifest: { capabilities: [] } })
  await db
    .collection('orgs')
    .doc(ORG)
    .collection('installs')
    .doc(ORPHAN_LISTING)
    .set({ version: VERSION, sha256: SHA, manifest: { capabilities: [] } })
  await db
    .collection('hosts')
    .doc(HOST)
    .collection('installs')
    .doc(HOST_LISTING)
    .set({ version: VERSION, sha256: SHA, manifest: { capabilities: [] } })
}

/** What staff's Take down writes: hide the listing AND revoke every version. */
async function takedown(db: Firestore, listingId: string): Promise<void> {
  await db
    .collection('marketplaceListings')
    .doc(listingId)
    .set({ hiddenAt: new Date() }, { merge: true })
  const current = (await db.collection('revocations').doc(listingId).get()).data()
  await db
    .collection('revocations')
    .doc(listingId)
    .set({
      ...current,
      versions: 'all',
      source: 'takedown',
      reviewVersions: current?.['reviewVersions'] ?? [],
    })
}

/** What un-hiding writes: clear the hide, and hand the doc back to review. */
async function restore(db: Firestore, listingId: string): Promise<void> {
  const ref = db.collection('marketplaceListings').doc(listingId)
  await ref.set({ hiddenAt: null }, { merge: true })
  const current = (await db.collection('revocations').doc(listingId).get()).data()
  const reviewVersions: string[] = (current?.['reviewVersions'] as string[]) ?? []
  if (!reviewVersions.length) {
    await db.collection('revocations').doc(listingId).delete()
    return
  }
  // The review-owned half SURVIVES the restore — that is the whole point of
  // keeping `reviewVersions` separate from `versions`.
  await db
    .collection('revocations')
    .doc(listingId)
    .set({ versions: reviewVersions, reviewVersions })
}

describeEmulated('a taken-down plugin stops executing (AGL-958)', () => {
  let db: Firestore
  let getRealmPluginInstalls: typeof import('@aglyn/tenant-data-admin').getRealmPluginInstalls
  let getPluginInstalls: typeof import('./get-plugin-installs').getPluginInstalls

  beforeAll(async () => {
    db = getFirestore()
    await seed(db)
    getRealmPluginInstalls = (await import('@aglyn/tenant-data-admin'))
      .getRealmPluginInstalls
    getPluginInstalls = (await import('./get-plugin-installs')).getPluginInstalls
  }, 60_000)

  it('loads org-tier and host-tier installs before any takedown', async () => {
    const realm = await getRealmPluginInstalls({ hostId: HOST })
    const ids = realm.map((entry) => entry.listingId).sort()
    expect(ids).toContain(ORG_LISTING)
    expect(ids).toContain(HOST_LISTING)

    const installs = await getPluginInstalls({ hostId: HOST })
    expect(installs[ORG_LISTING]?.revoked).toBe(false)
    expect(installs[HOST_LISTING]?.revoked).toBe(false)
  }, 60_000)

  it('a hard-deleted listing does NOT stop its installs — only a takedown does', async () => {
    // Firestore does not cascade into subcollections, so an orphaned version
    // doc keeps resolving. This is deliberate, and it is the reason a takedown
    // has to be an explicit flag rather than "is the listing still there".
    const realm = await getRealmPluginInstalls({ hostId: HOST })
    expect(realm.map((entry) => entry.listingId)).toContain(ORPHAN_LISTING)
  }, 60_000)

  it('a takedown drops the realm install and flags the pin revoked', async () => {
    await takedown(db, ORG_LISTING)

    const realm = await getRealmPluginInstalls({ hostId: HOST })
    expect(realm.map((entry) => entry.listingId)).not.toContain(ORG_LISTING)
    // The control: taking one listing down must not take the others with it.
    expect(realm.map((entry) => entry.listingId)).toContain(HOST_LISTING)

    const installs = await getPluginInstalls({ hostId: HOST })
    expect(installs[ORG_LISTING]?.revoked).toBe(true)
    expect(installs[HOST_LISTING]?.revoked).toBe(false)
  }, 60_000)

  /**
   * The two mechanisms ISOLATED, because a real takedown writes both and so
   * proves neither on its own.
   *
   * Verified by breaking `hiddenAt` in the resolver and watching the takedown
   * tests stay green: the revocation was carrying them. A test that cannot
   * tell which half is doing the work cannot notice when one half stops.
   */
  it('hiding the listing ALONE drops the realm install (no revocation)', async () => {
    await db
      .collection('marketplaceListings')
      .doc(HOST_LISTING)
      .set({ hiddenAt: new Date() }, { merge: true })
    // No revocations doc — `hiddenAt` is the only thing that can drop it.
    expect(
      (await db.collection('revocations').doc(HOST_LISTING).get()).exists,
    ).toBe(false)

    try {
      const realm = await getRealmPluginInstalls({ hostId: HOST })
      expect(realm.map((entry) => entry.listingId)).not.toContain(HOST_LISTING)
    } finally {
      // In `finally` so a failure here cannot leave the listing hidden and
      // fail the NEXT test too — a cascading failure reports the wrong cause.
      await db
        .collection('marketplaceListings')
        .doc(HOST_LISTING)
        .set({ hiddenAt: null }, { merge: true })
    }
  }, 60_000)

  it('a revocation ALONE drops the realm install (listing still visible)', async () => {
    await db
      .collection('revocations')
      .doc(HOST_LISTING)
      .set({ versions: 'all', reviewVersions: [] })
    // Listing is NOT hidden — the revocation is the only thing that can drop it.
    expect(
      (await db.collection('marketplaceListings').doc(HOST_LISTING).get()).get(
        'hiddenAt',
      ),
    ).toBeFalsy()

    try {
      const realm = await getRealmPluginInstalls({ hostId: HOST })
      expect(realm.map((entry) => entry.listingId)).not.toContain(HOST_LISTING)
      expect((await getPluginInstalls({ hostId: HOST }))[HOST_LISTING]?.revoked).toBe(true)
    } finally {
      await db.collection('revocations').doc(HOST_LISTING).delete()
    }
  }, 60_000)

  it('a host-tier install is killed by a takedown too', async () => {
    await takedown(db, HOST_LISTING)
    const realm = await getRealmPluginInstalls({ hostId: HOST })
    expect(realm.map((entry) => entry.listingId)).not.toContain(HOST_LISTING)
    expect((await getPluginInstalls({ hostId: HOST }))[HOST_LISTING]?.revoked).toBe(true)
  }, 60_000)

  it('restoring brings it back', async () => {
    await restore(db, ORG_LISTING)
    await restore(db, HOST_LISTING)

    const realm = await getRealmPluginInstalls({ hostId: HOST })
    expect(realm.map((entry) => entry.listingId)).toContain(ORG_LISTING)
    expect(realm.map((entry) => entry.listingId)).toContain(HOST_LISTING)

    const installs = await getPluginInstalls({ hostId: HOST })
    expect(installs[ORG_LISTING]?.revoked).toBe(false)
    expect(installs[HOST_LISTING]?.revoked).toBe(false)
  }, 60_000)

  /**
   * The two-writer case, and the one most likely to regress silently.
   *
   * A reviewer stops ONE version's bytes. Staff then take the whole listing
   * down, which flattens `versions` to `'all'`. Restoring must give the doc
   * back to review — NOT clear it — or un-hiding a listing would quietly
   * resurrect a version a reviewer had independently killed.
   */
  it('a restore does not resurrect a version the reviewer revoked', async () => {
    await db
      .collection('revocations')
      .doc(ORG_LISTING)
      .set({ versions: [OTHER_VERSION], reviewVersions: [OTHER_VERSION] })

    await takedown(db, ORG_LISTING)
    await restore(db, ORG_LISTING)

    const revocation = (
      await db.collection('revocations').doc(ORG_LISTING).get()
    ).data()
    expect(revocation?.['reviewVersions']).toEqual([OTHER_VERSION])

    // The pinned version is 1.0.0 and is fine again…
    const installs = await getPluginInstalls({ hostId: HOST })
    expect(installs[ORG_LISTING]?.revoked).toBe(false)

    // …but the reviewer's kill on 1.0.1 survived the whole cycle.
    await db
      .collection('orgs')
      .doc(ORG)
      .collection('installs')
      .doc(ORG_LISTING)
      .set({ version: OTHER_VERSION, sha256: SHA }, { merge: true })
    const afterRepin = await getPluginInstalls({ hostId: HOST })
    expect(afterRepin[ORG_LISTING]?.revoked).toBe(true)
  }, 60_000)
})

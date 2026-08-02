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
 * "Staff clicks Take down → the plugin stops running" — end to end (AGL-958).
 *
 * Every step of this chain had unit coverage over mocked Firestore, and the
 * writes were checked by hand against production, but nothing exercised the
 * REAL resolvers against real data. A kill switch verified only in pieces is
 * the kind that stops killing in exactly one place and nobody notices
 * (AGL-1085 was that, one layer down).
 *
 * Runs against the Firestore emulator, which the Admin SDK reaches with no
 * credentials — the thing that made this possible, since real ADC dies inside
 * the jest sandbox.
 *
 *   npx firebase emulators:start --only firestore --project aglyn-main
 *   npx jest --config libs/tenant/data/admin/jest.integration.config.ts
 *
 * What it deliberately does NOT cover: the browser half. These resolvers
 * deciding to return nothing is necessary for a takedown to work and not
 * sufficient — the loader still has to honour an empty list. That needs a
 * fixture site with a plugin actually placed on a screen, which this issue
 * notes does not exist.
 */

import {
  getRealmPluginInstalls,
  resolveMarketplacePluginVersion,
} from './realm-plugins'
import firebaseAdmin from './firebase-admin'

const LISTING = 'zz-takedown-listing'
const VERSION = '1.2.3'
const ORG = 'zz-takedown-org'
const HOST = 'zz-takedown-host'

const db = () => firebaseAdmin.app().firestore()

/** A listing whose pinned version is realm-trusted and signed. */
async function seed(): Promise<void> {
  const listing = db().collection('marketplaceListings').doc(LISTING)
  await listing.set({ displayName: 'Takedown Fixture', orgId: ORG })
  await listing.collection('pluginVersions').doc(VERSION).set({
    sha256: 'a'.repeat(64),
    signature: 'c2lnbmF0dXJl',
    trust: 'realm',
    hostAbi: 1,
  })
  await db().collection('orgs').doc(ORG).set({ name: 'Takedown Org' })
  await db().collection('hosts').doc(HOST).set({ orgId: ORG })
  await db()
    .collection('orgs')
    .doc(ORG)
    .collection('installs')
    .doc(LISTING)
    .set({ version: VERSION })
}

async function wipe(): Promise<void> {
  await db().recursiveDelete(db().collection('marketplaceListings').doc(LISTING))
  await db().recursiveDelete(db().collection('orgs').doc(ORG))
  await db().recursiveDelete(db().collection('hosts').doc(HOST))
  await db().collection('revocations').doc(LISTING).delete().catch(() => undefined)
}

const listingRef = () => db().collection('marketplaceListings').doc(LISTING)

jest.setTimeout(30000)

describe('a taken-down plugin stops resolving (AGL-958)', () => {
  beforeEach(async () => {
    await wipe()
    await seed()
  })
  afterAll(async () => {
    await wipe()
  })

  it('loads before anything happens — the control', async () => {
    // Without this the rest is unfalsifiable: every later assertion is
    // "returns nothing", which a broken fixture also satisfies.
    const installs = await getRealmPluginInstalls({ orgId: ORG })
    expect(installs).toHaveLength(1)
    expect(installs[0]).toMatchObject({
      listingId: LISTING,
      version: VERSION,
      trust: 'realm',
    })
  })

  it('stops the moment staff hide the listing, and resumes on restore', async () => {
    await listingRef().set({ hiddenAt: new Date() }, { merge: true })
    expect(await getRealmPluginInstalls({ orgId: ORG })).toEqual([])

    // Restore has to work too. A takedown nobody can undo is a different
    // kind of outage, and it is the half that never gets exercised.
    await listingRef().set(
      { hiddenAt: firebaseAdmin.firestore.FieldValue.delete() },
      { merge: true },
    )
    expect(await getRealmPluginInstalls({ orgId: ORG })).toHaveLength(1)
  })

  it('stops for a host-tier install too, not just the org pin', async () => {
    // A takedown that only reached org-scoped installs would leave every
    // site-scoped one running, which is most of them.
    await db().collection('orgs').doc(ORG).collection('installs').doc(LISTING).delete()
    await db()
      .collection('hosts')
      .doc(HOST)
      .collection('installs')
      .doc(LISTING)
      .set({ version: VERSION })
    expect(await getRealmPluginInstalls({ hostId: HOST })).toHaveLength(1)

    await listingRef().set({ hiddenAt: new Date() }, { merge: true })
    expect(await getRealmPluginInstalls({ hostId: HOST })).toEqual([])
  })

  it('stops on a revocation covering all versions', async () => {
    await db().collection('revocations').doc(LISTING).set({ versions: 'all' })
    expect(await getRealmPluginInstalls({ orgId: ORG })).toEqual([])
  })

  it('stops on a revocation naming this version, and not a different one', async () => {
    await db().collection('revocations').doc(LISTING).set({ versions: [VERSION] })
    expect(await getRealmPluginInstalls({ orgId: ORG })).toEqual([])

    // The negative control for the version list: a revocation aimed
    // elsewhere must not take this one down. Without it, "versions" could be
    // ignored entirely and every assertion above would still pass.
    await db().collection('revocations').doc(LISTING).set({ versions: ['9.9.9'] })
    expect(await getRealmPluginInstalls({ orgId: ORG })).toHaveLength(1)
  })

  it('keeps running when a publisher merely UNPUBLISHES', async () => {
    // The documented distinction, and the one most likely to be "simplified"
    // away: `deletedAt` blocks new installs, it does not break the sites
    // already paying for it. Only staff takedown stops execution.
    await listingRef().set({ deletedAt: new Date() }, { merge: true })
    expect(await getRealmPluginInstalls({ orgId: ORG })).toHaveLength(1)
  })

  it('is enforced in resolveMarketplacePluginVersion, where every path funnels', async () => {
    // The console join, the site join and both bundle loaders all go through
    // this one function. Asserting the gate here is what makes the other
    // callers safe without testing each.
    expect(await resolveMarketplacePluginVersion(LISTING, VERSION)).toMatchObject({
      trust: 'realm',
    })
    await listingRef().set({ hiddenAt: new Date() }, { merge: true })
    expect(await resolveMarketplacePluginVersion(LISTING, VERSION)).toBeNull()
  })

  it('survives a hard-deleted listing doc, because installs outlive it', async () => {
    // Firestore does not cascade to subcollections, so a deleted listing
    // leaves a live version doc. Treating the missing parent as a takedown
    // would silently kill working installs.
    await listingRef().delete()
    expect(await getRealmPluginInstalls({ orgId: ORG })).toHaveLength(1)
  })

  it('respects the switchboard without needing a takedown at all', async () => {
    // `enabledPlugins` is a different mechanism with the same visible effect.
    // Worth pinning beside the kill switch so nobody "fixes" a disabled
    // plugin by revoking it.
    await db().collection('orgs').doc(ORG).set({ enabledPlugins: [] }, { merge: true })
    expect(await getRealmPluginInstalls({ orgId: ORG })).toEqual([])
    await db()
      .collection('orgs')
      .doc(ORG)
      .set({ enabledPlugins: [LISTING] }, { merge: true })
    expect(await getRealmPluginInstalls({ orgId: ORG })).toHaveLength(1)
  })
})

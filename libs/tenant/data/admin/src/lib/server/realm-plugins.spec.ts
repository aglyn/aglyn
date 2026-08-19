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
 * The staff-takedown gate (AGL-948). `resolveMarketplacePluginVersion` is the
 * chokepoint every remote plugin path funnels through — both realm joins
 * and both apps' remote-server loaders — so a regression here silently
 * un-kills a plugin that was pulled for abuse. Worth a test that reads the
 * rule back rather than trusting the comment.
 */

const listings = new Map<string, Record<string, unknown>>()
const versions = new Map<string, Record<string, unknown>>()
/** `revocations/{listingId}` — the kill switch (AGL-2307). */
const revocations = new Map<string, Record<string, unknown>>()

const snapshot = (data: Record<string, unknown> | undefined) => ({
  exists: Boolean(data),
  data: () => data,
  get: (field: string) => data?.[field],
})

jest.mock('./firebase-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (name: string) => ({
          doc: (listingId: string) => ({
            get: async () =>
              snapshot(
                name === 'marketplaceListings'
                  ? listings.get(listingId)
                  : name === 'revocations'
                    ? revocations.get(listingId)
                    : undefined,
              ),
            collection: () => ({
              doc: (version: string) => ({
                get: async () => snapshot(versions.get(`${listingId}/${version}`)),
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { resolveMarketplacePluginVersion } from './realm-plugins'

const SHA = 'a'.repeat(64)

beforeEach(() => {
  listings.clear()
  versions.clear()
  revocations.clear()
  versions.set('listing1/1.0.0', {
    sha256: SHA,
    signature: 'sig',
    trust: 'realm',
    manifest: { hostAbi: 2 },
  })
})

describe('resolveMarketplacePluginVersion — takedown gate', () => {
  it('resolves a version on a listed plugin', async () => {
    listings.set('listing1', { displayName: 'Plugin' })
    await expect(resolveMarketplacePluginVersion('listing1', '1.0.0')).resolves.toEqual(
      { sha256: SHA, signature: 'sig', trust: 'realm', hostAbi: 2 },
    )
  })

  it('refuses a listing under staff takedown', async () => {
    listings.set('listing1', { displayName: 'Plugin', hiddenAt: new Date() })
    await expect(
      resolveMarketplacePluginVersion('listing1', '1.0.0'),
    ).resolves.toBeNull()
  })

  it('keeps resolving an unpublished listing — installs are grandfathered', async () => {
    // `deletedAt` blocks NEW installs only; a publisher retiring a listing
    // must not break the sites already paying for it.
    listings.set('listing1', { displayName: 'Plugin', deletedAt: new Date() })
    await expect(
      resolveMarketplacePluginVersion('listing1', '1.0.0'),
    ).resolves.toMatchObject({ sha256: SHA })
  })

  it('keeps resolving when the listing doc is gone', async () => {
    // Firestore does not cascade to subcollections, so a hard-deleted
    // listing leaves working installs on an orphaned version doc.
    await expect(
      resolveMarketplacePluginVersion('listing1', '1.0.0'),
    ).resolves.toMatchObject({ sha256: SHA })
  })

  it('returns null for an unknown version', async () => {
    listings.set('listing1', { displayName: 'Plugin' })
    await expect(
      resolveMarketplacePluginVersion('listing1', '9.9.9'),
    ).resolves.toBeNull()
  })
})

/**
 * The kill switch, at the chokepoint (AGL-2307).
 *
 * It used to be applied one level up, in `resolveRealmPluginInstalls` — the
 * path the tenant render and the console gate take. `loadRemoteServerBundles`
 * resolves through THIS function and never reaches that join, so a
 * per-version revocation left a realm server handler running. `hiddenAt`
 * caught a full takedown, but a targeted revocation deliberately does not hide
 * the listing, which is the entire difference between the two controls.
 */
describe('resolveMarketplacePluginVersion — kill switch (AGL-2307)', () => {
  beforeEach(() => {
    listings.set('listing1', { reviewStatus: 'listed' })
  })

  it('resolves when nothing is revoked — the control', async () => {
    expect(
      await resolveMarketplacePluginVersion('listing1', '1.0.0'),
    ).toMatchObject({ trust: 'realm' })
  })

  it('refuses a version named in the revocation', async () => {
    revocations.set('listing1', { versions: ['1.0.0'] })
    expect(await resolveMarketplacePluginVersion('listing1', '1.0.0')).toBeNull()
  })

  it('refuses every version under a listing-wide kill', async () => {
    revocations.set('listing1', { versions: 'all', source: 'takedown' })
    expect(await resolveMarketplacePluginVersion('listing1', '1.0.0')).toBeNull()
  })

  it('leaves a DIFFERENT version alone — the control that keeps it targeted', async () => {
    // A per-version revocation exists precisely so a reviewer can stop one
    // build without de-listing; refusing every version would make it a
    // takedown by another name.
    versions.set('listing1/2.0.0', {
      sha256: 'b'.repeat(64),
      signature: 'sig',
      trust: 'realm',
      manifest: { hostAbi: 2 },
    })
    revocations.set('listing1', { versions: ['1.0.0'] })
    expect(
      await resolveMarketplacePluginVersion('listing1', '2.0.0'),
    ).toMatchObject({ trust: 'realm' })
  })
})

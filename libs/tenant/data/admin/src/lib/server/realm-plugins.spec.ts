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
 * The staff-takedown gate (AGL-948). `resolveCommunityPluginVersion` is the
 * chokepoint every remote plugin path funnels through — both realm joins
 * and both apps' remote-server loaders — so a regression here silently
 * un-kills a plugin that was pulled for abuse. Worth a test that reads the
 * rule back rather than trusting the comment.
 */

const listings = new Map<string, Record<string, unknown>>()
const versions = new Map<string, Record<string, unknown>>()

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
              snapshot(name === 'communityListings' ? listings.get(listingId) : undefined),
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

import { resolveCommunityPluginVersion } from './realm-plugins'

const SHA = 'a'.repeat(64)

beforeEach(() => {
  listings.clear()
  versions.clear()
  versions.set('listing1/1.0.0', {
    sha256: SHA,
    signature: 'sig',
    trust: 'realm',
    manifest: { hostAbi: 2 },
  })
})

describe('resolveCommunityPluginVersion — takedown gate', () => {
  it('resolves a version on a listed plugin', async () => {
    listings.set('listing1', { displayName: 'Plugin' })
    await expect(resolveCommunityPluginVersion('listing1', '1.0.0')).resolves.toEqual(
      { sha256: SHA, signature: 'sig', trust: 'realm', hostAbi: 2 },
    )
  })

  it('refuses a listing under staff takedown', async () => {
    listings.set('listing1', { displayName: 'Plugin', hiddenAt: new Date() })
    await expect(
      resolveCommunityPluginVersion('listing1', '1.0.0'),
    ).resolves.toBeNull()
  })

  it('keeps resolving an unpublished listing — installs are grandfathered', async () => {
    // `deletedAt` blocks NEW installs only; a publisher retiring a listing
    // must not break the sites already paying for it.
    listings.set('listing1', { displayName: 'Plugin', deletedAt: new Date() })
    await expect(
      resolveCommunityPluginVersion('listing1', '1.0.0'),
    ).resolves.toMatchObject({ sha256: SHA })
  })

  it('keeps resolving when the listing doc is gone', async () => {
    // Firestore does not cascade to subcollections, so a hard-deleted
    // listing leaves working installs on an orphaned version doc.
    await expect(
      resolveCommunityPluginVersion('listing1', '1.0.0'),
    ).resolves.toMatchObject({ sha256: SHA })
  })

  it('returns null for an unknown version', async () => {
    listings.set('listing1', { displayName: 'Plugin' })
    await expect(
      resolveCommunityPluginVersion('listing1', '9.9.9'),
    ).resolves.toBeNull()
  })
})

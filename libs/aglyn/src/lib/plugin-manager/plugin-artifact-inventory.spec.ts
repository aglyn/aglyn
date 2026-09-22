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
 * The artifact inventory refuses rather than reports an empty bucket
 * (AGL-3080).
 *
 * Every case here is the same property from a different direction: the
 * reaper deletes exactly the objects this contract does not name, from a
 * bucket with no object versioning, so the one answer that must be
 * impossible is an empty list that means "could not read".
 */

import {
  hasPluginArtifactInventory,
  pluginArtifactClaims,
  pluginArtifactVersions,
  registerPluginArtifactInventory,
  PLUGIN_ARTIFACT_INVENTORY,
} from './plugin-artifact-inventory'
import { resetPluginServicesForTests } from './plugin-services'

const LISTED = { maxScanned: 10 }

const row = () => ({
  listingId: 'listing-1',
  version: '1.0.0',
  sha256: 'a'.repeat(64),
  ownerLive: true,
})

describe('the artifact inventory', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('refuses when nothing owns the bucket', async () => {
    // ⛔ The case that matters most. Read as "nothing is claimed", an empty
    // answer here empties the bucket permanently.
    expect(hasPluginArtifactInventory()).toBe(false)
    const claims = await pluginArtifactClaims(LISTED)
    expect(claims.outcome).toBe('refused')
    expect(claims.outcome === 'refused' && claims.reason).toContain(
      'No plugin owns',
    )
    expect((await pluginArtifactVersions(LISTED)).outcome).toBe('refused')
  })

  it('refuses a source that throws, rather than passing the throw on', async () => {
    // A throw reaching the route would land in its `catch` as a 500 — which
    // is survivable — but a throw INSIDE a partial walk is the shape that
    // tempts a caller into using what it already collected.
    registerPluginArtifactInventory(
      {
        listClaims: async () => {
          throw new Error('firestore unavailable')
        },
        listVersions: async () => {
          throw new Error('firestore unavailable')
        },
      },
      { pluginId: 'test-owner' },
    )
    const claims = await pluginArtifactClaims(LISTED)
    expect(claims.outcome).toBe('refused')
    expect(claims.outcome === 'refused' && claims.reason).toContain(
      'could not be read',
    )
  })

  it('refuses a source that answers `listed` with no rows at all', async () => {
    // A bug in the source, and the one that would delete everything: a
    // listing with no `rows` array is not a bucket with nothing claimed.
    registerPluginArtifactInventory(
      {
        listClaims: async () =>
          ({ outcome: 'listed', scanned: 3 }) as unknown as Awaited<
            ReturnType<typeof pluginArtifactClaims>
          >,
        listVersions: async () => ({ outcome: 'listed', rows: [], scanned: 0 }),
      },
      { pluginId: 'test-owner' },
    )
    expect((await pluginArtifactClaims(LISTED)).outcome).toBe('refused')
  })

  it('passes a genuinely empty bucket through as an answer', async () => {
    // The distinction the whole contract exists for: a walk that finished
    // and found nothing is usable, and reaps every object in the bucket.
    registerPluginArtifactInventory(
      {
        listClaims: async () => ({ outcome: 'listed', rows: [], scanned: 0 }),
        listVersions: async () => ({ outcome: 'listed', rows: [], scanned: 0 }),
      },
      { pluginId: 'test-owner' },
    )
    const claims = await pluginArtifactClaims(LISTED)
    expect(claims.outcome).toBe('listed')
    expect(claims.outcome === 'listed' && claims.rows).toEqual([])
  })

  it('carries the source’s own refusal wording to the run', async () => {
    // The ceiling is the CALLER's threshold, so the sentence the run prints
    // has to be the one the walk wrote about hitting it.
    registerPluginArtifactInventory(
      {
        listClaims: async (options) => ({
          outcome: 'refused',
          reason: `more than ${options.maxScanned} claims`,
          scanned: options.maxScanned + 1,
        }),
        listVersions: async () => ({ outcome: 'listed', rows: [], scanned: 0 }),
      },
      { pluginId: 'test-owner' },
    )
    const claims = await pluginArtifactClaims({ maxScanned: 42 })
    expect(claims.outcome === 'refused' && claims.reason).toBe(
      'more than 42 claims',
    )
    expect(claims.scanned).toBe(43)
  })

  it('hands the rows back untouched', async () => {
    registerPluginArtifactInventory(
      {
        listClaims: async () => ({
          outcome: 'listed',
          rows: [row()],
          scanned: 1,
        }),
        listVersions: async () => ({ outcome: 'listed', rows: [], scanned: 0 }),
      },
      { pluginId: 'test-owner' },
    )
    const claims = await pluginArtifactClaims(LISTED)
    expect(claims.outcome === 'listed' && claims.rows).toEqual([row()])
  })

  it('refuses a source missing either listing', () => {
    // Registering half a source would leave one of the two jobs refusing
    // every week with nothing to point at.
    expect(() =>
      registerPluginArtifactInventory(
        { listClaims: async () => ({ outcome: 'listed', rows: [], scanned: 0 }) } as never,
        { pluginId: 'test-owner' },
      ),
    ).toThrow(/listClaims and listVersions/)
  })

  it('is a single-implementation contract', () => {
    // Two owners would each answer about their own storage, and the reaper
    // would delete what the other one claims.
    expect(PLUGIN_ARTIFACT_INVENTORY.multiple).toBe(false)
  })
})

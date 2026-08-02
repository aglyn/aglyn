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

import { recordVersionMove, versionCollectionFor } from './version-stats'

/**
 * A Firestore stand-in holding version docs in a plain map, so the counter
 * rules can be asserted without a database. It models only what
 * `recordVersionMove` uses: a transaction, `get`, `update`, and a document that
 * may not exist.
 */
function fakeFirestore(seed: Record<string, Record<string, number>>) {
  const docs = new Map<string, Record<string, number> | null>()
  for (const [id, fields] of Object.entries(seed)) docs.set(id, { ...fields })
  const collections: string[] = []
  const listingRef = {
    collection(name: string) {
      collections.push(name)
      return {
        doc: (id: string) => ({
          id,
          get exists() {
            return docs.has(id)
          },
        }),
      }
    },
  }
  const firestore = {
    async runTransaction(work: (tx: unknown) => Promise<void>) {
      const tx = {
        async get(ref: { id: string }) {
          const data = docs.get(ref.id)
          return {
            exists: data != null,
            get: (field: string) => data?.[field],
          }
        },
        update(ref: { id: string }, patch: Record<string, number>) {
          docs.set(ref.id, { ...(docs.get(ref.id) ?? {}), ...patch })
        },
      }
      await work(tx)
    },
  }
  return { firestore, listingRef, docs, collections }
}

const move = (
  seed: Record<string, Record<string, number>>,
  from: string | null,
  to: string | null,
  artifactType = 'component',
) => {
  const fake = fakeFirestore(seed)
  return recordVersionMove({
    firestore: fake.firestore as never,
    listingRef: fake.listingRef as never,
    artifactType,
    from,
    to,
  }).then(() => fake)
}

describe('versionCollectionFor (AGL-1036)', () => {
  it('sends plugins to pluginVersions and everything else to versions', () => {
    expect(versionCollectionFor('plugin')).toBe('pluginVersions')
    expect(versionCollectionFor('component')).toBe('versions')
    expect(versionCollectionFor(undefined)).toBe('versions')
  })
})

describe('recordVersionMove (AGL-1036)', () => {
  it('counts a first install on the version taken', async () => {
    const fake = await move({ '1': {} }, null, '1')
    expect(fake.docs.get('1')).toEqual({ activeInstalls: 1, installCount: 1 })
  })

  it('moves active from the version left to the one taken', async () => {
    const fake = await move(
      { '1': { activeInstalls: 3, installCount: 9 }, '2': { activeInstalls: 1, installCount: 1 } },
      '1',
      '2',
    )
    expect(fake.docs.get('1')).toMatchObject({ activeInstalls: 2 })
    expect(fake.docs.get('2')).toMatchObject({ activeInstalls: 2, installCount: 2 })
  })

  /** Leaving a version does not un-happen the install that once landed there. */
  it('never decrements installCount', async () => {
    const fake = await move({ '1': { activeInstalls: 2, installCount: 7 } }, '1', null)
    expect(fake.docs.get('1')).toEqual({ activeInstalls: 1, installCount: 7 })
  })

  it('clamps active at zero, so a repeat uninstall cannot go negative', async () => {
    const fake = await move({ '1': { activeInstalls: 0, installCount: 4 } }, '1', null)
    expect(fake.docs.get('1')).toEqual({ activeInstalls: 0, installCount: 4 })
  })

  it('is a no-op when the version did not change', async () => {
    const fake = await move({ '1': { activeInstalls: 5, installCount: 5 } }, '1', '1')
    expect(fake.docs.get('1')).toEqual({ activeInstalls: 5, installCount: 5 })
  })

  /**
   * Writing blind would resurrect a deleted version as a counters-only stub —
   * and in `pluginVersions` that stub reads as a version with no publish date
   * and no review state.
   */
  it('skips a version whose document is gone rather than creating one', async () => {
    const fake = await move({ '2': {} }, '1', '2')
    expect(fake.docs.has('1')).toBe(false)
    expect(fake.docs.get('2')).toEqual({ activeInstalls: 1, installCount: 1 })
  })

  it('reads plugin counters from pluginVersions', async () => {
    const fake = await move({ '1.0.0': {} }, null, '1.0.0', 'plugin')
    expect(fake.collections).toContain('pluginVersions')
  })
})

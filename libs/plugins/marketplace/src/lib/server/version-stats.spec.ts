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

import {
  reconcileInstallTallies,
  recordVersionMove,
  versionCollectionFor,
} from './version-stats'

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

/**
 * The listing page printed three different numbers for one version (AGL-1418).
 *
 * Production, `Promo Countdown` (`Tfnrb4wJzF`): the listing document said
 * `installCount 7 · activeInstalls 2`, its single `pluginVersions/1.0.0` said
 * `installCount 3 · activeInstalls 1`, and there were exactly TWO live pins —
 * both org-wide, both on 1.0.0. Two accumulators for the same two quantities,
 * neither ever checked against the other.
 */
describe('reconcileInstallTallies (AGL-1418)', () => {
  it('leaves counters alone when the two levels already agree', () => {
    // `Office Hours` (ChiOYRKDeI) in production: 1/1 both ways, one live pin.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 1, activeInstalls: 1 }],
      { installCount: 1, activeInstalls: 1 },
    )
    expect(result.installCount).toBe(1)
    expect(result.activeInstalls).toBe(1)
    expect(result.versions[0]).toMatchObject({
      installCount: 1,
      activeInstalls: 1,
    })
    expect(result.untrackedActiveInstalls).toBe(0)
  })

  it('gives a lone version the whole listing total', () => {
    // The screen in the report. With ONE version there is nowhere else an
    // install can be, so the attribution is provable rather than guessed —
    // and 2 is the number of live pins, independently confirmed.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 3, activeInstalls: 1 }],
      { installCount: 7, activeInstalls: 2 },
    )
    expect(result.versions[0]).toMatchObject({
      installCount: 7,
      activeInstalls: 2,
    })
    expect(result.installCount).toBe(7)
    expect(result.activeInstalls).toBe(2)
    expect(result.untrackedInstallCount).toBe(0)
    expect(result.untrackedActiveInstalls).toBe(0)
  })

  it('names the shortfall instead of guessing which version owns it', () => {
    // `Smoke Test Widget` (z6glT_UDAQ): listing 10/3, three versions summing
    // to 2/0. Splitting 3 across them would be invention; the header still
    // gets to say 3, and the card gets to say the split is short.
    const result = reconcileInstallTallies(
      [
        { version: '1.0.2', installCount: 2, activeInstalls: 0 },
        { version: '1.0.1', installCount: 0, activeInstalls: 0 },
        { version: '1.0.0', installCount: 0, activeInstalls: 0 },
      ],
      { installCount: 10, activeInstalls: 3 },
    )
    expect(result.activeInstalls).toBe(3)
    expect(result.untrackedActiveInstalls).toBe(3)
    expect(result.versions.map((entry) => entry.activeInstalls)).toEqual([
      0, 0, 0,
    ])
    expect(result.untrackedInstallCount).toBe(8)
  })

  it('takes the version sum when the LISTING is the one that is behind', () => {
    // `Northwind Coffee theme` (ZiQtiF63yl): listing activeInstalls 0 over a
    // version claiming 1. The copied-artifact install routes never increment
    // the listing-level active count at all, so the listing is not the
    // authority — both levels only ever fail downwards.
    const result = reconcileInstallTallies(
      [{ version: 'v1', installCount: 1, activeInstalls: 1 }],
      { installCount: 1, activeInstalls: 0 },
    )
    expect(result.activeInstalls).toBe(1)
    expect(result.versions[0].activeInstalls).toBe(1)
    expect(result.untrackedActiveInstalls).toBe(0)
  })

  it('never reports more live than ever landed', () => {
    // Every writer moves the pair together, so "more active than all-time" is
    // unrepresentable in a healthy database — printing it would advertise the
    // corruption rather than the count.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 1, activeInstalls: 4 }],
      { installCount: 1, activeInstalls: 4 },
    )
    expect(result.installCount).toBe(1)
    expect(result.activeInstalls).toBe(1)
    expect(result.versions[0].activeInstalls).toBe(1)
  })

  it('treats missing and negative counters as zero', () => {
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: undefined as never, activeInstalls: -3 }],
      { installCount: null, activeInstalls: undefined },
    )
    expect(result).toMatchObject({ installCount: 0, activeInstalls: 0 })
    expect(result.versions[0]).toMatchObject({
      installCount: 0,
      activeInstalls: 0,
    })
  })

  it('keeps a listing with no versions from inventing a split', () => {
    const result = reconcileInstallTallies([], { installCount: 4, activeInstalls: 2 })
    expect(result.activeInstalls).toBe(2)
    expect(result.untrackedActiveInstalls).toBe(2)
    expect(result.versions).toEqual([])
  })
})

/**
 * An org-wide install covering several sites is ONE install (AGL-1418).
 *
 * This is the shape most likely to be miscounted — the pin is a single
 * pointer that every site in the organization loads — and it is the shape on
 * the reported screen. The rule is not being changed here, only pinned down:
 * every write path counts the pin, not the sites it reaches, so the listing
 * total and the per-version tally must move by exactly one together.
 */
describe('an org-wide install covering multiple sites (AGL-1418)', () => {
  it('counts once at the version level however many sites it covers', async () => {
    // orgs/{org}/installs/{listing} — one document, four sites behind it.
    const fake = await move({ '1.0.0': {} }, null, '1.0.0', 'plugin')
    expect(fake.docs.get('1.0.0')).toEqual({
      activeInstalls: 1,
      installCount: 1,
    })
  })

  it('reconciles to one install, not one per site', () => {
    // The listing-level counter for the same org-wide pin. Both levels say 1,
    // so the header, the version history and the review card all say 1 — and
    // the Install card below them can list four sites without contradicting
    // any of them, because it is answering a different question.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 1, activeInstalls: 1 }],
      { installCount: 1, activeInstalls: 1 },
    )
    expect(result.activeInstalls).toBe(1)
    expect(result.versions[0].activeInstalls).toBe(1)
  })

  it('splitting an org pin into per-site pins counts each new pin once', async () => {
    // "Split into per-site installs" installs every site, then drops the org
    // pin. Three sites: +3 on the version, then -1 for the org pin it left.
    const seed = { '1.0.0': { activeInstalls: 1, installCount: 1 } }
    const fake = fakeFirestore(seed)
    const run = (from: string | null, to: string | null) =>
      recordVersionMove({
        firestore: fake.firestore as never,
        listingRef: fake.listingRef as never,
        artifactType: 'plugin',
        from,
        to,
      })
    await run(null, '1.0.0')
    await run(null, '1.0.0')
    await run(null, '1.0.0')
    await run('1.0.0', null)
    expect(fake.docs.get('1.0.0')).toEqual({
      activeInstalls: 3,
      installCount: 4,
    })
  })
})

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
 * The pins are the only ground truth, so they do not get reconciled (AGL-1419).
 *
 * AGL-1418 could make the page agree with itself and said so honestly: the
 * stored data was still wrong and could not be fixed by comparing two
 * accumulators, because both only ever fail downwards from a missed increment
 * — and upwards FOREVER from a pin that disappeared without one. A tenant
 * erase `recursiveDelete`s the `installs` subcollection without running a
 * single decrement.
 *
 * With a pin count in hand `activeInstalls` stops being an inference. It is
 * taken exactly, in both directions, which is the only thing that could ever
 * have brought `z6glT_UDAQ` down from the 3 it advertised to the 2 that exist.
 */
describe('reconcileInstallTallies with live pins (AGL-1419)', () => {
  it('takes the pin count exactly, including DOWNWARDS', () => {
    // `Smoke Test Widget` (z6glT_UDAQ): listing 10/3, versions summing 2/0,
    // and exactly TWO live pins — one org, one host. Under AGL-1418 this read
    // `3 active` with all three unattributable; the pins say 2, and say which
    // version they are on.
    const result = reconcileInstallTallies(
      [
        { version: '1.0.2', installCount: 2, activeInstalls: 0 },
        { version: '1.0.1', installCount: 0, activeInstalls: 0 },
        { version: '1.0.0', installCount: 0, activeInstalls: 0 },
      ],
      { installCount: 10, activeInstalls: 3 },
      { activeInstalls: 2, byVersion: { '1.0.2': 2 } },
    )
    expect(result.activeInstalls).toBe(2)
    expect(result.versions.map((entry) => entry.activeInstalls)).toEqual([2, 0, 0])
    expect(result.untrackedActiveInstalls).toBe(0)
    expect(result.activeVerified).toBe(true)
    // All-time stays an accumulator: an uninstall deletes its pin and leaves
    // nothing behind, so the pins can only establish the floor.
    expect(result.installCount).toBe(10)
    expect(result.untrackedInstallCount).toBe(8)
  })

  it('gives a lone version the verified count without a second query', () => {
    // `Promo Countdown` (Tfnrb4wJzF), and the shape most listings have. With
    // one version there is nowhere else a pin can be, so the per-version
    // aggregation is skipped and the attribution is still provable.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 3, activeInstalls: 1 }],
      { installCount: 7, activeInstalls: 2 },
      { activeInstalls: 2 },
    )
    expect(result.activeInstalls).toBe(2)
    expect(result.versions[0]).toMatchObject({ activeInstalls: 2, installCount: 7 })
    expect(result.untrackedActiveInstalls).toBe(0)
  })

  it('lets a verified zero erase a count nothing else could', () => {
    // The tenant-erase shape. `recursiveDelete` sweeps `orgs/{id}/installs`
    // without decrementing anything, so both stored levels keep claiming an
    // install whose pin no longer exists. Only the pins can say otherwise.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 1, activeInstalls: 1 }],
      { installCount: 1, activeInstalls: 1 },
      { activeInstalls: 0, byVersion: {} },
    )
    expect(result.activeInstalls).toBe(0)
    expect(result.versions[0].activeInstalls).toBe(0)
    // The install still happened once. That stays true after they leave.
    expect(result.installCount).toBe(1)
  })

  it('raises all-time to the live floor, because a pin IS an install', () => {
    // The clamp flips direction with the pins. Without them active is capped
    // at all-time, because "more live than ever landed" means one of two
    // accumulators is corrupt. With them it is all-time that is behind.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 0, activeInstalls: 0 }],
      { installCount: 0, activeInstalls: 0 },
      { activeInstalls: 3, byVersion: { '1.0.0': 3 } },
    )
    expect(result.installCount).toBe(3)
    expect(result.versions[0]).toMatchObject({ installCount: 3, activeInstalls: 3 })
    expect(result.untrackedInstallCount).toBe(0)
  })

  it('never lets a stored split exceed the verified total', () => {
    // Two versions each claiming an active install, one live pin. Trimmed
    // rather than scaled: a stored count that still fits is evidence, and a
    // fabricated fraction of one is not.
    const result = reconcileInstallTallies(
      [
        { version: '2.0.0', installCount: 4, activeInstalls: 2 },
        { version: '1.0.0', installCount: 4, activeInstalls: 2 },
      ],
      { installCount: 8, activeInstalls: 4 },
      { activeInstalls: 3 },
    )
    expect(result.activeInstalls).toBe(3)
    expect(result.versions.map((entry) => entry.activeInstalls)).toEqual([2, 1])
    expect(result.untrackedActiveInstalls).toBe(0)
  })

  it('names pins sitting on a version the history does not show', () => {
    // The route reads 20 versions; a pin can be on an older one, or on a
    // version doc that was deleted. The remainder is reported rather than
    // pushed into a version that does not own it.
    const result = reconcileInstallTallies(
      [
        { version: '2.0.0', installCount: 1, activeInstalls: 1 },
        { version: '1.9.0', installCount: 1, activeInstalls: 0 },
      ],
      { installCount: 5, activeInstalls: 1 },
      { activeInstalls: 3, byVersion: { '2.0.0': 1, '1.9.0': 0 } },
    )
    expect(result.activeInstalls).toBe(3)
    expect(result.untrackedActiveInstalls).toBe(2)
  })

  it('reconciles exactly as before when there are no pins to derive from', () => {
    // Copied artifacts hold no pin, and a missing index must degrade to the
    // previous release rather than to zeros. Same inputs as the AGL-1418
    // case above, same answer.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 3, activeInstalls: 1 }],
      { installCount: 7, activeInstalls: 2 },
      null,
    )
    expect(result).toMatchObject({
      installCount: 7,
      activeInstalls: 2,
      activeVerified: false,
    })
    expect(result.versions[0]).toMatchObject({ installCount: 7, activeInstalls: 2 })
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

  /**
   * The same two shapes counted from the pins instead (AGL-1419).
   *
   * This is where "one pin is one install" has to hold, because the pin count
   * now decides the number rather than merely agreeing with it. Counting the
   * SITES an org-wide pin reaches would quadruple this listing's installs, and
   * it is a pricing decision, not a bug fix.
   */
  it('counts an org-wide pin once however many sites load it', () => {
    // `orgs/{org}/installs/{listing}` — ONE document, four sites behind it.
    // `collectionGroup('installs')` matches the one document, so the count is
    // 1, and the Install card can still list four sites without contradicting
    // it: that card answers a different question.
    const result = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 1, activeInstalls: 1 }],
      { installCount: 1, activeInstalls: 1 },
      { activeInstalls: 1, byVersion: { '1.0.0': 1 } },
    )
    expect(result.activeInstalls).toBe(1)
    expect(result.versions[0].activeInstalls).toBe(1)
  })

  it('follows the split into per-site installs from one pin to three', () => {
    // "Split into per-site installs" installs every site and then drops the
    // org pin, so the pins go 1 → 4 → 3 while the accumulator goes 1 → 4 → 4.
    // The derived count follows the pins; all-time keeps the 4 that landed.
    const before = reconcileInstallTallies(
      [{ version: '1.0.0', installCount: 1, activeInstalls: 1 }],
      { installCount: 1, activeInstalls: 1 },
      { activeInstalls: 1, byVersion: { '1.0.0': 1 } },
    )
    expect(before.activeInstalls).toBe(1)
    const after = reconcileInstallTallies(
      // What `recordVersionMove` left behind: +3 host pins, -1 org pin.
      [{ version: '1.0.0', installCount: 4, activeInstalls: 3 }],
      { installCount: 4, activeInstalls: 4 },
      { activeInstalls: 3, byVersion: { '1.0.0': 3 } },
    )
    // Three site pins, not four and not one. The listing-level accumulator
    // says 4 because the uninstall of the org pin never decremented it — the
    // exact drift the pins exist to correct.
    expect(after.activeInstalls).toBe(3)
    expect(after.versions[0].activeInstalls).toBe(3)
    expect(after.installCount).toBe(4)
    expect(after.untrackedActiveInstalls).toBe(0)
  })
})

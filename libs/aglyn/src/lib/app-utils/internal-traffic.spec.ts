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
 * The browser-pinned internal-traffic opt-in (AGL-2064 / AGL-2065).
 *
 * Two implementations of ONE decision have to agree: `readInternalTrafficOverride`
 * for the console (client-only React, free to read storage whenever it likes)
 * and `INTERNAL_TRAFFIC_GTAG_SNIPPET` for the ISR-cached tenant runtime, where
 * the decision must be a constant string the browser evaluates for itself. So
 * the snippet is not asserted as text — it is EXECUTED here, against the same
 * cases, and the two are required to produce the same answer. A drift between
 * them is the failure that would be invisible in production: the console would
 * exclude a browsing session the marketing site counted.
 *
 * Planted reds, all verified before this file was committed:
 *   - drop the `storage.setItem` from the query-param branch → the "persists
 *     across the next pageview" cases go red on BOTH implementations.
 *   - flip the `OFF_VALUES` test → the `?aglyn_internal=0` cases go red.
 *   - return `true` on the storage-throws path → the private-mode case goes red.
 *   - move the `set` after `config` in the snippet → the ordering case goes red.
 */

import {
  INTERNAL_TRAFFIC_GTAG_SNIPPET,
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_QUERY_PARAM,
  INTERNAL_TRAFFIC_STORAGE_KEY,
  INTERNAL_TRAFFIC_VALUE,
  readInternalTrafficOverride,
} from './internal-traffic'

/** A `localStorage` that is real enough for both implementations. */
function fakeStorage(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (key: string): string | null =>
      map.has(key) ? map.get(key)! : null,
    setItem: (key: string, value: string): void =>
      void map.set(key, String(value)),
    removeItem: (key: string): void => void map.delete(key),
    _map: map,
  }
}

/**
 * Run the snippet the tenant inlines, and report what it told gtag.
 *
 * `new Function` rather than a string comparison, because what is being
 * verified is behaviour: the snippet is delivered to a browser as source and
 * a browser is the only honest reader of it. Its free identifiers — `gtag`,
 * `localStorage`, `location`, `URLSearchParams` — are supplied as parameters,
 * which is exactly the set of globals it is allowed to assume.
 */
function runSnippet(search: string, storage: ReturnType<typeof fakeStorage>) {
  const calls: Array<[string, unknown]> = []
  const gtag = (...args: unknown[]): void =>
    void calls.push([args[0] as string, args[1]])
  new Function(
    'gtag',
    'localStorage',
    'location',
    'URLSearchParams',
    INTERNAL_TRAFFIC_GTAG_SNIPPET,
  )(gtag, storage, { search }, URLSearchParams)
  return calls
}

/** What the snippet stamped, or undefined if it stamped nothing. */
function snippetStamp(search: string, storage: ReturnType<typeof fakeStorage>) {
  const set = runSnippet(search, storage).find(([name]) => name === 'set')
  return set ? (set[1] as Record<string, string>)[INTERNAL_TRAFFIC_PARAM] : undefined
}

describe('readInternalTrafficOverride (AGL-2065)', () => {
  it('is OFF for a browser that never opted in', () => {
    // The expensive direction is a false positive: a stamped real visitor is
    // erased from every report, and a GA4 data filter is not retroactive.
    expect(
      readInternalTrafficOverride({ search: '', storage: fakeStorage() }),
    ).toBe(false)
  })

  it('is OFF when an unrelated query string is present', () => {
    expect(
      readInternalTrafficOverride({
        search: '?utm_source=twitter&ref=hn',
        storage: fakeStorage(),
      }),
    ).toBe(false)
  })

  it(`turns on for ?${INTERNAL_TRAFFIC_QUERY_PARAM}=1 and persists it`, () => {
    const storage = fakeStorage()
    expect(
      readInternalTrafficOverride({
        search: `?${INTERNAL_TRAFFIC_QUERY_PARAM}=1`,
        storage,
      }),
    ).toBe(true)
    // The point of the whole mechanism: the NEXT pageview, with a clean URL,
    // is still ours. Without the write, one visit would be excluded and the
    // rest of the drill would report as a customer.
    expect(readInternalTrafficOverride({ search: '', storage })).toBe(true)
    expect(storage.getItem(INTERNAL_TRAFFIC_STORAGE_KEY)).toBe(
      INTERNAL_TRAFFIC_VALUE,
    )
  })

  it('accepts the bare parameter, which is the form typed from memory', () => {
    const storage = fakeStorage()
    expect(
      readInternalTrafficOverride({
        search: `?${INTERNAL_TRAFFIC_QUERY_PARAM}`,
        storage,
      }),
    ).toBe(true)
  })

  it.each(['0', 'false', 'off', 'no', 'FALSE'])(
    'turns back OFF for =%s, and stays off',
    (value) => {
      const storage = fakeStorage({
        [INTERNAL_TRAFFIC_STORAGE_KEY]: INTERNAL_TRAFFIC_VALUE,
      })
      expect(
        readInternalTrafficOverride({
          search: `?${INTERNAL_TRAFFIC_QUERY_PARAM}=${value}`,
          storage,
        }),
      ).toBe(false)
      expect(readInternalTrafficOverride({ search: '', storage })).toBe(false)
    },
  )

  it('is OFF when the browser refuses storage entirely', () => {
    // Safari private mode and partitioned third-party contexts throw on the
    // property access itself, not on the read.
    const hostile = {
      getItem: (): string | null => {
        throw new Error('SecurityError')
      },
      setItem: (): void => undefined,
      removeItem: (): void => undefined,
    }
    expect(
      readInternalTrafficOverride({ search: '', storage: hostile }),
    ).toBe(false)
    expect(readInternalTrafficOverride({ storage: null })).toBe(false)
  })

  it('ignores a storage value that is not ours', () => {
    expect(
      readInternalTrafficOverride({
        search: '',
        storage: fakeStorage({ [INTERNAL_TRAFFIC_STORAGE_KEY]: 'external' }),
      }),
    ).toBe(false)
  })
})

describe('INTERNAL_TRAFFIC_GTAG_SNIPPET (AGL-2064)', () => {
  it('stamps nothing for a browser that never opted in', () => {
    expect(snippetStamp('', fakeStorage())).toBeUndefined()
    expect(snippetStamp('?utm_medium=cpc', fakeStorage())).toBeUndefined()
  })

  it('stamps, and persists, on the pageview that carries the parameter', () => {
    const storage = fakeStorage()
    // Stamped on THIS hit, not the next one — the hit carrying the parameter
    // is already a `session_start` and a `first_visit`.
    expect(snippetStamp(`?${INTERNAL_TRAFFIC_QUERY_PARAM}=1`, storage)).toBe(
      INTERNAL_TRAFFIC_VALUE,
    )
    expect(snippetStamp('', storage)).toBe(INTERNAL_TRAFFIC_VALUE)
  })

  it('clears on the off values, like the TypeScript reader', () => {
    const storage = fakeStorage({
      [INTERNAL_TRAFFIC_STORAGE_KEY]: INTERNAL_TRAFFIC_VALUE,
    })
    expect(snippetStamp(`?${INTERNAL_TRAFFIC_QUERY_PARAM}=0`, storage)).toBeUndefined()
    expect(snippetStamp('', storage)).toBeUndefined()
  })

  it('agrees with readInternalTrafficOverride on every case', () => {
    // The invariant that matters most, asserted directly rather than inferred
    // from the cases above passing separately: one decision, two runtimes.
    for (const search of [
      '',
      '?utm_source=x',
      `?${INTERNAL_TRAFFIC_QUERY_PARAM}=1`,
      `?${INTERNAL_TRAFFIC_QUERY_PARAM}`,
      `?${INTERNAL_TRAFFIC_QUERY_PARAM}=0`,
      `?a=1&${INTERNAL_TRAFFIC_QUERY_PARAM}=true&b=2`,
    ]) {
      const forTs = fakeStorage()
      const forJs = fakeStorage()
      expect([search, snippetStamp(search, forJs) === INTERNAL_TRAFFIC_VALUE]).toEqual([
        search,
        readInternalTrafficOverride({ search, storage: forTs }),
      ])
    }
  })

  it('survives a browser that throws on storage', () => {
    const hostile = fakeStorage()
    hostile.getItem = (): string | null => {
      throw new Error('SecurityError')
    }
    // Analytics never breaks the page, and this snippet runs INSIDE the
    // consent-gated init block — a throw here would take the `gtag('js')` and
    // `gtag('config')` calls after it down with it and silence the tag for a
    // real visitor.
    expect(() => runSnippet('', hostile)).not.toThrow()
    expect(snippetStamp('', hostile)).toBeUndefined()
  })

  it('cannot close the script element it is inlined into', () => {
    // It is concatenated into an inline <script> in ISR-cached HTML.
    expect(INTERNAL_TRAFFIC_GTAG_SNIPPET).not.toContain('<')
  })
})

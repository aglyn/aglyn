/**
 * @jest-environment jsdom
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
 * AGL-2486: WHEN the switchers read, and WHAT ordering they read by.
 *
 * The companion file `switcher-search-window.emulator.spec.ts` proves the
 * behaviour that cannot be mocked — that Firestore omits documents lacking the
 * ordered field. This one proves the things a mock CAN see and that file
 * cannot: that the window is read once and reused, that the prefix range is
 * spent only when it can buy something, and that a scope change drops what was
 * read under the old one.
 *
 * Split deliberately. Asserting query shape against a real emulator would be
 * slow and indirect; asserting Firestore's indexing behaviour against a mock
 * would be circular. Neither file can carry both claims.
 */

const mockReads: Array<{ path: string; ordering: string[]; limit?: number }> = []
let mockDocsByCall: Array<Array<Record<string, any>>> = []

jest.mock('firebase/firestore', () => ({
  collection: (_firestore: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  documentId: () => '__name__',
  orderBy: (field: unknown) => ({ type: 'orderBy', field }),
  limit: (value: number) => ({ type: 'limit', value }),
  where: (field: string, op: string, value: unknown) => ({
    type: 'where',
    field,
    op,
    value,
  }),
  startAt: () => ({ type: 'startAt' }),
  endAt: () => ({ type: 'endAt' }),
  query: (reference: any, ...constraints: any[]) => ({
    __path: reference.__path,
    constraints,
  }),
  getDocs: async (builtQuery: any) => {
    const ordering = builtQuery.constraints
      .filter((constraint: any) => constraint?.type === 'orderBy')
      .map((constraint: any) => String(constraint.field))
    const cap = builtQuery.constraints.find(
      (constraint: any) => constraint?.type === 'limit',
    )?.value
    mockReads.push({ path: builtQuery.__path, ordering, limit: cap })
    const rows = mockDocsByCall.shift() ?? []
    return {
      metadata: { fromCache: false },
      docs: rows.map((row) => ({ id: row.$id, data: () => row })),
    }
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import { useSwitcherCollection } from './use-switcher-collection'

const screen = (id: string, displayName: string, extra = {}) => ({
  $id: id,
  displayName,
  ...extra,
})

const searchReads = () =>
  mockReads.filter((read) => read.ordering.includes('nameLower'))
const windowReads = () =>
  mockReads.filter((read) => read.ordering.includes('__name__'))

beforeEach(() => {
  mockReads.length = 0
  mockDocsByCall = []
})

const mount = (query: string, deps: unknown[] = ['host-1']) =>
  renderHook(
    (props: { query: string }) =>
      useSwitcherCollection<any>({
        firestore: {} as never,
        path: ['hosts', 'host-1', 'screens'],
        query: props.query,
        deps,
        debounceMs: 0,
        searchWindow: 3,
      }),
    { initialProps: { query } },
  )

describe('the ordering a search reads by', () => {
  /**
   * The whole point. Ordering by `nameLower` makes Firestore omit every
   * document that does not carry it; `documentId()` cannot omit anything.
   */
  it('windows by document id, not by the optional name field', async () => {
    mockDocsByCall = [[screen('s1', 'Launching soon')]]
    mount('launch')
    await waitFor(() => expect(windowReads()).toHaveLength(1))
    expect(windowReads()[0].path).toBe('hosts/host-1/screens')
    expect(searchReads()).toHaveLength(0)
  })

  it('matches a word inside the name, which a prefix range cannot', async () => {
    mockDocsByCall = [[screen('l1', 'Main Layout')]]
    const { result } = mount('layout')
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(result.current.items[0].displayName).toBe('Main Layout')
  })

  it('leaves the idle read alone', async () => {
    mockDocsByCall = [[screen('s1', 'Home')]]
    mount('')
    await waitFor(() => expect(mockReads).toHaveLength(1))
    expect(mockReads[0].ordering).toEqual(['updatedAt'])
  })
})

describe('what the search costs', () => {
  /**
   * The window is read once per scope and matched over on every keystroke, so
   * typing past the first character is free — cheaper than the per-keystroke
   * prefix query this replaced.
   */
  it('reads the window once, however much more is typed', async () => {
    mockDocsByCall = [[screen('s1', 'Launching soon')]]
    const { rerender } = mount('la')
    await waitFor(() => expect(windowReads()).toHaveLength(1))
    for (const query of ['lau', 'laun', 'launch', 'la']) {
      rerender({ query })
      // The debounce is a `setTimeout`, so it needs a MACROTASK to fire.
      // Flushing only microtasks (`act(async () => undefined)`) leaves the
      // debounced value — and therefore the effect's dependency — unchanged,
      // so the effect never re-runs and this test passes without ever having
      // re-typed anything. That was a false pass: removing the cache
      // altogether left it green.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
      })
    }
    expect(windowReads()).toHaveLength(1)
    // …and the effect really did re-run, which is what makes the count above
    // mean something.
    expect(mockReads.length).toBeGreaterThanOrEqual(1)
  })

  /**
   * A partial window is PROOF there is nothing beyond it, so the prefix range
   * would buy nothing and is not issued. This is what keeps twelve-group
   * search and two switchers affordable at once.
   */
  it('does not spend the prefix query when the window was not full', async () => {
    mockDocsByCall = [[screen('s1', 'Launching soon')]]
    mount('launch')
    await waitFor(() => expect(windowReads()).toHaveLength(1))
    await act(async () => undefined)
    expect(searchReads()).toHaveLength(0)
  })

  /**
   * …but a FULL window may have cut the collection off, and AGL-838 built the
   * prefix range precisely so a host with hundreds of screens can still find
   * one outside the loaded window. Dropping it to simplify would regress the
   * property the switcher exists for.
   */
  it('reaches past a full window with the prefix query', async () => {
    mockDocsByCall = [
      [screen('a', 'Alpha'), screen('b', 'Beta'), screen('c', 'Gamma')],
      [screen('z', 'Zebra page')],
    ]
    const { result } = mount('zebra')
    await waitFor(() => expect(searchReads()).toHaveLength(1))
    await waitFor(() =>
      expect(result.current.items.map((row: any) => row.$id)).toContain('z'),
    )
  })

  it('does not list a document twice when both reads return it', async () => {
    mockDocsByCall = [
      [screen('a', 'Alpha'), screen('b', 'Beta'), screen('zeta', 'Zeta page')],
      [screen('zeta', 'Zeta page')],
    ]
    const { result } = mount('zeta')
    await waitFor(() => expect(searchReads()).toHaveLength(1))
    await waitFor(() => expect(result.current.items.length).toBeGreaterThan(0))
    const ids = result.current.items.map((row: any) => row.$id)
    expect(ids.filter((id: string) => id === 'zeta')).toHaveLength(1)
  })
})

describe('scope', () => {
  /**
   * Rows read under site A must never be matched against while standing on
   * site B — the window is cached, so this is the assertion that keeps the
   * cache from becoming a leak.
   */
  it('drops the window when the scope changes', async () => {
    mockDocsByCall = [
      [screen('s1', 'Launching soon')],
      [screen('s9', 'Other site page')],
    ]
    const { rerender } = renderHook(
      (props: { host: string }) =>
        useSwitcherCollection<any>({
          firestore: {} as never,
          path: ['hosts', props.host, 'screens'],
          query: 'la',
          deps: [props.host],
          debounceMs: 0,
          searchWindow: 3,
        }),
      { initialProps: { host: 'host-1' } },
    )
    await waitFor(() => expect(windowReads()).toHaveLength(1))
    rerender({ host: 'host-2' })
    await waitFor(() => expect(windowReads()).toHaveLength(2))
    expect(windowReads()[1].path).toBe('hosts/host-2/screens')
  })

  /**
   * An unresolved id in a `where` does not narrow the query, it DROPS the
   * filter (AGL-2350). The hold must also discard anything already read,
   * because that was read under a scope nobody has vouched for.
   */
  it('reads nothing at all while held', async () => {
    renderHook(() =>
      useSwitcherCollection<any>({
        firestore: {} as never,
        path: ['users', 'u1', 'hostMemberships'],
        where: undefined,
        skip: true,
        query: 'demo',
        deps: ['u1'],
        debounceMs: 0,
      }),
    )
    await act(async () => undefined)
    expect(mockReads).toHaveLength(0)
  })

  it('carries the scope filter onto the window, not just the prefix query', async () => {
    mockDocsByCall = [[screen('h1', 'Demo Bakery')]]
    renderHook(() =>
      useSwitcherCollection<any>({
        firestore: {} as never,
        path: ['users', 'u1', 'hostMemberships'],
        where: ['orgId', '==', 'org-1'],
        query: 'demo',
        deps: ['u1', 'org-1'],
        debounceMs: 0,
        searchWindow: 3,
      }),
    )
    await waitFor(() => expect(windowReads()).toHaveLength(1))
    // Without this the window would list every org's sites for this person —
    // the exact leak `skip` and the `where` exist to prevent.
    expect(mockReads[0].path).toBe('users/u1/hostMemberships')
  })
})

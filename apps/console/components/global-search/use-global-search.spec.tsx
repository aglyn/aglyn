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
 * AGL-2486: what console search COSTS, and what it refuses to read.
 *
 * Zach asked for search across roughly a dozen collections and in the same
 * breath asked that it not cost too many reads. Those only pull against each
 * other if the reads are per keystroke, so the assertions here are about
 * WHEN a read is issued rather than about the rows that come back — that is
 * the property a later edit can quietly destroy while every rendering test
 * stays green.
 */

/** Every `getDocs` call, with the collection path and constraints it carried. */
const mockReads: Array<{ path: string; constraints: any[] }> = []
/** Paths that should reject rather than resolve, keyed by collection name. */
const mockFailing = new Set<string>()
/** Rows returned per collection name. */
let mockRowsByCollection: Record<string, Array<Record<string, any>>> = {}

jest.mock('firebase/firestore', () => ({
  collection: (_firestore: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  documentId: () => ({ __fieldPath: '__name__' }),
  orderBy: (field: unknown) => ({ type: 'orderBy', field }),
  limit: (value: number) => ({ type: 'limit', value }),
  where: (field: string, op: string, value: unknown) => ({
    type: 'where',
    field,
    op,
    value,
  }),
  query: (reference: any, ...constraints: any[]) => ({
    __path: reference.__path,
    constraints,
  }),
  getDocs: async (builtQuery: any) => {
    mockReads.push({ path: builtQuery.__path, constraints: builtQuery.constraints })
    const name = String(builtQuery.__path).split('/').pop() as string
    if (mockFailing.has(name)) throw Object.assign(new Error('denied'), {
      code: 'permission-denied',
    })
    const rows = mockRowsByCollection[name] ?? []
    return {
      docs: rows.map((row) => ({ id: row.$id, data: () => row })),
    }
  },
}))

import { act, renderHook, waitFor } from '@testing-library/react'
import useGlobalSearch, {
  MAX_ROWS_PER_GROUP,
  rowBelongsTo,
  SEARCH_WINDOW,
} from './use-global-search'
import {
  GLOBAL_SEARCH_ENTITIES,
  type GlobalSearchEntityDef,
} from './global-search-scope'

const entity = (id: string) =>
  GLOBAL_SEARCH_ENTITIES.find((definition) => definition.id === id) as
    GlobalSearchEntityDef

const base = {
  firestore: {} as any,
  uid: 'user-1',
  orgId: 'org-1',
  hostId: 'host-1',
}

const readsFor = (collectionName: string) =>
  mockReads.filter((read) => read.path.endsWith(`/${collectionName}`))

beforeEach(() => {
  mockReads.length = 0
  mockFailing.clear()
  mockRowsByCollection = {
    screens: [
      { $id: 's1', displayName: 'Home' },
      { $id: 's2', displayName: 'Main Layout demo' },
      { $id: 's3', displayName: 'Welcome email', kind: 'email' },
      { $id: 's4', displayName: 'Deleted home', deletedAt: 1 },
    ],
    layouts: [{ $id: 'l1', displayName: 'Main Layout' }],
    hostMemberships: [
      { $id: 'h1', displayName: 'Demo Bakery', subdomain: 'demo' },
    ],
  }
})

describe('when a read is issued at all', () => {
  /**
   * The single cheapest control in the feature. The palette is reachable from
   * the top bar of every console page; the previous implementation spent a
   * read per group merely to be OPENED, to populate a recently-updated list
   * nobody had asked for.
   */
  it('reads NOTHING for a query below the floor', async () => {
    const { rerender } = renderHook(
      (props: { text: string }) =>
        useGlobalSearch({ ...base, entities: [entity('screens')], ...props }),
      { initialProps: { text: '' } },
    )
    expect(mockReads).toHaveLength(0)
    rerender({ text: 'h' })
    await act(async () => undefined)
    expect(mockReads).toHaveLength(0)
  })

  it('reads once the query is worth reading for', async () => {
    renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('screens')], text: 'ho' }),
    )
    await waitFor(() => expect(readsFor('screens')).toHaveLength(1))
  })

  /**
   * The control that makes a dozen groups affordable: matching happens over
   * the whole window on the client, so a longer query is a different FILTER
   * over rows already held, not a different question for the database.
   */
  it('does not read again as the query grows', async () => {
    const { rerender } = renderHook(
      (props: { text: string }) =>
        useGlobalSearch({ ...base, entities: [entity('screens')], ...props }),
      { initialProps: { text: 'ho' } },
    )
    await waitFor(() => expect(readsFor('screens')).toHaveLength(1))
    for (const text of ['hom', 'home', 'home p', 'ho']) {
      rerender({ text })
      await act(async () => undefined)
    }
    expect(readsFor('screens')).toHaveLength(1)
  })

  /**
   * `screens` and `emails` are the SAME Firestore collection partitioned by
   * `kind`. Reading per entity rather than per collection would double that
   * collection's cost for no new information.
   */
  it('shares one read between two entities on the same collection', async () => {
    const { result } = renderHook(() =>
      useGlobalSearch({
        ...base,
        entities: [entity('screens'), entity('emails')],
        text: 'e',
      }),
    )
    // `e` is below the floor; widen to a query that matches in both groups.
    const { result: real } = renderHook(() =>
      useGlobalSearch({
        ...base,
        entities: [entity('screens'), entity('emails')],
        text: 'home',
      }),
    )
    await waitFor(() => expect(real.current.groups.length).toBeGreaterThan(0))
    expect(readsFor('screens')).toHaveLength(1)
    void result
  })

  it('counts a query that matched nothing as one read, not zero', async () => {
    mockRowsByCollection.screens = []
    const { result } = renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('screens')], text: 'zz' }),
    )
    await waitFor(() => expect(result.current.readCount).toBe(1))
  })
})

describe('how the reads are scoped', () => {
  /**
   * `users/{uid}/…` IS the scoping. A top-level collection query would be the
   * shape that can leak, whatever it filtered on.
   */
  it("reads sites from the caller's OWN membership projection", async () => {
    renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('sites')], text: 'demo' }),
    )
    await waitFor(() => expect(readsFor('hostMemberships')).toHaveLength(1))
    expect(readsFor('hostMemberships')[0].path).toBe(
      'users/user-1/hostMemberships',
    )
  })

  /**
   * The AGL-2350 hold. An unresolved workspace makes the `where` clause
   * `undefined`, which does not narrow the query — it DROPS the filter and
   * returns this person's site memberships across every org they belong to.
   */
  it('narrows the sites read to the open workspace', async () => {
    renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('sites')], text: 'demo' }),
    )
    await waitFor(() => expect(readsFor('hostMemberships')).toHaveLength(1))
    expect(readsFor('hostMemberships')[0].constraints).toContainEqual({
      type: 'where',
      field: 'orgId',
      op: '==',
      value: 'org-1',
    })
  })

  it('refuses the sites read outright when the workspace is unresolved', async () => {
    const { result } = renderHook(() =>
      useGlobalSearch({
        ...base,
        orgId: null,
        entities: [entity('sites')],
        text: 'demo',
      }),
    )
    await waitFor(() => expect(result.current.groups.length).toBe(1))
    // The read was attempted and REFUSED rather than issued unscoped, so the
    // group reports a failure instead of another org's sites.
    expect(result.current.groups[0].failed).toBe(true)
    expect(
      mockReads.filter((read) => read.constraints.some((c: any) => c.type === 'where'))
        .length,
    ).toBe(0)
  })

  it('holds a host read while the host id is still empty', async () => {
    renderHook(() =>
      useGlobalSearch({
        ...base,
        hostId: null,
        entities: [entity('screens')],
        text: 'home',
      }),
    )
    await act(async () => undefined)
    // `hosts//screens` is not a collection; holding is the only safe move.
    expect(mockReads).toHaveLength(0)
  })

  /**
   * Rows from site A must never be matched against and rendered while
   * standing on site B.
   */
  /**
   * The cache KEY already carries the host, so a different site re-reads on
   * its own. The signature clear exists for the scope change the key does
   * NOT carry: the same site read by a different account. Without it, one
   * user's rows would be served to the next one signed in on that tab.
   */
  it('re-reads a host collection when the USER changes', async () => {
    const { rerender } = renderHook(
      (props: { uid: string }) =>
        useGlobalSearch({
          ...base,
          entities: [entity('screens')],
          text: 'home',
          ...props,
        }),
      { initialProps: { uid: 'user-1' } },
    )
    await waitFor(() => expect(readsFor('screens')).toHaveLength(1))
    rerender({ uid: 'user-2' })
    await waitFor(() => expect(readsFor('screens')).toHaveLength(2))
  })

  it('drops the cache when the scope changes', async () => {
    const { rerender } = renderHook(
      (props: { hostId: string }) =>
        useGlobalSearch({
          ...base,
          entities: [entity('screens')],
          text: 'home',
          ...props,
        }),
      { initialProps: { hostId: 'host-1' } },
    )
    await waitFor(() => expect(readsFor('screens')).toHaveLength(1))
    rerender({ hostId: 'host-2' })
    await waitFor(() => expect(readsFor('screens')).toHaveLength(2))
    expect(readsFor('screens')[1].path).toBe('hosts/host-2/screens')
  })
})

describe('what the mockReads return', () => {
  it('finds a name by a word inside it, which the prefix query could not', async () => {
    const { result } = renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('layouts')], text: 'layout' }),
    )
    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    expect(result.current.groups[0].rows[0].$label).toBe('Main Layout')
  })

  it('keeps email screens out of Pages and page screens out of Emails', () => {
    expect(rowBelongsTo('screens', { kind: 'email' })).toBe(false)
    expect(rowBelongsTo('emails', { kind: 'email' })).toBe(true)
    expect(rowBelongsTo('screens', { displayName: 'Home' })).toBe(true)
    expect(rowBelongsTo('emails', { displayName: 'Home' })).toBe(false)
  })

  it('drops soft-deleted rows from every group', () => {
    expect(rowBelongsTo('screens', { deletedAt: 1 })).toBe(false)
    expect(rowBelongsTo('layouts', { deletedAt: 1 })).toBe(false)
  })

  it('caps how many rows of one kind are shown', async () => {
    mockRowsByCollection.layouts = Array.from({ length: 12 }, (_, index) => ({
      $id: `l${index}`,
      displayName: `Layout ${index}`,
    }))
    const { result } = renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('layouts')], text: 'layout' }),
    )
    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    expect(result.current.groups[0].rows).toHaveLength(MAX_ROWS_PER_GROUP)
  })
})

describe('when a group cannot be read', () => {
  /**
   * The rule this exists for: a swallowed query renders as a measured zero,
   * which is worse than an error because nothing looks wrong — the reader
   * concludes they do not have the thing they are searching for and creates a
   * duplicate.
   */
  it('says it FAILED rather than reporting no matches', async () => {
    mockFailing.add('layouts')
    const { result } = renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('layouts')], text: 'layout' }),
    )
    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    expect(result.current.groups[0].failed).toBe(true)
    expect(result.current.groups[0].rows).toHaveLength(0)
  })

  it('does not let one failed group suppress a healthy one', async () => {
    mockFailing.add('layouts')
    const { result } = renderHook(() =>
      useGlobalSearch({
        ...base,
        entities: [entity('layouts'), entity('screens')],
        text: 'home',
      }),
    )
    await waitFor(() => expect(result.current.groups).toHaveLength(2))
    expect(result.current.groups.find((g) => g.definition.id === 'layouts')?.failed).toBe(true)
    expect(result.current.groups.find((g) => g.definition.id === 'screens')?.rows.length).toBeGreaterThan(0)
  })

  /** An empty SUCCESSFUL group is dropped; only a failure earns a heading. */
  it('drops a group that simply had no matches', async () => {
    const { result } = renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('layouts')], text: 'zzz' }),
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.groups).toHaveLength(0)
  })
})

describe('when the window was not big enough', () => {
  /**
   * Absence of a result is only evidence of absence if everything was looked
   * at. A group that filled its window says so, rather than letting a partial
   * set read as a complete one.
   */
  it('marks the group truncated when the window filled', async () => {
    mockRowsByCollection.layouts = Array.from({ length: SEARCH_WINDOW }, (_, i) => ({
      $id: `l${i}`,
      displayName: `Layout ${i}`,
    }))
    const { result } = renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('layouts')], text: 'layout' }),
    )
    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    expect(result.current.groups[0].truncated).toBe(true)
  })

  it('does not cry truncation when the window had room left', async () => {
    const { result } = renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('layouts')], text: 'layout' }),
    )
    await waitFor(() => expect(result.current.groups).toHaveLength(1))
    expect(result.current.groups[0].truncated).toBe(false)
  })

  it('asks Firestore for exactly the window it promises', async () => {
    renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('layouts')], text: 'layout' }),
    )
    await waitFor(() => expect(readsFor('layouts')).toHaveLength(1))
    expect(readsFor('layouts')[0].constraints).toContainEqual({
      type: 'limit',
      value: SEARCH_WINDOW,
    })
  })

  /**
   * The bug this whole rebuild exists to close: ordering by a FIELD makes
   * Firestore omit every document that lacks it, which is how a screen named
   * "Home" stayed invisible to a search for `home`. `documentId()` is present
   * on every document by construction.
   */
  it('orders by document id, which no document can be missing', async () => {
    renderHook(() =>
      useGlobalSearch({ ...base, entities: [entity('screens')], text: 'home' }),
    )
    await waitFor(() => expect(readsFor('screens')).toHaveLength(1))
    const ordering = readsFor('screens')[0].constraints.filter(
      (constraint: any) => constraint.type === 'orderBy',
    )
    expect(ordering).toHaveLength(1)
    expect(ordering[0].field).toEqual({ __fieldPath: '__name__' })
  })
})

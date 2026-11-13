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
 * Every listener hook keeps a server confirmation through a short fall back
 * to the cache (AGL-4047).
 *
 * The client's online state going Offline for a moment (a second console tab
 * handing over the shared cache, a stall recovery) puts every confirmed view
 * back on the cache. The hooks used to pass that straight on as
 * `fromCache: true`, so a card confirmed minutes earlier held its next Save
 * for the guard's whole wait and then refused it. Each hook now reports the
 * fall as still confirmed, for `SEED_CONFIRMATION_KEPT_MS`, and as
 * unconfirmed once that runs out without the server answering again.
 * `listen-confirmation.spec.ts` covers the record itself.
 */

import { act, renderHook } from '@testing-library/react'

let mockListeners: ((snapshot: unknown) => void)[] = []

jest.mock('firebase/firestore', () => ({
  onSnapshot: (_target: unknown, ...rest: unknown[]) => {
    if (typeof rest[0] !== 'function') rest.shift()
    mockListeners.push(rest[0] as (snapshot: unknown) => void)
    return jest.fn()
  },
  doc: (_db: unknown, path: string) => ({ path }),
  getDocsFromServer: jest.fn(),
  getDocFromServer: jest.fn(() => new Promise(() => undefined)),
  disableNetwork: jest.fn(() => Promise.resolve()),
  enableNetwork: jest.fn(() => Promise.resolve()),
  serverTimestamp: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
}))

jest.mock('./firestore-denial-reporter', () => ({
  DENIAL_STREAK_TO_REPORT: 3,
  denialLabelForQuery: () => 'label',
  scheduleRefusedReopen: () => () => undefined,
  reportFirestoreDenial: jest.fn(),
  reportFirestoreServerRead: jest.fn(),
  noteFirestoreServerRead: jest.fn(),
  subscribeFirestoreSessionHeal: () => jest.fn(),
}))

import { SEED_CONFIRMATION_KEPT_MS } from './helpers/listen-confirmation'
import { useDocData } from './helpers/use-doc'
import { useConfirmedDoc } from './use-confirmed-doc'
import { useFirestoreCollection } from './use-firestore-collection'
import { useFirestoreDoc } from './use-firestore-doc'

const docSnapshot = (fromCache: boolean, hasPendingWrites = false) => ({
  metadata: { fromCache, hasPendingWrites },
  exists: () => true,
  data: () => ({ title: 'Home' }),
  id: 'doc-1',
})
const querySnapshot = (fromCache: boolean, hasPendingWrites = false) => ({
  metadata: { fromCache, hasPendingWrites },
  docs: [{ id: 'doc-1', data: () => ({ title: 'Home' }) }],
  docChanges: () => [],
})

let firestore: object
/** What every listener hook returns, and all this spec reads. */
type Read = () => { fromCache: boolean }
const hooks: readonly (readonly [string, Read, typeof docSnapshot | typeof querySnapshot])[] = [
  [
    'useFirestoreDoc',
    () => useFirestoreDoc(() => ({ firestore }) as never, [firestore]),
    docSnapshot,
  ],
  [
    'useFirestoreCollection',
    () => useFirestoreCollection(() => ({ firestore }) as never, [firestore]),
    querySnapshot,
  ],
  ['useDocData', () => useDocData({ firestore } as never), docSnapshot],
  [
    'useConfirmedDoc',
    () => useConfirmedDoc(firestore as never, ['orgs', 'org-1']),
    docSnapshot,
  ],
]

describe.each(hooks)('%s keeps a confirmation through a fall back to the cache (AGL-4047)', (_name, hook, snapshot) => {
  beforeEach(() => {
    jest.useFakeTimers()
    mockListeners = []
    firestore = {}
  })
  afterEach(() => jest.useRealTimers())

  const answer = (fromCache: boolean, hasPendingWrites = false) =>
    act(() => mockListeners[mockListeners.length - 1](snapshot(fromCache, hasPendingWrites)))

  it('reads unconfirmed until the server has answered once', () => {
    const { result } = renderHook(hook)
    answer(true)
    expect(result.current.fromCache).toBe(true)
    answer(false)
    expect(result.current.fromCache).toBe(false)
  })

  it.each([
    ['a cache-only snapshot', false],
    ['a cache-only snapshot carrying a pending write', true],
  ])('stays confirmed through %s after a confirmation', (_case, hasPendingWrites) => {
    const { result } = renderHook(hook)
    answer(false)
    answer(false, true)
    answer(true, hasPendingWrites)
    expect(result.current.fromCache).toBe(false)
  })

  it('reads unconfirmed once the keep runs out, and confirmed again when the server answers', () => {
    const { result } = renderHook(hook)
    answer(false)
    answer(true)
    act(() => {
      jest.advanceTimersByTime(SEED_CONFIRMATION_KEPT_MS - 1)
    })
    expect(result.current.fromCache).toBe(false)
    act(() => {
      jest.advanceTimersByTime(1)
    })
    expect(result.current.fromCache).toBe(true)
    answer(false)
    expect(result.current.fromCache).toBe(false)
  })
})

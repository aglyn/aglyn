/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored (feedback_jest_environment_pragma_shadowed_by_license).
 *
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
 * The switcher's one-shot read reports to the session detector (AGL-2486).
 *
 * Zach's production report was a Sites list reading "Your sites could not be
 * loaded" — and the switcher that renders it fetched with `getDocs`, caught
 * the refusal, set `error` and told nobody. So the ONE read the user could
 * see failing contributed no evidence at all toward "your session is the
 * problem", which is the verdict that opens the re-auth dialog.
 *
 * Both halves matter and are asserted separately: a denial that is not a
 * session problem (a missing composite index, a dropped network) must still
 * be kept out of the count, or the fix trades a silent failure for a false
 * accusation.
 */

import { renderHook, waitFor } from '@testing-library/react'
import { setFirestoreSessionReporters } from './firestore-denial-reporter'
import {
  switcherCollectionKey,
  useSwitcherCollection,
} from './use-switcher-collection'

const mockGetDocs = jest.fn()
jest.mock('firebase/firestore', () => ({
  collection: (...path: unknown[]) => ({ path }),
  endAt: () => ({}),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  limit: () => ({}),
  orderBy: () => ({}),
  query: (ref: unknown) => ref,
  startAt: () => ({}),
  where: () => ({}),
}))

jest.mock('@aglyn/aglyn', () => ({
  nameSearchKey: (value: string) => value.toLowerCase(),
}))

const onDenied = jest.fn()
const onServerRead = jest.fn()

function mount(path: string[]) {
  return renderHook(() =>
    useSwitcherCollection({
      firestore: {} as never,
      path,
      query: '',
      deps: [path.join('/')],
      debounceMs: 0,
    }),
  )
}

describe('switcher reads feed the session detector', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    setFirestoreSessionReporters({ onDenied, onServerRead })
  })
  afterEach(() => setFirestoreSessionReporters(null))

  it('names the collection without the uid in it', () => {
    // Same key `use-org-hosts` already reports, so the two read the same
    // collection and count as one — not two, toward the threshold.
    expect(switcherCollectionKey(['users', 'UID1', 'hostMemberships'])).toBe(
      'users/hostMemberships',
    )
    expect(switcherCollectionKey(['hosts'])).toBe('hosts')
  })

  it('reports a permission-denied read', async () => {
    mockGetDocs.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    )
    mount(['users', 'UID1', 'hostMemberships'])
    await waitFor(() => expect(onDenied).toHaveBeenCalled())
    expect(onDenied).toHaveBeenCalledWith('users/hostMemberships')
  })

  it('does NOT report a missing index or a dropped network', async () => {
    for (const code of ['failed-precondition', 'unavailable']) {
      jest.clearAllMocks()
      mockGetDocs.mockRejectedValue(
        Object.assign(new Error(code), { code }),
      )
      const view = mount(['users', 'UID1', 'hostMemberships'])
      await waitFor(() => expect(view.result.current.error).toBe(true))
      expect(onDenied).not.toHaveBeenCalled()
    }
  })

  it('reports a SERVER answer, and never a cached one', async () => {
    mockGetDocs.mockResolvedValue({ docs: [], metadata: { fromCache: false } })
    mount(['users', 'UID1', 'hostMemberships'])
    await waitFor(() => expect(onServerRead).toHaveBeenCalledTimes(1))

    jest.clearAllMocks()
    mockGetDocs.mockResolvedValue({ docs: [], metadata: { fromCache: true } })
    mount(['users', 'UID2', 'hostMemberships'])
    // An offline client answers from the cache; that is not proof of
    // anything and must not clear a real session's denial evidence.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(onServerRead).not.toHaveBeenCalled()
  })

  it('a snapshot without metadata reports nothing, and is not an error', async () => {
    mockGetDocs.mockResolvedValue({ docs: [] })
    const view = mount(['users', 'UID3', 'hostMemberships'])
    await waitFor(() => expect(view.result.current.loading).toBe(false))
    // Reading the claim off a shape we did not expect must not throw into
    // the `catch` and show a refusal for a fetch that succeeded — which is
    // exactly what `!snapshot.metadata.fromCache` did to
    // `switcher-collection-refusal.spec.ts`.
    expect(view.result.current.error).toBe(false)
    expect(onServerRead).not.toHaveBeenCalled()
    expect(onDenied).not.toHaveBeenCalled()
  })
})

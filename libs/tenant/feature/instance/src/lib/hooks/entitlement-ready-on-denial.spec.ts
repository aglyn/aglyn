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
 * A refused read must not answer an entitlement question (AGL-1066).
 *
 * Both hooks here published `ready` as `status !== 'loading'`, which was
 * indistinguishable from `=== 'success'` for as long as a denied listen could
 * never reach `'error'` — the persistent cache handed the retry budget back
 * on every cycle, so it never spent. The AGL-1066 flip makes `'error'`
 * reachable, and `'error'` satisfies `!== 'loading'` while leaving `data`
 * undefined.
 *
 * That is the exact fault `useOrgPlan` was written to close (AGL-1064),
 * arriving through a different door: `Aglyn.checkQuota(undefined, …)` does
 * not mean "unknown", it resolves the FREE tier. A paying org would have been
 * rendered as Free for as long as its session stayed stale, and told its plan
 * does not include what it bought.
 *
 * Pending is the right answer to a question we could not read. `ready: false`
 * leaves the commerce cards in the state they already show while the
 * `hostIndex` lookup is in flight, which is a state they are built for.
 */

import { renderHook } from '@testing-library/react'
import { useOrgPlan } from './use-org-plan'
import { usePluginConfig } from './use-plugin-config'

const docState = {
  data: undefined as Record<string, unknown> | undefined,
  status: 'loading' as 'loading' | 'success' | 'error',
}

jest.mock('./firebase/firebase-services', () => ({
  useFirestore: () => ({}),
}))
jest.mock('./use-firestore-doc', () => ({
  useFirestoreDoc: () => docState,
}))
jest.mock('./use-host-org-id', () => ({
  useHostOrgIdState: () => ({ orgId: 'org-1', loaded: true }),
}))
jest.mock('firebase/firestore', () => ({ doc: () => ({}) }))

beforeEach(() => {
  docState.data = undefined
  docState.status = 'loading'
})

describe('useOrgPlan.ready under a refused read (AGL-1066)', () => {
  it('is NOT ready when the org read was refused', () => {
    docState.status = 'error'
    const { result } = renderHook(() => useOrgPlan('host-1'))

    expect(result.current.org).toBeUndefined()
    // The whole point: `'error'` satisfies `!== 'loading'`, so the old gate
    // would have said "ready, and there is no org" — i.e. the free tier.
    expect(result.current.ready).toBe(false)
  })

  it('is not ready while the read is still in flight', () => {
    const { result } = renderHook(() => useOrgPlan('host-1'))
    expect(result.current.ready).toBe(false)
  })

  /**
   * The positive control, and it matters as much as the refusal: these cards
   * are disabled while not ready, so a gate that never opened would break
   * commerce for everyone. A cache-served snapshot still counts — it is an
   * ANSWER, and holding the whole plan UI hostage to a server round-trip is
   * the "stop serving" outcome AGL-1066 decided against.
   */
  it('IS ready once a snapshot has answered, cached or not', () => {
    docState.status = 'success'
    docState.data = { plan: 'business' }
    const { result } = renderHook(() => useOrgPlan('host-1'))

    expect(result.current.ready).toBe(true)
    expect(result.current.org).toEqual({ plan: 'business' })
  })
})

describe('usePluginConfig.ready under a refused read (AGL-1066)', () => {
  it('is NOT ready when the settings read was refused', () => {
    docState.status = 'error'
    const { result } = renderHook(() => usePluginConfig('org-1', 'commerce'))

    // Otherwise a caller acts on schema defaults as though they were the
    // stored settings for this org.
    expect(result.current.ready).toBe(false)
  })

  it('IS ready once a snapshot has answered', () => {
    docState.status = 'success'
    const { result } = renderHook(() => usePluginConfig('org-1', 'commerce'))

    expect(result.current.ready).toBe(true)
  })
})

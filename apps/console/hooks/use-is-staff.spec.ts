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

import { renderHook, waitFor } from '@testing-library/react'

// The hook reads the signed-in user off the instance provider; drive it here.
let mockUser: unknown
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))

import { resetStaffClaimReconciliation, useIsStaff } from './use-is-staff'

/**
 * `getIdTokenResult(force)` stand-in: returns the cached claims when called
 * without a force flag and the fresh ones with it, which is exactly the
 * distinction AGL-955 is about.
 */
const account = (cached: boolean, fresh: boolean, uid = 'uid-1') => {
  const getIdTokenResult = jest.fn(async (forceRefresh?: boolean) => ({
    claims: { staff: forceRefresh ? fresh : cached },
  }))
  return { uid, getIdTokenResult }
}

beforeEach(() => {
  resetStaffClaimReconciliation()
  mockUser = undefined
})

describe('useIsStaff', () => {
  it('starts null so no page flashes a refusal at a staff member', async () => {
    mockUser = account(true, true)
    const { result } = renderHook(() => useIsStaff())
    expect(result.current).toBeNull()
    // Settle the reads so the resolution lands inside the test, not after it.
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('sees a claim granted since the cached token was minted', async () => {
    // The grant case: set-staff-claim.mjs ran, the cached token predates it.
    mockUser = account(false, true)
    const { result } = renderHook(() => useIsStaff())
    await waitFor(() => expect(result.current).toBe(true))
  })

  it('drops a claim revoked since the cached token was minted', async () => {
    // The demotion case — the UI must stop asserting a claim that is gone.
    mockUser = account(true, false)
    const { result } = renderHook(() => useIsStaff())
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('forces exactly one refresh across concurrent consumers', async () => {
    // StaffGuard, the user menu and the secondary nav mount together.
    const user = account(false, true)
    mockUser = user
    const first = renderHook(() => useIsStaff())
    const second = renderHook(() => useIsStaff())
    const third = renderHook(() => useIsStaff())
    await waitFor(() => expect(first.result.current).toBe(true))
    await waitFor(() => expect(second.result.current).toBe(true))
    await waitFor(() => expect(third.result.current).toBe(true))
    expect(
      user.getIdTokenResult.mock.calls.filter(([force]) => force === true),
    ).toHaveLength(1)
  })

  it('reconciles again for a different account', async () => {
    mockUser = account(false, true, 'uid-1')
    const first = renderHook(() => useIsStaff())
    await waitFor(() => expect(first.result.current).toBe(true))

    const other = account(true, false, 'uid-2')
    mockUser = other
    const second = renderHook(() => useIsStaff())
    await waitFor(() => expect(second.result.current).toBe(false))
    expect(
      other.getIdTokenResult.mock.calls.filter(([force]) => force === true),
    ).toHaveLength(1)
  })

  it('fails closed when the refresh throws', async () => {
    // Showing admin chrome on a token we could not confirm is the worse
    // failure; a staff member pays one reload instead.
    mockUser = {
      uid: 'uid-1',
      getIdTokenResult: jest.fn(async (forceRefresh?: boolean) => {
        if (forceRefresh) throw new Error('network')
        return { claims: { staff: true } }
      }),
    }
    const { result } = renderHook(() => useIsStaff())
    await waitFor(() => expect(result.current).toBe(false))
  })

  it('stays null for a user that cannot mint tokens', () => {
    mockUser = {}
    const { result } = renderHook(() => useIsStaff())
    expect(result.current).toBeNull()
  })
})

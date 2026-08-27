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

import { act, renderHook, waitFor } from '@testing-library/react'

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

  it('does not turn a failed refresh into a REFUSAL', async () => {
    /*
     * The idle-tab 404. This asserted `false`, and `StaffGuard` turns `false`
     * into `notFound()` — so a tab left open on an admin page landed on
     * "This page isn't here" as soon as its hourly token refresh failed,
     * which a backgrounded tab is exactly the condition for.
     *
     * The property the old assertion was defending — never show admin chrome
     * on a token we could not confirm — is unchanged and still tested, by
     * `stays null for a user that cannot mint tokens` below and by the
     * StaffOnly gate's own case. What is dropped is the claim that an
     * unreachable network is evidence about who the reader is. Here the
     * CACHED token is valid, unexpired and says staff; only the background
     * re-mint could not run.
     */
    mockUser = {
      uid: 'uid-1',
      getIdTokenResult: jest.fn(async (forceRefresh?: boolean) => {
        if (forceRefresh) throw new Error('network')
        return { claims: { staff: true } }
      }),
    }
    const { result } = renderHook(() => useIsStaff())
    // Settled by the promise chain, not by a clock: a fixed sleep passes on
    // an idle machine and fails under a full suite, which is a flake dressed
    // as a regression.
    await waitFor(() => expect(result.current).toBe(true))
    await act(async () => undefined)
    expect(result.current).toBe(true)
  })

  it('never asserts staff from a token it could not read at all', async () => {
    // The other side of the same coin, and the reason `null` is the right
    // held value: with NO readable token there is no verdict to give, and the
    // guards render their spinner rather than admin chrome.
    mockUser = {
      uid: 'uid-unreadable',
      getIdTokenResult: jest.fn(async () => {
        throw new Error('network')
      }),
    }
    const { result } = renderHook(() => useIsStaff())
    await waitFor(() =>
      expect(
        (mockUser as { getIdTokenResult: jest.Mock }).getIdTokenResult,
      ).toHaveBeenCalled(),
    )
    // Flush the rejection chain so "still null" is a settled answer rather
    // than one the assertion simply arrived before.
    await act(async () => undefined)
    expect(result.current).toBeNull()
  })

  it('a failed refresh is not REMEMBERED as one', async () => {
    /*
     * What made it unrecoverable. The forced-refresh promise is memoised by
     * uid at module scope, so a cached failure was replayed to every later
     * mount for the life of the page — navigating elsewhere and back kept
     * the 404, and only a reload cleared it.
     */
    let forced = 0
    mockUser = {
      uid: 'uid-retry',
      getIdTokenResult: jest.fn(async (forceRefresh?: boolean) => {
        if (!forceRefresh) return { claims: { staff: true } }
        forced += 1
        if (forced === 1) throw new Error('network')
        return { claims: { staff: true } }
      }),
    }
    const first = renderHook(() => useIsStaff())
    await waitFor(() => expect(forced).toBe(1))
    await act(async () => undefined)
    first.unmount()

    const second = renderHook(() => useIsStaff())
    await waitFor(() => expect(second.result.current).toBe(true))
    // It tried again instead of replaying the refusal.
    expect(forced).toBeGreaterThan(1)
  })

  it('stays null for a user that cannot mint tokens', () => {
    mockUser = {}
    const { result } = renderHook(() => useIsStaff())
    expect(result.current).toBeNull()
  })
})

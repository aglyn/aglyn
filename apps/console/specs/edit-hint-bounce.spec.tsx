/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://app.aglyn.com/acme/hosts"}
 *
 * Pragmas must stay in the FIRST block comment — behind the license header
 * they are silently ignored, and this suite needs the document to live on a
 * first-party console host or the bounce must (correctly) never fire.
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
 * The login-time hint bounce trigger (AGL-1842). Pinned:
 *
 * - signed in on a first-party console host with a stale throttle → fetches
 *   the blob with the session's Bearer token and top-level-navigates to the
 *   designated `console.aglyn.app` bounce URL, carrying the blob and the
 *   CURRENT page as the return target;
 * - the throttle stamp is written BEFORE navigating — the loop guard;
 * - a fresh stamp → no fetch, no navigation;
 * - a failed blob mint → no navigation (and the stamp still holds, so the
 *   failure cannot loop either);
 * - signed out → clears the stamp so the next sign-in re-plants promptly;
 * - auth still resolving → does nothing, clears nothing.
 */

import { render, waitFor } from '@testing-library/react'
import EditHintBounce, {
  EDIT_HINT_BOUNCE_ORIGIN,
  EDIT_HINT_BOUNCE_STAMP_KEY,
} from '../components/edit-hint-bounce.component'

let mockUser: unknown

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useUser: () => ({ data: mockUser }),
}))

const signedInUser = { getIdToken: async () => 'id-token-123' }

describe('EditHintBounce (AGL-1842)', () => {
  let navigate: jest.Mock

  beforeEach(() => {
    mockUser = undefined
    navigate = jest.fn()
    window.localStorage.clear()
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ blob: 'signed-bounce-blob' }),
    })) as unknown as typeof fetch
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('bounces a signed-in editor through console.aglyn.app, stamping first', async () => {
    mockUser = signedInUser
    render(<EditHintBounce navigate={navigate} />)
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/edit-hint/blob',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer id-token-123' },
      }),
    )
    const url = new URL(navigate.mock.calls[0][0] as string)
    expect(url.origin).toBe(EDIT_HINT_BOUNCE_ORIGIN)
    expect(url.pathname).toBe('/api/edit-hint/set')
    expect(url.searchParams.get('sig')).toBe('signed-bounce-blob')
    // The return target is THIS page, so the flash lands the editor back
    // exactly where they were.
    expect(url.searchParams.get('return')).toBe(
      'https://app.aglyn.com/acme/hosts',
    )
    // Loop guard: the stamp preceded the navigation.
    expect(
      Number(window.localStorage.getItem(EDIT_HINT_BOUNCE_STAMP_KEY)),
    ).toBeGreaterThan(0)
  })

  it('does nothing within the throttle window', async () => {
    window.localStorage.setItem(EDIT_HINT_BOUNCE_STAMP_KEY, String(Date.now()))
    mockUser = signedInUser
    render(<EditHintBounce navigate={navigate} />)
    // Flush any would-be async work before asserting the negative.
    await Promise.resolve()
    expect(global.fetch).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('bounces again once the stamp is stale', async () => {
    window.localStorage.setItem(
      EDIT_HINT_BOUNCE_STAMP_KEY,
      String(Date.now() - 25 * 60 * 60 * 1000),
    )
    mockUser = signedInUser
    render(<EditHintBounce navigate={navigate} />)
    await waitFor(() => expect(navigate).toHaveBeenCalledTimes(1))
  })

  it('stays put when the blob mint fails — and holds the stamp', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthenticated' }),
    })) as unknown as typeof fetch
    mockUser = signedInUser
    render(<EditHintBounce navigate={navigate} />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    await Promise.resolve()
    expect(navigate).not.toHaveBeenCalled()
    // The stamp survives a failure: one silent miss, never a retry loop.
    expect(
      Number(window.localStorage.getItem(EDIT_HINT_BOUNCE_STAMP_KEY)),
    ).toBeGreaterThan(0)
  })

  it('clears the throttle on sign-out so the next sign-in re-plants', () => {
    window.localStorage.setItem(EDIT_HINT_BOUNCE_STAMP_KEY, String(Date.now()))
    mockUser = null
    render(<EditHintBounce navigate={navigate} />)
    expect(window.localStorage.getItem(EDIT_HINT_BOUNCE_STAMP_KEY)).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('does nothing, and clears nothing, while auth is resolving', () => {
    window.localStorage.setItem(EDIT_HINT_BOUNCE_STAMP_KEY, '123')
    mockUser = undefined
    render(<EditHintBounce navigate={navigate} />)
    expect(window.localStorage.getItem(EDIT_HINT_BOUNCE_STAMP_KEY)).toBe('123')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

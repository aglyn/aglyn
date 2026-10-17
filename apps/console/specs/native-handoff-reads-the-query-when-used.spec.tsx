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
 * AGL-3902 — `/auth/native` hands the app the sign-in it asked for after a
 * client navigation back from `/sso` or `/signin`.
 *
 * The app opens `/auth/native?challenge=…&redirect_uri=…&state=…`; signed out,
 * the page sends the visitor to `/sso` (or `/signin`) with itself as the
 * `continue`, and the auth layout follows that `continue` with `router.push`.
 * Next renders the page BEFORE the address bar holds its URL, and the page
 * froze `window.location.search` at that first render, so it kept the sign-in
 * page's query and "Continue in the app" posted a null challenge, return
 * address and state: the route refused every hand-off as "not from the app".
 *
 * Pinned: the authorize call carries the query of the URL the page is on when
 * the person continues, not the one it first rendered under.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockUser = { uid: 'u-1', email: 'ana@sso.example', emailVerified: true }
const mockAuth = { currentUser: mockUser }
const mockAuthorizedFetch = jest.fn()

jest.mock('firebase/auth', () => ({ signOut: jest.fn() }))
jest.mock('@aglyn/tenant-feature-instance', () => ({
  // No auth domain: the page stays on this origin (no auth-origin hop).
  fbClientAppOptions: { authDomain: '' },
  useAuth: () => mockAuth,
  useSigninCheck: () => ({ status: 'success', data: { signedIn: true, user: mockUser } }),
}))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...args),
}))
jest.mock('@aglyn/aglyn/app-utils/platform-brand', () => ({ PLATFORM_BRAND_NAME: 'Aglyn' }))
jest.mock('@aglyn/shared-ui-jsx/components/loading-text.component', () => ({
  LoadingTextComponent: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))
jest.mock('../components/auth-form.component', () => ({
  __esModule: true,
  default: ({ headingTop, children }: { headingTop?: ReactNode; children?: ReactNode }) => (
    <div>
      <h1>{headingTop}</h1>
      {children}
    </div>
  ),
}))

import NativeHandoff from '../app/auth/native/page'

const CHALLENGE = 'ZabHmh7QgGf7XYRNThYN0dFoqAwQR-5iSz_R2-XXe94'
const STATE = 'qREkylfObJXvtt5W6pdrIQ'
const HANDOFF_QUERY = `challenge=${CHALLENGE}&redirect_uri=${encodeURIComponent('aglyn://auth/handoff')}&state=${STATE}`

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve()
  })
}

beforeEach(() => {
  mockAuthorizedFetch.mockReset()
  // A refusal keeps the page from navigating (jsdom has no navigation); only the request matters here.
  mockAuthorizedFetch.mockResolvedValue({ ok: false, json: async () => ({ error: 'refused' }) })
})

describe('AGL-3902 · /auth/native reads its query when it is used', () => {
  it('sends the current URL’s challenge, return address and state after a client navigation from /sso', async () => {
    // The first render happens while the address bar still shows the SSO page, as on a router.push back.
    window.history.replaceState(null, '', `/sso?continue=${encodeURIComponent(`/auth/native?${HANDOFF_QUERY}`)}`)
    render(<NativeHandoff />)
    await flush()
    // Then the router commits the new address.
    window.history.replaceState(null, '', `/auth/native?${HANDOFF_QUERY}`)

    fireEvent.click(screen.getByRole('button', { name: 'Continue in the app' }))
    await flush()

    expect(mockAuthorizedFetch).toHaveBeenCalledTimes(1)
    const [, path, init] = mockAuthorizedFetch.mock.calls[0] as [unknown, string, RequestInit]
    expect(path).toBe('/api/auth/native-handoff/authorize')
    // Red before the fix: all three were null, read from the /sso query frozen at the first render.
    expect(JSON.parse(String(init.body))).toEqual({
      challenge: CHALLENGE,
      redirectUri: 'aglyn://auth/handoff',
      state: STATE,
    })
  })
})

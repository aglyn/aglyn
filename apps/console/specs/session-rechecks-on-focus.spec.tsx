/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * Coming back to a tab re-checks the session (AGL-3242).
 *
 * `useSessionCookie` reached its validate-or-restore verdict on the FIRST auth
 * emission after a page load and never again, so a tab whose session went bad
 * had exactly one way back: a manual reload. Bringing the tab forward did
 * nothing. With several consoles open that made recovery a race run by hand:
 * every tab reloaded, and all of them before any one could tombstone the
 * session again, or the round starts over.
 *
 * ## The property that keeps this safe
 *
 * A re-check runs the SAME verdict as a reload, not a stricter one. The whole
 * risk of re-validating more often is that it signs somebody out more often,
 * so the cases below pin both directions: a stale tombstone still heals by
 * re-minting (AGL-624), and a genuine sign-out elsewhere still ends the
 * session. If a future change splits those two paths, these fail.
 */

import { renderHook } from '@testing-library/react'

jest.mock('@aglyn/shared-data-enums', () => ({
  __esModule: true,
  FIREBASE_AUTH_EMULATOR_ENABLED: false,
}))

let mockUser: { uid: string; metadata?: { lastSignInTime?: string } } | null =
  null
const mockAuth: { currentUser: unknown; tenantId: string | null } = {
  currentUser: null,
  tenantId: null,
}
jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useAuth: () => mockAuth,
  useUser: () => ({ data: mockUser }),
}))

const mockSignOut = jest.fn(async () => undefined)
jest.mock('firebase/auth', () => ({
  __esModule: true,
  signOut: (...args: unknown[]) => mockSignOut(...(args as [])),
}))

const mockAuthorizedFetch = jest.fn(async () => ({ ok: true, json: async () => ({}) }))
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  __esModule: true,
  authorizedFetch: (...args: unknown[]) => mockAuthorizedFetch(...(args as [])),
}))

const mockPooledSignIn = jest.fn(async () => undefined)
jest.mock('../utils/pooled-custom-token', () => ({
  __esModule: true,
  adoptRestoredPool: jest.fn(),
  signInWithPooledCustomToken: (...args: unknown[]) =>
    mockPooledSignIn(...(args as [])),
}))

jest.mock('../utils/email-verification-gate', () => ({
  __esModule: true,
  emailGateWouldRefuse: async () => false,
}))

jest.mock('../utils/clear-service-worker-caches', () => ({
  __esModule: true,
  default: async () => undefined,
}))

jest.mock('../utils/interactive-signin', () => ({
  __esModule: true,
  clearInteractiveSignIn: jest.fn(),
  consumeInteractiveSignIn: () => false,
  consumeInteractiveSignOut: () => false,
}))

const mockRequestReauth = jest.fn()
jest.mock('../utils/session-reauth', () => ({
  __esModule: true,
  captureReauthIdentity: () => ({
    email: 'owner@example.com',
    hasPassword: false,
    providerId: 'google.com',
  }),
  requestSessionReauth: (...args: unknown[]) =>
    mockRequestReauth(...(args as [])),
}))

/*
 * `session-tombstone` is deliberately NOT mocked. It is a pure comparison with
 * no imports, and it is the thing under test on the two tombstone cases — a
 * stub of it would assert the stub.
 */
import {
  SESSION_RECHECK_THROTTLE_MS,
  useSessionCookie,
} from '../hooks/use-session-cookie'

/** Queued `fetch` answers, oldest first; the default is an unremarkable 200. */
let answers: Array<{ ok: boolean; status: number; body: unknown }> = []
const fetchCalls: Array<{ url: string; method: string }> = []

const mockFetch = jest.fn(async (url: string, init?: { method?: string }) => {
  fetchCalls.push({ url, method: init?.method ?? 'GET' })
  const answer = answers.shift() ?? { ok: true, status: 200, body: {} }
  return {
    ok: answer.ok,
    status: answer.status,
    json: async () => answer.body,
  }
})

/** The browser events the hook listens for. */
const becomeVisible = () => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
  document.dispatchEvent(new Event('visibilitychange'))
}
const becomeHidden = () => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'hidden',
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** Let the hook's queued microtasks and awaited fetches settle. */
const settle = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

const SIGNED_IN_AT = '2026-09-22T10:00:00.000Z'
const SIGNED_IN_MS = Date.parse(SIGNED_IN_AT)

const signedInUser = () => ({
  uid: 'u1',
  metadata: { lastSignInTime: SIGNED_IN_AT },
  getIdToken: async () => 'tok',
})

beforeEach(() => {
  jest.clearAllMocks()
  answers = []
  fetchCalls.length = 0
  mockUser = null
  mockAuth.currentUser = null
  mockAuth.tenantId = null
  global.fetch = mockFetch as unknown as typeof fetch
  jest.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000)
  becomeHidden()
})

afterEach(() => {
  jest.restoreAllMocks()
})

/** Renders the hook past its load-time pass, then clears the record of it. */
async function mountedAndSettled(user: ReturnType<typeof signedInUser> | null) {
  mockUser = user as never
  mockAuth.currentUser = user
  const view = renderHook(() => useSessionCookie())
  await settle()
  fetchCalls.length = 0
  mockPooledSignIn.mockClear()
  mockSignOut.mockClear()
  mockRequestReauth.mockClear()
  return view
}

describe('CONTROL — the re-check does not fire on its own', () => {
  it('makes no request when nothing happens after the load-time pass', async () => {
    await mountedAndSettled(signedInUser())
    await settle()
    // If this ever fails, every case below is measuring the load-time pass.
    expect(fetchCalls).toEqual([])
  })

  it('ignores the visibilitychange that fires on the way INTO hidden', async () => {
    await mountedAndSettled(signedInUser())
    becomeHidden()
    await settle()
    expect(fetchCalls).toEqual([])
  })
})

describe('a tab brought forward re-checks its session', () => {
  it('re-validates the shared cookie for a live local user', async () => {
    await mountedAndSettled(signedInUser())
    becomeVisible()
    await settle()
    // The request a reload used to be needed for.
    expect(fetchCalls).toEqual([{ url: '/api/auth/session', method: 'GET' }])
  })

  it('re-attempts the silent restore for a tab with no local user', async () => {
    // The tab parked on `/signin` after a sibling signed in — the one the
    // reader was reloading by hand.
    await mountedAndSettled(null)
    answers = [{ ok: true, status: 200, body: { token: 'ct', tenantId: null } }]
    becomeVisible()
    await settle()
    expect(mockPooledSignIn).toHaveBeenCalledWith(mockAuth, 'ct', null)
  })

  it('also re-checks when the connection comes back', async () => {
    await mountedAndSettled(signedInUser())
    becomeVisible()
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(fetchCalls.length).toBeGreaterThan(0)
  })
})

describe('a re-check reaches the SAME verdict a reload would', () => {
  it('heals a tombstone OLDER than this session by re-minting (AGL-624)', async () => {
    await mountedAndSettled(signedInUser())
    answers = [
      {
        ok: false,
        status: 401,
        body: { reason: 'signed-out', signedOutAt: SIGNED_IN_MS - 60_000 },
      },
    ]
    becomeVisible()
    await settle()
    // Nobody is signed out for a sign-out that predates their sign-in…
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockRequestReauth).not.toHaveBeenCalled()
    // …and the stale tombstone is replaced rather than left to bite again.
    expect(mockAuthorizedFetch).toHaveBeenCalled()
  })

  it('ends the session for a tombstone NEWER than this sign-in', async () => {
    await mountedAndSettled(signedInUser())
    answers = [
      {
        ok: false,
        status: 401,
        body: { reason: 'signed-out', signedOutAt: SIGNED_IN_MS + 60_000 },
      },
    ]
    becomeVisible()
    await settle()
    // Propagation without a reload, which is the half that used to need one.
    expect(mockRequestReauth).toHaveBeenCalledWith(
      'signed-out',
      expect.objectContaining({ email: 'owner@example.com' }),
    )
    expect(mockSignOut).toHaveBeenCalled()
  })

  it('ends the session on a revocation', async () => {
    await mountedAndSettled(signedInUser())
    answers = [{ ok: false, status: 401, body: { reason: 'revoked' } }]
    becomeVisible()
    await settle()
    expect(mockRequestReauth).toHaveBeenCalledWith(
      'revoked',
      expect.anything(),
    )
    expect(mockSignOut).toHaveBeenCalled()
  })

  it('never signs anyone out on network trouble', async () => {
    await mountedAndSettled(signedInUser())
    mockFetch.mockRejectedValueOnce(new Error('offline'))
    becomeVisible()
    await settle()
    expect(mockSignOut).not.toHaveBeenCalled()
    expect(mockRequestReauth).not.toHaveBeenCalled()
  })

  it('cannot resurrect a deliberate sign-out', async () => {
    // A tombstone answers 401, which falls out before auth is touched — so
    // re-checking a signed-out tab signs nobody back in.
    await mountedAndSettled(null)
    answers = [{ ok: false, status: 401, body: { reason: 'signed-out' } }]
    becomeVisible()
    await settle()
    expect(mockPooledSignIn).not.toHaveBeenCalled()
  })
})

describe('the re-check is throttled', () => {
  it('answers a second focus inside the window with nothing', async () => {
    await mountedAndSettled(signedInUser())
    becomeVisible()
    await settle()
    const afterFirst = fetchCalls.length
    becomeHidden()
    becomeVisible()
    await settle()
    // Alt-tabbing between two consoles must not be a request per switch.
    expect(fetchCalls.length).toBe(afterFirst)
  })

  it('re-checks again once the window has passed', async () => {
    await mountedAndSettled(signedInUser())
    becomeVisible()
    await settle()
    const afterFirst = fetchCalls.length
    ;(Date.now as jest.Mock).mockReturnValue(
      2_000_000_000_000 + SESSION_RECHECK_THROTTLE_MS + 1,
    )
    becomeHidden()
    becomeVisible()
    await settle()
    // A failed recovery is a beat away from its next attempt, not a wait.
    expect(fetchCalls.length).toBeGreaterThan(afterFirst)
  })
})

describe('the listeners are cleaned up', () => {
  it('stops re-checking once the hook unmounts', async () => {
    const view = await mountedAndSettled(signedInUser())
    view.unmount()
    becomeVisible()
    await settle()
    expect(fetchCalls).toEqual([])
  })
})

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
 * THE CROSS-POOL DESYNC RECOVERY (AGL-3280).
 *
 * The contracts that matter here are the NEGATIVE ones. This reloads
 * somebody's page, so every fence around it has to hold: not for another
 * error, not while the tab is visible, not for a tab with nobody signed in,
 * and never twice for one burst.
 */

import { render } from '@testing-library/react'
import { act } from 'react'
import {
  CROSS_POOL_RECOVERY_INTERVAL_MS,
  isCrossPoolDesync,
  shouldReloadForCrossPoolDesync,
} from '../utils/cross-pool-desync'
import { useCrossPoolTabRecovery } from '../hooks/use-cross-pool-tab-recovery'

/*
 * The reload itself is the one thing stubbed — jsdom refuses to let a spec
 * redefine `location.reload`, which is why it is a seam of its own. The
 * DECISION below is the real one, so the fences are exercised rather than
 * described.
 */
const mockReloads: number[] = []
jest.mock('../utils/cross-pool-desync', () => {
  const actual = jest.requireActual('../utils/cross-pool-desync')
  return {
    ...actual,
    reloadForCrossPoolRecovery: () => void mockReloads.push(Date.now()),
  }
})

/** What `useAuth` hands the hook; `null` for a tab with nobody signed in. */
let mockCurrentUser: { uid: string } | null = { uid: 'u-1' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useAuth: () => ({
    get currentUser() {
      return mockCurrentUser
    },
  }),
}))

let visibility: DocumentVisibilityState = 'hidden'
beforeAll(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  })
})

beforeEach(() => {
  mockReloads.length = 0
  mockCurrentUser = { uid: 'u-1' }
  visibility = 'hidden'
  window.sessionStorage.clear()
  jest.restoreAllMocks()
})

/** The rejection Firebase raises from inside its own storage listener. */
const MISMATCH = Object.assign(
  new Error('Firebase: Error (auth/tenant-id-mismatch).'),
  { code: 'auth/tenant-id-mismatch' },
)

function Probe() {
  useCrossPoolTabRecovery()
  return null
}

/** Dispatch what the browser dispatches; jsdom has no PromiseRejectionEvent. */
function reject(reason: unknown) {
  const event = new Event('unhandledrejection') as Event & { reason?: unknown }
  event.reason = reason
  act(() => {
    window.dispatchEvent(event)
  })
}

describe('isCrossPoolDesync', () => {
  it('knows the SDK code, by field and by message', () => {
    expect(isCrossPoolDesync(MISMATCH)).toBe(true)
    expect(
      isCrossPoolDesync({ message: 'Firebase: Error (auth/tenant-id-mismatch).' }),
    ).toBe(true)
  })

  it('leaves every other rejection alone', () => {
    expect(isCrossPoolDesync({ code: 'auth/user-token-expired' })).toBe(false)
    expect(isCrossPoolDesync(new Error('network'))).toBe(false)
    expect(isCrossPoolDesync('auth/tenant-id-mismatch')).toBe(false)
    expect(isCrossPoolDesync(null)).toBe(false)
  })
})

describe('shouldReloadForCrossPoolDesync', () => {
  const ask = (over: Partial<Parameters<typeof shouldReloadForCrossPoolDesync>[0]> = {}) =>
    shouldReloadForCrossPoolDesync({ signedIn: true, visibility: 'hidden', ...over })

  it('says yes for a hidden tab that holds a user', () => {
    expect(ask()).toBe(true)
  })

  it('refuses a VISIBLE tab — it may have something half-typed in it', () => {
    expect(ask({ visibility: 'visible' })).toBe(false)
  })

  it('refuses a tab with nobody signed in — nothing there desynced', () => {
    expect(ask({ signedIn: false })).toBe(false)
  })

  it('refuses the second reload inside the interval, so a burst is one reload', () => {
    expect(ask()).toBe(true)
    expect(ask()).toBe(false)
  })

  it('recovers again once the interval has passed', () => {
    expect(ask()).toBe(true)
    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + CROSS_POOL_RECOVERY_INTERVAL_MS + 1_000)
    expect(ask()).toBe(true)
  })

  it('takes no reload at all when storage is refused', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(ask()).toBe(false)
  })
})

describe('useCrossPoolTabRecovery', () => {
  it('reloads a hidden tab once, however many rejections the burst carries', () => {
    render(<Probe />)

    // One storage event raises several rejections — three inside one second
    // on the day this was found.
    reject(MISMATCH)
    reject(MISMATCH)
    reject(MISMATCH)

    expect(mockReloads).toHaveLength(1)
  })

  it('does not reload for any other rejection', () => {
    render(<Probe />)

    reject(new Error('the save was refused'))
    reject({ code: 'auth/user-token-expired' })

    expect(mockReloads).toHaveLength(0)
  })

  it('waits for a VISIBLE tab, then heals it the moment it is hidden', () => {
    visibility = 'visible'
    render(<Probe />)

    reject(MISMATCH)
    expect(mockReloads).toHaveLength(0)

    // The desync does not expire; the tab heals when it stops being watched.
    visibility = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockReloads).toHaveLength(1)
  })

  it('never reloads a tab that merely became hidden with no desync', () => {
    render(<Probe />)

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockReloads).toHaveLength(0)
  })

  it('leaves a signed-out tab alone — its next sign-in aims the pool itself', () => {
    mockCurrentUser = null
    render(<Probe />)

    reject(MISMATCH)

    expect(mockReloads).toHaveLength(0)
  })
})

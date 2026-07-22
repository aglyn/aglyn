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
import { act, render, screen } from '@testing-library/react'
import NotificationPrompt from './notification-prompt.component'

let mockUser: { uid: string } | undefined
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useUser: () => ({ data: mockUser }),
}))

const mockSetAlertPrefs = jest.fn()
jest.mock('../hooks/use-notification-prefs', () => ({
  __esModule: true,
  default: () => [{ sound: false, desktop: false, tabBadge: true }, mockSetAlertPrefs],
}))

let mockPermission: string
let mockRequestResult: string
jest.mock('../utils/notification-alerts', () => ({
  desktopNotificationPermission: () => mockPermission,
  requestDesktopNotifications: () => Promise.resolve(mockRequestResult),
}))

const DISMISSED_KEY = 'aglyn:notification-prompt-dismissed'
/** Must outlast the component's APPEAR_DELAY_MS. */
const PAST_DELAY_MS = 3000

/**
 * The prompt's whole value is that it does NOT fire the browser's one-shot
 * permission request unless it should (AGL-663) — so the gating is the part
 * worth pinning down. A browser can't be driven into `permission: 'default'`
 * from a test, hence the module mock.
 */
describe('NotificationPrompt gating (AGL-663)', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.clearAllMocks()
    window.localStorage.clear()
    mockUser = { uid: 'u1' }
    mockPermission = 'default'
    mockRequestResult = 'granted'
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  function renderAndSettle() {
    render(<NotificationPrompt />)
    act(() => {
      jest.advanceTimersByTime(PAST_DELAY_MS)
    })
  }

  it('offers once the app has settled, for a signed-in user with no verdict yet', () => {
    renderAndSettle()
    expect(screen.getByText('Enable notifications')).toBeTruthy()
  })

  it('stays hidden until the delay has elapsed', () => {
    render(<NotificationPrompt />)
    expect(screen.queryByText('Enable notifications')).toBeNull()
  })

  it.each(['granted', 'denied', 'unsupported'])(
    'stays hidden when permission is already %s',
    (permission) => {
      mockPermission = permission
      renderAndSettle()
      expect(screen.queryByText('Enable notifications')).toBeNull()
    },
  )

  it('stays hidden when nobody is signed in', () => {
    mockUser = undefined
    renderAndSettle()
    expect(screen.queryByText('Enable notifications')).toBeNull()
  })

  it('stays hidden once the user has chosen "Don\'t ask me again"', () => {
    window.localStorage.setItem(DISMISSED_KEY, 'never')
    renderAndSettle()
    expect(screen.queryByText('Enable notifications')).toBeNull()
  })

  it('persists the never-again choice so it survives a reload', () => {
    renderAndSettle()
    act(() => {
      screen.getByText('Don’t ask me again').click()
    })
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('never')
  })

  it('snoozes on "Not now" so the answer actually holds', () => {
    renderAndSettle()
    act(() => {
      screen.getByText('Not now').click()
    })
    const stored = window.localStorage.getItem(DISMISSED_KEY)
    expect(stored).toMatch(/^snooze:\d+$/)
    expect(Number(stored?.slice('snooze:'.length))).toBeGreaterThan(Date.now())
  })

  it('stays hidden while a "Not now" snooze is live', () => {
    window.localStorage.setItem(
      DISMISSED_KEY,
      `snooze:${Date.now() + 60_000}`,
    )
    renderAndSettle()
    expect(screen.queryByText('Enable notifications')).toBeNull()
  })

  it('offers again once the snooze has expired', () => {
    // The whole point of a snooze rather than a permanent dismissal: a soft
    // no is temporary, and must not silently become a forever no.
    window.localStorage.setItem(
      DISMISSED_KEY,
      `snooze:${Date.now() - 60_000}`,
    )
    renderAndSettle()
    expect(screen.getByText('Enable notifications')).toBeTruthy()
  })

  it('ignores a malformed snooze rather than hiding forever', () => {
    window.localStorage.setItem(DISMISSED_KEY, 'snooze:not-a-number')
    renderAndSettle()
    expect(screen.getByText('Enable notifications')).toBeTruthy()
  })

  it('switches the desktop pref on only when the browser actually grants', async () => {
    renderAndSettle()
    await act(async () => {
      screen.getByText('Enable').click()
    })
    expect(mockSetAlertPrefs).toHaveBeenCalledWith({ desktop: true })
  })

  it('leaves the desktop pref alone when the browser denies', async () => {
    mockRequestResult = 'denied'
    renderAndSettle()
    await act(async () => {
      screen.getByText('Enable').click()
    })
    expect(mockSetAlertPrefs).not.toHaveBeenCalled()
  })
})

/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const mockUpdates: Array<{ path: string; field: string[]; value: unknown }> = []
let mockProfile: Record<string, unknown> | null = null

jest.mock('firebase/firestore', () => {
  class FieldPath {
    segments: string[]
    constructor(...segments: string[]) {
      this.segments = segments
    }
  }
  return {
    FieldPath,
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    updateDoc: async (ref: { path: string }, field: FieldPath, value: unknown) => {
      mockUpdates.push({ path: ref.path, field: field.segments, value })
    },
  }
})
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
// The icon font loader is native; a row's icon is not what this spec is about.
jest.mock('@expo/vector-icons/Ionicons', () => () => null)
// React Native 0.86's ScrollView native component ships untranspiled to jest;
// the screen's frame is not what this spec is about.
jest.mock('@aglyn/mobile-ui', () => ({
  ...jest.requireActual('@aglyn/mobile-ui'),
  Screen: ({ children }: { children: unknown }) => children,
}))
jest.mock('@aglyn/mobile-core', () => ({
  getMobileFirebase: () => ({ firestore: {} }),
  useMobileAuth: () => ({ user: { uid: 'uid-a' } }),
  useLiveDoc: () => ({ data: mockProfile, ready: true, error: null }),
}))

import { MobileThemeProvider } from '@aglyn/mobile-ui'
import { fireEvent, render, screen } from '@testing-library/react-native'
import { NotificationSettingsScreen } from './notification-settings'

function renderScreen() {
  return render(
    <MobileThemeProvider>
      <NotificationSettingsScreen />
    </MobileThemeProvider>,
  )
}

describe('push notification settings (AGL-3620)', () => {
  beforeEach(() => {
    mockUpdates.length = 0
    mockProfile = null
  })

  it('shows every member type following the feed until it is answered', async () => {
    mockProfile = {
      notificationSettings: {
        account: { billing: { console: false } },
        accountTypes: { 'content.booking': { push: false } },
      },
    }
    await renderScreen()
    expect((await screen.findByTestId('push-content.order')).props.value).toBe(true)
    expect(screen.getByTestId('push-content.booking').props.value).toBe(false)
    expect(screen.getByTestId('push-billing.invoice').props.value).toBe(false)
    expect(screen.queryByTestId('push-staff.subscriptionStarted')).toBeNull()
  })

  it('stores a switch under the type’s own key, dot and all', async () => {
    await renderScreen()
    await fireEvent(await screen.findByTestId('push-content.order'), 'valueChange', false)
    expect(mockUpdates).toEqual([
      { path: 'users/uid-a', field: ['notificationSettings', 'accountTypes', 'content.order', 'push'], value: false },
    ])
  })
})

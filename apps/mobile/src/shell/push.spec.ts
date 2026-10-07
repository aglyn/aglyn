/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const mockWrites: Array<{ path: string; data?: Record<string, unknown> }> = []
const mockNavigated: Array<[string, unknown]> = []
let mockPermission = 'granted'
let mockIsDevice = true
let mockProjectId: string | undefined = 'eas-project'

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  AndroidImportance: { HIGH: 4 },
  getPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  requestPermissionsAsync: jest.fn(async () => ({ status: mockPermission })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abcdefgh1234]' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}))
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockIsDevice
  },
}))
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { version: '1.2.3', extra: mockProjectId ? { eas: { projectId: mockProjectId } } : {} }
    },
    easConfig: null,
  },
}))
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: async (ref: { path: string }, data: Record<string, unknown>) => {
    mockWrites.push({ path: ref.path, data })
  },
  deleteDoc: async (ref: { path: string }) => {
    mockWrites.push({ path: ref.path })
  },
  serverTimestamp: () => 'SERVER_TIME',
}))
jest.mock('@aglyn/mobile-core', () => ({
  getMobileFirebase: () => ({ firestore: {} }),
  onBeforeSignOut: () => () => undefined,
}))
jest.mock('./navigation-ref', () => ({
  navigationRef: { isReady: () => true },
  openPluginScreen: (screen: string, params: unknown) => mockNavigated.push([screen, params]),
  openConsolePath: (path: string) => mockNavigated.push(['console', path]),
}))
jest.mock('../config', () => ({ APP_VERSION: '1.2.3' }))

import { registerMobileDeepLink, resetMobileRegistry } from '@aglyn/mobile-plugin-host'
import { installId, openPushTarget, registerDevice } from './push'

describe('push notifications in the app (AGL-3620)', () => {
  beforeEach(() => {
    mockWrites.length = 0
    mockNavigated.length = 0
    mockPermission = 'granted'
    mockIsDevice = true
    mockProjectId = 'eas-project'
  })

  it('keeps one install id across launches', async () => {
    const first = await installId()
    expect(await installId()).toBe(first)
    expect(first).toMatch(/^[a-z0-9]{8,}$/)
  })

  it('registers this install with its Expo token, in the registry’s shape', async () => {
    await expect(registerDevice('uid-a')).resolves.toBe(true)
    expect(mockWrites).toHaveLength(1)
    expect(mockWrites[0].path).toMatch(/^users\/uid-a\/devices\/[a-z0-9]+$/)
    expect(mockWrites[0].data).toEqual({
      token: 'ExponentPushToken[abcdefgh1234]',
      platform: 'ios',
      app: 'aglyn',
      appVersion: '1.2.3',
      lastSeen: 'SERVER_TIME',
    })
  })

  it('registers nothing without permission, on a simulator, or before an EAS project exists', async () => {
    mockPermission = 'denied'
    await expect(registerDevice('uid-a')).resolves.toBe(false)
    mockPermission = 'granted'
    mockIsDevice = false
    await expect(registerDevice('uid-a')).resolves.toBe(false)
    mockIsDevice = true
    mockProjectId = undefined
    await expect(registerDevice('uid-a')).resolves.toBe(false)
    expect(mockWrites).toHaveLength(0)
  })

  it('opens a tapped push natively when a plugin answers its link, else in the console', async () => {
    resetMobileRegistry()
    registerMobileDeepLink({ pluginId: 'redirects', id: 'redirects.page', path: '/redirects', screen: 'redirects.list' })
    await openPushTarget({ type: 'content.order', link: '/acme/hosts/shop/redirects' })
    await openPushTarget({ type: 'content.order', link: '/acme/hosts/shop/orders/o1' })
    await openPushTarget({ type: 'content.order', link: 'javascript:alert(1)' })
    expect(mockNavigated).toEqual([
      ['redirects.list', expect.objectContaining({ orgSlug: 'acme', hostSlug: 'shop' })],
      ['console', '/acme/hosts/shop/orders/o1'],
    ])
  })
})

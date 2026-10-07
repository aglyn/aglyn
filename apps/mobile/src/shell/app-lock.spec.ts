/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}))
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
)
jest.mock('@aglyn/mobile-core', () => ({ mobileBrandName: () => 'Aglyn', useMobileAuth: () => ({}) }))
jest.mock('@aglyn/mobile-ui', () => ({}))

import * as LocalAuthentication from 'expo-local-authentication'
import { APP_LOCK_GRACE_MS, biometricsAvailable, shouldLock } from './app-lock'

describe('biometric unlock (AGL-3620)', () => {
  it('locks again only after the grace period in the background, and only when on', () => {
    const now = 1_000_000
    expect(shouldLock(true, now - APP_LOCK_GRACE_MS, now)).toBe(true)
    expect(shouldLock(true, now - APP_LOCK_GRACE_MS + 1, now)).toBe(false)
    expect(shouldLock(true, null, now)).toBe(false)
    expect(shouldLock(false, now - 10 * APP_LOCK_GRACE_MS, now)).toBe(false)
  })

  it('is offered only on a device with enrolled biometrics', async () => {
    await expect(biometricsAvailable()).resolves.toBe(true)
    ;(LocalAuthentication.isEnrolledAsync as jest.Mock).mockResolvedValueOnce(false)
    await expect(biometricsAvailable()).resolves.toBe(false)
    ;(LocalAuthentication.hasHardwareAsync as jest.Mock).mockRejectedValueOnce(new Error('no module'))
    await expect(biometricsAvailable()).resolves.toBe(false)
  })
})

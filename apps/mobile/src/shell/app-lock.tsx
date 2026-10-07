/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Biometric unlock (AGL-3620). When the member turns it on in Settings, the
 * app opens locked and locks again after a minute in the background, and
 * Face ID, Touch ID or the device's biometrics unlock it. It is a per-device
 * choice, so it lives in this install's storage and not on the account.
 */

import { mobileBrandName, useMobileAuth } from '@aglyn/mobile-core'
import { Button, Text, useMobileTheme } from '@aglyn/mobile-ui'
import AsyncStorage from '@react-native-async-storage/async-storage'
import * as LocalAuthentication from 'expo-local-authentication'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, StyleSheet, View } from 'react-native'

const APP_LOCK_KEY = 'aglyn.appLock'

/** How long the app may sit in the background before it asks again. */
export const APP_LOCK_GRACE_MS = 60_000

/** Whether returning to the app must unlock it. */
export function shouldLock(enabled: boolean, backgroundedAt: number | null, now: number): boolean {
  return enabled && backgroundedAt !== null && now - backgroundedAt >= APP_LOCK_GRACE_MS
}

/** Whether this device can unlock with biometrics at all. */
export async function biometricsAvailable(): Promise<boolean> {
  try {
    return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
  } catch {
    return false
  }
}

export function useAppLockPreference() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    AsyncStorage.getItem(APP_LOCK_KEY)
      .then((value) => setEnabled(value === '1'))
      .catch(() => setEnabled(false))
    void biometricsAvailable().then(setAvailable)
  }, [])
  const update = useCallback(async (next: boolean) => {
    // Turning it on proves the biometrics work first, so nobody locks
    // themselves behind a prompt that cannot succeed.
    if (next) {
      const result = await LocalAuthentication.authenticateAsync({ promptMessage: `Unlock ${mobileBrandName()}` })
      if (!result.success) return
    }
    await AsyncStorage.setItem(APP_LOCK_KEY, next ? '1' : '0').catch(() => undefined)
    setEnabled(next)
  }, [])
  return { enabled: enabled ?? false, ready: enabled !== null, available, setEnabled: update }
}

export function AppLockGate({ children }: { children: ReactNode }) {
  const theme = useMobileTheme()
  const { signOut } = useMobileAuth()
  const { enabled, ready } = useAppLockPreference()
  const [locked, setLocked] = useState<boolean | null>(null)
  const backgroundedAt = useRef<number | null>(null)

  const unlock = useCallback(async () => {
    const result = await LocalAuthentication.authenticateAsync({ promptMessage: `Unlock ${mobileBrandName()}` })
    if (result.success) setLocked(false)
  }, [])

  useEffect(() => {
    if (!ready) return
    setLocked(enabled)
    if (enabled) void unlock()
  }, [ready, enabled, unlock])

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now()
      if (state === 'active') {
        if (shouldLock(enabled, backgroundedAt.current, Date.now())) {
          setLocked(true)
          void unlock()
        }
        backgroundedAt.current = null
      }
    })
    return () => subscription.remove()
  }, [enabled, unlock])

  if (!ready || locked === null) return null
  if (!locked) return <>{children}</>
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background.default, padding: theme.space(3), gap: theme.space(2) }]}>
      <Text variant="title">{mobileBrandName()}</Text>
      <Text tone="secondary">Unlock to continue.</Text>
      <Button title="Unlock" onPress={() => void unlock()} />
      <Button title="Sign out" variant="text" onPress={() => void signOut()} />
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center' },
})

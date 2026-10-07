/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Push notifications in the Aglyn app (AGL-3620).
 *
 * Registration: once signed in on a real device, the app asks for
 * permission, gets its Expo push token and writes `users/{uid}/devices/{id}`
 * (owner-only rules, the registry's own fields). Sign-out removes the row
 * first, so a shared phone stops buzzing for the person who left.
 *
 * Taps: a push carries the notification's console link; the app opens it the
 * way it opens a feed row, natively when a plugin registered a deep link for
 * it and in the console WebView otherwise.
 *
 * Inert without an EAS project id (`EAS_PROJECT_ID` at build time), which
 * Expo needs to mint a token, and on a simulator, which has no push token.
 */

import {
  isExpoPushToken,
  MOBILE_DEVICES_COLLECTION,
  readMobilePushData,
  type MobileDeviceApp,
} from '@aglyn/aglyn/app-utils/mobile-push'
import { getMobileFirebase, onBeforeSignOut } from '@aglyn/mobile-core'
import { getMobileDeepLinks, resolveMobileLink } from '@aglyn/mobile-plugin-host'
import AsyncStorage from '@react-native-async-storage/async-storage'
import Constants from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { useEffect } from 'react'
import { Platform } from 'react-native'
import { APP_VERSION } from '../config'
import { navigationRef, openConsolePath, openPluginScreen } from './navigation-ref'

const INSTALL_ID_KEY = 'aglyn.installId'
const APP: MobileDeviceApp = 'aglyn'

/** A stable id for this install: the device row's document id. */
export async function installId(storage = AsyncStorage): Promise<string> {
  const stored = await storage.getItem(INSTALL_ID_KEY)
  if (stored) return stored
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`
  await storage.setItem(INSTALL_ID_KEY, id)
  return id
}

function easProjectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? null
}

/** The token, or null when this install cannot or may not be pushed to. */
async function pushToken(): Promise<string | null> {
  const projectId = easProjectId()
  if (!projectId || !Device.isDevice) return null
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.HIGH,
    })
  }
  let { status } = await Notifications.getPermissionsAsync()
  if (status === 'undetermined') status = (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return null
  const { data } = await Notifications.getExpoPushTokenAsync({ projectId })
  return isExpoPushToken(data) ? data : null
}

/** Writes (or refreshes) this install's device row. Never throws. */
export async function registerDevice(uid: string): Promise<boolean> {
  try {
    const token = await pushToken()
    if (!token) return false
    const { firestore } = getMobileFirebase()
    await setDoc(doc(firestore, 'users', uid, MOBILE_DEVICES_COLLECTION, await installId()), {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      app: APP,
      appVersion: APP_VERSION.slice(0, 32),
      lastSeen: serverTimestamp(),
    })
    return true
  } catch {
    return false
  }
}

/** Resolves once navigation can take a route (a cold launch from a tap), or after `timeoutMs`. */
function navigationReady(timeoutMs = 5000): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now()
    const poll = () => {
      if (navigationRef.isReady()) return resolve(true)
      if (Date.now() - started > timeoutMs) return resolve(false)
      setTimeout(poll, 100)
    }
    poll()
  })
}

/** Opens what a tapped push points at. */
export async function openPushTarget(data: unknown): Promise<void> {
  const push = readMobilePushData(data)
  if (!push?.link) return
  const target = resolveMobileLink(push.link, getMobileDeepLinks())
  if (!target || !(await navigationReady())) return
  if (target.kind === 'screen') openPluginScreen(target.screen, target.params)
  else openConsolePath(target.path)
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

/** Registers this install for the signed-in member and routes taps. */
export function usePushNotifications(uid: string): void {
  useEffect(() => {
    void registerDevice(uid)
    const removeOnSignOut = onBeforeSignOut(async () => {
      const { firestore } = getMobileFirebase()
      await deleteDoc(doc(firestore, 'users', uid, MOBILE_DEVICES_COLLECTION, await installId())).catch(
        () => undefined,
      )
    })
    // A tap that launched the app, then every tap while it runs.
    Notifications.getLastNotificationResponseAsync()
      .then((response) => (response ? openPushTarget(response.notification.request.content.data) : undefined))
      .catch(() => undefined)
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void openPushTarget(response.notification.request.content.data)
    })
    return () => {
      removeOnSignOut()
      subscription.remove()
    }
  }, [uid])
}

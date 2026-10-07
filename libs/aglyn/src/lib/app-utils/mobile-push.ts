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
 * The mobile push channel's shapes (AGL-3620), for the server fan-out and the
 * mobile apps alike.
 *
 * NO IMPORTS, not even types, on purpose: the native apps compile this file
 * with their own compiler, and a type import would drag the core's whole
 * type graph into it. The full per-scope resolution lives in
 * `notification-push.ts`, which the server reads; the app needs only the
 * account scope its settings screen edits, `accountPushSwitch` below, which
 * a spec holds to the full resolver.
 */

/** `users/{uid}/devices/{installId}`: one row per app install, written by its owner. */
export const MOBILE_DEVICES_COLLECTION = 'devices'

export type MobileDevicePlatform = 'ios' | 'android'

/** The two native apps (bundle `com.aglyn.app` and `com.aglyn.pos`). */
export type MobileDeviceApp = 'aglyn' | 'aglyn-pos'

export interface MobileDevice {
  /** An Expo push token, `ExponentPushToken[…]`. */
  token: string
  platform: MobileDevicePlatform
  app: MobileDeviceApp
  appVersion?: string
  /** Server time of the app's last launch while signed in. */
  lastSeen?: unknown
}

/** A device not seen for this long is not pushed to (and is pruned by the fan-out). */
export const MOBILE_DEVICE_STALE_MS = 60 * 24 * 60 * 60 * 1000

/** The most devices one person's push fan-out reads. */
export const MOBILE_DEVICES_PER_USER = 20

const EXPO_PUSH_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{8,128}\]$/

export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && EXPO_PUSH_TOKEN.test(value)
}

/**
 * What a push carries for the app to act on when it is tapped. The app
 * resolves `link` the way it resolves a feed row: natively when a plugin
 * registered a deep link for it, else in the console WebView.
 */
export interface MobilePushData {
  type: string
  link?: string
  orgId?: string
  hostId?: string
}

export function mobilePushData(payload: {
  type: string
  link?: string | null
  orgId?: string | null
  hostId?: string | null
}): MobilePushData {
  return {
    type: payload.type,
    ...(payload.link ? { link: payload.link } : {}),
    ...(payload.orgId ? { orgId: payload.orgId } : {}),
    ...(payload.hostId ? { hostId: payload.hostId } : {}),
  }
}

/** Read a tapped push's data back, refusing anything that is not ours. */
export function readMobilePushData(data: unknown): MobilePushData | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  if (typeof record['type'] !== 'string' || !record['type']) return null
  const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
  const link = text(record['link'])
  return mobilePushData({
    type: record['type'],
    // Only a console path or an https URL; never a scheme the app would hand to the OS.
    link: link && (link.startsWith('/') || link.startsWith('https://')) ? link : undefined,
    orgId: text(record['orgId']),
    hostId: text(record['hostId']),
  })
}

type ChannelAnswers = { console?: boolean; push?: boolean } | undefined

/** The account-scope slice of `NotificationSettings` the app's switch reads. */
export interface AccountPushSettings {
  account?: Record<string, ChannelAnswers>
  accountTypes?: Record<string, ChannelAnswers>
}

/**
 * What the app's per-type push switch shows: the account's push answer for
 * the type, then for its category, and otherwise what the console feed does
 * for it at the account scope (its console answers, the legacy category
 * mute, then `consoleDefault`, the type's console default from the catalog).
 * Equal to `notificationPushEnabled` with no scope; a spec holds the two
 * together.
 */
export function accountPushSwitch(
  settings: AccountPushSettings | null | undefined,
  type: string,
  category: string,
  consoleDefault: boolean,
  legacyPrefs?: Record<string, boolean> | null,
): boolean {
  for (const answer of [settings?.accountTypes?.[type]?.push, settings?.account?.[category]?.push]) {
    if (typeof answer === 'boolean') return answer
  }
  for (const answer of [settings?.accountTypes?.[type]?.console, settings?.account?.[category]?.console]) {
    if (typeof answer === 'boolean') return answer
  }
  if (legacyPrefs?.[category] === false) return false
  return consoleDefault
}

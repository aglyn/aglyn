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

import {
  accountPushSwitch,
  isApnsDeviceToken,
  isExpoPushToken,
  isFcmRegistrationToken,
  isMobilePushToken,
  MOBILE_APP_BUNDLES,
  mobilePushData,
  notificationPushEnabled,
  readMobilePushData,
} from './notification-push'
import {
  NOTIFICATION_TYPE_LABELS,
  notificationCategory,
  notificationTypeChannelDefault,
  type NotificationSettings,
} from './notifications'

describe('the mobile push channel (AGL-3620)', () => {
  const scope = { orgId: 'org-1', hostId: 'host-1' }

  it('follows the console feed when push was never answered', () => {
    expect(notificationPushEnabled(undefined, 'content.order', scope)).toBe(true)
    expect(
      notificationPushEnabled({ account: { content: { console: false } } }, 'content.order', scope),
    ).toBe(false)
    expect(notificationPushEnabled(undefined, 'content.order', scope, { content: false })).toBe(false)
  })

  it('takes the narrowest push answer, type before category', () => {
    const settings = {
      account: { content: { push: false } },
      accountTypes: { 'content.order': { push: true } },
      hosts: { 'host-1': { content: { push: false } } },
    }
    expect(notificationPushEnabled(settings, 'content.order', scope)).toBe(false)
    expect(notificationPushEnabled(settings, 'content.order', { orgId: 'org-1' })).toBe(true)
    expect(notificationPushEnabled(settings, 'content.booking', { orgId: 'org-1' })).toBe(false)
  })

  it('never narrows a staff notification by the workspace it mentions', () => {
    const settings = { orgs: { 'org-1': { staff: { push: false } } } }
    expect(notificationPushEnabled(settings, 'staff.subscriptionStarted', scope)).toBe(true)
  })

  it('holds each transport to its own token, as the device rules do', () => {
    const apns = 'a1b2c3d4'.repeat(8)
    expect(isApnsDeviceToken(apns)).toBe(true)
    expect(isApnsDeviceToken('F'.repeat(200))).toBe(true)
    expect(isApnsDeviceToken('a'.repeat(63))).toBe(false)
    expect(isApnsDeviceToken('a'.repeat(201))).toBe(false)
    expect(isApnsDeviceToken('z'.repeat(64))).toBe(false)
    const fcm = `dQw4w9WgXcQ:APA91b${'Fz_-0aZ'.repeat(20)}`
    expect(isFcmRegistrationToken(fcm)).toBe(true)
    expect(isFcmRegistrationToken('a'.repeat(4096))).toBe(true)
    expect(isFcmRegistrationToken('a'.repeat(99))).toBe(false)
    expect(isFcmRegistrationToken('a'.repeat(4097))).toBe(false)
    expect(isFcmRegistrationToken(`${fcm}!`)).toBe(false)
    expect(isMobilePushToken('apns', apns)).toBe(true)
    expect(isMobilePushToken('fcm', apns)).toBe(false)
    expect(isMobilePushToken('expo', 'ExponentPushToken[abcdefgh1234]')).toBe(false)
    expect(isMobilePushToken(undefined, apns)).toBe(false)
    expect(MOBILE_APP_BUNDLES).toEqual({ aglyn: 'com.aglyn.app', 'aglyn-pos': 'com.aglyn.pos' })
  })

  it('recognizes only Expo push tokens', () => {
    expect(isExpoPushToken('ExponentPushToken[abcdefgh1234]')).toBe(true)
    expect(isExpoPushToken('ExpoPushToken[abcdefgh1234]')).toBe(true)
    expect(isExpoPushToken('abcdefgh1234')).toBe(false)
    expect(isExpoPushToken('ExponentPushToken[]')).toBe(false)
    expect(isExpoPushToken(42)).toBe(false)
  })

  it('round-trips the data a tap acts on, and refuses a link the app must not open', () => {
    const data = mobilePushData({ type: 'content.order', link: '/acme/orders', orgId: 'org-1', hostId: null })
    expect(data).toEqual({ type: 'content.order', link: '/acme/orders', orgId: 'org-1' })
    expect(readMobilePushData(data)).toEqual(data)
    expect(readMobilePushData({ type: 'content.order', link: 'javascript:alert(1)' })).toEqual({
      type: 'content.order',
    })
    expect(readMobilePushData({ link: '/x' })).toBeNull()
    expect(readMobilePushData('nope')).toBeNull()
  })

  it('the app’s account switch says what the full resolver says, for every type', () => {
    const answers = [undefined, true, false]
    const cases: Array<{ settings: NotificationSettings; legacy: Record<string, boolean> | null }> = []
    for (const typePush of answers)
      for (const categoryPush of answers)
        for (const categoryConsole of answers)
          for (const legacyMute of [false, true]) {
            cases.push({
              settings: {
                accountTypes: typePush === undefined ? {} : { 'content.order': { push: typePush } },
                account: {
                  content: {
                    ...(categoryPush === undefined ? {} : { push: categoryPush }),
                    ...(categoryConsole === undefined ? {} : { console: categoryConsole }),
                  },
                },
              } as NotificationSettings,
              legacy: legacyMute ? { content: false } : null,
            })
          }
    for (const type of Object.keys(NOTIFICATION_TYPE_LABELS)) {
      const category = notificationCategory(type)
      const consoleDefault = notificationTypeChannelDefault(type, 'console')
      for (const { settings, legacy } of cases) {
        expect([type, accountPushSwitch(settings, type, category, consoleDefault, legacy)]).toEqual([
          type,
          notificationPushEnabled(settings, type, undefined, legacy),
        ])
      }
    }
  })
})

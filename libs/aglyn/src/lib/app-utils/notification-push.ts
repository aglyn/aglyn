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
 * The mobile push channel (AGL-3620): the per-person, per-type answer for
 * whether a notification is pushed, beside the shapes in `mobile-push.ts`.
 *
 * Server-side: the notification fan-out reads it. The native apps import
 * `mobile-push.ts` alone, and no web client file reaches either.
 */

import {
  notificationCategory,
  notificationChannelEnabled,
  STAFF_NOTIFICATION_CATEGORIES,
  type AglynNotificationType,
  type NotificationChannelPrefs,
  type NotificationSettings,
} from './notifications'

export * from './mobile-push'

/**
 * Whether a notification is pushed to this person's devices.
 *
 * The same layers as `notificationChannelEnabled`, narrowest first and type
 * before category, read for the `push` key. When no layer answers, push
 * FOLLOWS THE CONSOLE FEED: a person who muted a category in the feed is not
 * buzzed for it either, and one who never touched push hears what their feed
 * shows. That is why push needs no per-category default of its own.
 */
export function notificationPushEnabled(
  settings: NotificationSettings | null | undefined,
  type: AglynNotificationType | string,
  scope?: { orgId?: string | null; hostId?: string | null },
  legacyPrefs?: Record<string, boolean> | null,
): boolean {
  const category = notificationCategory(type)
  const key = type as AglynNotificationType
  const layers: Array<NotificationChannelPrefs | undefined> = STAFF_NOTIFICATION_CATEGORIES.has(category)
    ? [settings?.accountTypes?.[key], settings?.account?.[category]]
    : [
        scope?.hostId ? settings?.hostTypes?.[scope.hostId]?.[key] : undefined,
        scope?.hostId ? settings?.hosts?.[scope.hostId]?.[category] : undefined,
        scope?.orgId ? settings?.orgTypes?.[scope.orgId]?.[key] : undefined,
        scope?.orgId ? settings?.orgs?.[scope.orgId]?.[category] : undefined,
        settings?.accountTypes?.[key],
        settings?.account?.[category],
      ]
  for (const layer of layers) {
    const answer = layer?.push
    if (typeof answer === 'boolean') return answer
  }
  return notificationChannelEnabled(settings, 'console', type, scope, legacyPrefs)
}

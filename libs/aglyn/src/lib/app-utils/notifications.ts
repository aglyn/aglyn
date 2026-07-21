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

import type { ITimestamp } from '@aglyn/shared-util-timestamp'

/**
 * In-app notifications (AGL-259): per-user docs at
 * `users/{uid}/notifications/{id}`, written by the Admin SDK (emitters in
 * the API routes + the `notifyAdmins` automation step) and read/marked by
 * their owner. Types follow the common SaaS taxonomy so the console can
 * icon/group them without a registry.
 */
export type AglynNotificationType =
  | 'billing.invoice'
  | 'billing.paymentFailed'
  | 'billing.usage'
  | 'team.invite'
  | 'team.roleChanged'
  | 'team.hostAccessGranted'
  | 'content.formSubmission'
  | 'content.booking'
  | 'content.order'
  | 'content.lowStock'
  // Marketplace review verdicts (AGL-432/653).
  | 'community.review'
  | 'system.announcement'

export interface AglynNotification {
  $id?: string
  type: AglynNotificationType
  title: string
  body?: string
  /** Console path the notification opens (e.g. a host inbox). */
  link?: string
  orgId?: string
  hostId?: string
  createdAt?: ITimestamp
  /** Set by the owner when read; unread while absent. */
  readAt?: ITimestamp | null
}

export const NOTIFICATION_TYPE_LABELS: Record<AglynNotificationType, string> =
  {
    'billing.invoice': 'Invoice available',
    'billing.paymentFailed': 'Payment failed',
    'billing.usage': 'Usage threshold',
    'team.invite': 'Team invite',
    'team.roleChanged': 'Role changed',
    'team.hostAccessGranted': 'Site access granted',
    'content.formSubmission': 'Form submission',
    'content.booking': 'New booking',
    'content.order': 'New order',
    'content.lowStock': 'Low stock',
    'community.review': 'Listing review',
    'system.announcement': 'Announcement',
  }

/** Preference buckets (AGL-267): the prefix before the dot. */
export type NotificationCategory =
  | 'billing'
  | 'team'
  | 'content'
  | 'community'
  | 'system'

export const NOTIFICATION_CATEGORY_LABELS: Record<
  NotificationCategory,
  string
> = {
  billing: 'Billing',
  team: 'Team & access',
  content: 'Forms & bookings',
  community: 'Marketplace',
  system: 'Product & system',
}

export function notificationCategory(
  type: AglynNotificationType | string,
): NotificationCategory {
  const prefix = String(type).split('.')[0]
  return (
    ['billing', 'team', 'content', 'community', 'system'].includes(prefix)
      ? prefix
      : 'system'
  ) as NotificationCategory
}

/**
 * Per-user mute map stored at `users/{uid}.notificationPrefs`
 * (`{ [category]: false }` mutes); absent categories stay on.
 */
export function notificationMuted(
  prefs: Record<string, boolean> | null | undefined,
  type: AglynNotificationType | string,
): boolean {
  return prefs?.[notificationCategory(type)] === false
}

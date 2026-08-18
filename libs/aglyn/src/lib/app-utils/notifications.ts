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
  | 'marketplace.review'
  // Support desk, staff audience (AGL-850): a subscriber opened or replied to
  // a ticket. Fanned out to staff-claim holders, not org members.
  | 'support.ticketOpened'
  | 'support.ticketReply'
  | 'system.announcement'
  // A live plugin version stopped passing the static verifier (AGL-1086).
  // Staff audience: bytes we told workspaces were checked now fail checks
  // that did not exist when they were approved.
  //
  // Deliberately NOT under `marketplace.` (AGL-1088). Category is the prefix,
  // categories are mutable per user, and Marketplace is the category a staff
  // member mutes to stop routine listing-review chatter — which would drop
  // this alert as collateral. `system` is the bucket nobody mutes to reduce
  // noise. The adminAudit record survives a mute either way; the timeliness
  // does not, and timeliness is the whole point of the alert.
  | 'system.pluginVerifierRegression'
  // A sign-in method was removed from the user's own account because their
  // organization turned on SSO enforcement (AGL-1129). `system.`, not
  // `team.`, for the AGL-1088 reason above: `team` is the category someone
  // mutes to stop routine roster chatter, and "the way you sign in just
  // changed" is not chatter — the next sign-in fails without it.
  | 'system.signInMethodRemoved'
  // Documents in a scoped collection carrying no `visibleTo` (AGL-1478).
  // Staff audience: the weekly dry run found resources that are invisible
  // to every site-scoped read, which always means a creation path forgot
  // the field. `system.` for the AGL-1088 reason above, and because the
  // collection it names may be `marketplace`-adjacent or not.
  | 'system.scopeDrift'
  // A site hit the per-month form-submission abuse ceiling and further
  // submissions are being refused (AGL-1655). `system.`, not `content.`, for
  // the AGL-1088 reason above and more sharply than any of them: `content` is
  // literally the category a site owner mutes to stop routine form-submission
  // chatter, and this is the one form notification that says the form has
  // STOPPED accepting. Filing it under the muted bucket would guarantee it
  // reaches nobody on exactly the sites busy enough to trip it.
  | 'system.formSubmissionsPaused'
  // An outsider reported one of our sites for phishing, malware or CSAM
  // (AGL-1964). `system` for the AGL-1088 reason and, again, more sharply
  // than most: this notification goes to STAFF, not to a customer, and its
  // subject is somebody else's site. There is no bucket a recipient could
  // mute it into that would be honest — nobody has opted into being told a
  // stranger is being phished through our platform, and nobody should be able
  // to opt out of it either.
  //
  // Only the urgent categories raise one, and only on a first report. See the
  // fan-out in apps/tenant/app/api/report-abuse/route.ts for why: a flood of
  // alerts IS the flood, and the alert it would cost us is the phishing one.
  | 'system.abuseReportUrgent'

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
    'marketplace.review': 'Listing review',

    'support.ticketOpened': 'New support ticket',
    'support.ticketReply': 'Support ticket reply',
    'system.announcement': 'Announcement',
    'system.pluginVerifierRegression': 'Plugin verifier regression',
    'system.signInMethodRemoved': 'Sign-in method removed',
    'system.scopeDrift': 'Resources missing a sharing scope',
    'system.formSubmissionsPaused': 'Form submissions paused',
    'system.abuseReportUrgent': 'Urgent abuse report',
  }

/** Preference buckets (AGL-267): the prefix before the dot. */
export type NotificationCategory =
  | 'billing'
  | 'team'
  | 'content'
  | 'marketplace'
  | 'support'
  | 'system'

export const NOTIFICATION_CATEGORY_LABELS: Record<
  NotificationCategory,
  string
> = {
  billing: 'Billing',
  team: 'Team & access',
  content: 'Forms & bookings',
  marketplace: 'Marketplace',
  support: 'Support',
  system: 'Product & system',
}

export function notificationCategory(
  type: AglynNotificationType | string,
): NotificationCategory {
  const prefix = String(type).split('.')[0]
  return (
    ['billing', 'team', 'content', 'marketplace', 'support', 'system'].includes(
      prefix,
    )
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

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

import { notificationCategory } from '@aglyn/aglyn/app-utils/notifications'

// Lives beside the notification model now (AGL-3367), where the email copy of
// a notification rewrites its link the same way the console does when the
// link is followed. Re-exported so this stays the console's one import path.
export { normalizeNotificationLink } from '@aglyn/aglyn/app-utils/notifications'

/**
 * Which org slug a notification's link should be rewritten against
 * (AGL-1773).
 *
 * Both notification surfaces used to inline this as
 * `notification.orgId ? slugByOrgId.get(...) : null ?? currentOrgSlug`, and
 * host notifications carry no `orgId` — so the fallback always won and every
 * host link was rewritten against whatever workspace the reader had open. A
 * manager in two workspaces got `/{wrong-org}/hosts/{subdomain}/…`, which
 * `HostGuard` 404s: it resolves subdomains inside the current org only.
 *
 * Three sources, most specific first:
 * 1. the notification's own `orgId` — stamped by the emitter;
 * 2. `hostIndex.orgId` for its host — resolved at follow time, so it repairs
 *    notifications written before the emitters stamped anything;
 * 3. the open workspace — right for the single-workspace majority, and no
 *    worse than the stored link when it is wrong.
 *
 * (1) and (2) are both mapped through `slugForOrgId`, which only knows orgs
 * the reader belongs to: an id that resolves to no slug falls through rather
 * than being spliced into a path as an id.
 */
export function resolveNotificationOrgSlug(
  notification: { orgId?: string | null },
  context: {
    /** Slug of an org the signed-in user belongs to, or undefined. */
    slugForOrgId: (orgId: string) => string | undefined
    /** `hostIndex.orgId` for the notification's host, once resolved. */
    indexedOrgId?: string | null
    /** The workspace currently open in the console. */
    currentOrgSlug?: string | null
  },
): string | undefined {
  const { slugForOrgId, indexedOrgId, currentOrgSlug } = context
  const stamped = notification.orgId
    ? slugForOrgId(notification.orgId)
    : undefined
  const indexed = indexedOrgId ? slugForOrgId(indexedOrgId) : undefined
  return stamped ?? indexed ?? currentOrgSlug ?? undefined
}

/**
 * What a notification is ABOUT, for the feed's Workspace column (AGL-3249).
 *
 * ⛔ NOT {@link resolveNotificationOrgSlug}, though it walks the same two
 * sources. That one ends at the workspace currently open, which is the right
 * answer for a link — a stored path has to be rewritten against something,
 * and the open workspace is no worse than leaving it broken. As TEXT the same
 * fallback is a lie: a row that recorded no org would print whichever
 * workspace the reader happened to have open, and print a different one after
 * they switched. That is AGL-1773 returning as a column.
 *
 * So this one stops where the evidence stops, and `unknown` is a real answer
 * rather than a failure — most of the stored backlog predates the emitters
 * stamping `orgId` at all.
 *
 * Staff rows are settled before either source is consulted: `staff.*` is
 * about the platform, and AGL-3225's two types are emitted with no `orgId`
 * precisely because no workspace owns them.
 */
export type NotificationWorkspace =
  | { kind: 'staff' }
  | { kind: 'workspace'; label: string }
  | { kind: 'unknown' }

export function resolveNotificationWorkspace(
  notification: { type?: string | null; orgId?: string | null },
  context: {
    /** Display name of an org the signed-in user belongs to, or undefined. */
    nameForOrgId: (orgId: string) => string | undefined
    /** `hostIndex.orgId` for the notification's host, once resolved. */
    indexedOrgId?: string | null
  },
): NotificationWorkspace {
  if (notification.type && notificationCategory(notification.type) === 'staff') {
    return { kind: 'staff' }
  }
  const { nameForOrgId, indexedOrgId } = context
  const stamped = notification.orgId
    ? nameForOrgId(notification.orgId)
    : undefined
  // The host's owning org, which repairs the backlog written before the
  // emitters stamped anything — the same second source the link resolver has.
  const indexed = indexedOrgId ? nameForOrgId(indexedOrgId) : undefined
  const label = stamped ?? indexed
  return label ? { kind: 'workspace', label } : { kind: 'unknown' }
}

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

import { buildRoute, Route } from '../constants/route-links'

/**
 * Rewrites a stored notification link onto the current URL scheme (AGL-644).
 *
 * A notification's `link` is frozen at write time — `notifyUsers` persists
 * whatever string the emitter passed and never normalizes it. So every
 * notification written before the org-slug migration (AGL-621) and the
 * subdomain migration (AGL-622) still points at a route that no longer
 * exists, and fixing the emitters alone would leave that whole backlog dead.
 * Normalizing when the link is FOLLOWED repairs old and new alike, and keeps
 * working for emitters that haven't been migrated yet.
 *
 * Rewrites, in order:
 * - `/{hostDocId}` or `/{hostDocId}/rest` → `/{orgSlug}/hosts/{subdomain}/rest`
 * - `/org` or `/org/rest`                 → `/{orgSlug}/rest`
 * - `/hosts` (exactly)                    → `/{orgSlug}/hosts`
 *
 * Anything already canonical, user-scoped (`/manage/...`), staff (`/admin/...`)
 * or absolute is returned untouched. Every rewrite is gated on having the
 * context it needs, so an unresolvable link degrades to its stored value
 * rather than to a wrong destination.
 *
 * The host rewrite is keyed on the notification's own `hostId` rather than
 * guessing from the path shape, so it can never mistake a real first segment
 * for a doc id.
 */
export function normalizeNotificationLink(
  link: string | undefined | null,
  context: {
    orgSlug?: string | null
    /** The notification's `hostId` (a Firestore doc id). */
    hostId?: string | null
    /** That host's subdomain, which the current routes are keyed by. */
    hostSubdomain?: string | null
  },
): string | undefined {
  if (!link) return undefined
  // Absolute URLs (staff broadcasts can carry them) are not ours to rewrite.
  if (!link.startsWith('/')) return link

  const { orgSlug, hostId, hostSubdomain } = context

  if (orgSlug && hostId && hostSubdomain) {
    const prefix = `/${hostId}`
    if (link === prefix || link.startsWith(`${prefix}/`)) {
      return `${buildRoute(Route.HOST_DASHBOARD, {
        orgSlug,
        host: hostSubdomain,
      })}${link.slice(prefix.length)}`
    }
  }

  if (orgSlug) {
    if (link === '/org' || link.startsWith('/org/')) {
      return `${buildRoute(Route.ORG_HOME, { orgSlug })}${link.slice(
        '/org'.length,
      )}`
    }
    // Only the bare list — `/hosts/{docId}` would still need a subdomain, and
    // guessing one is worse than leaving the link alone.
    if (link === '/hosts') return buildRoute(Route.HOST_LIST, { orgSlug })
  }

  return link
}

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

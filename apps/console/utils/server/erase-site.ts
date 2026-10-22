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

import { consentGroupSiteHold } from '@aglyn/aglyn/app-utils/consent-groups'
import type { PluginSiteEraser } from '@aglyn/aglyn/plugin-manager/plugin-site-erase'
import { eraseHost, firebaseAdmin, logOrgActivity } from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { teardownSendingDomain } from './provision-sending-domain'
import { dropDeletedSiteCache } from './tenant-revalidate'

/** The site document as the caller read it, before anything was erased. */
export interface ErasedSiteSnapshot {
  id: string
  get: (field: string) => unknown
}

export interface EraseSiteRecord {
  /** Who the workspace's feed names; `uid: null` for a removal nobody performed. */
  actor: { uid: string | null; email?: string | null }
  /** The feed's words for it: "Deleted a site". */
  activity: string
  /** The staff audit's actor: the member's uid, or a `system:` name. */
  auditActorUid: string
  /** Why, on the audit row, for a removal nobody asked for. */
  auditReason?: string
}

/**
 * Deletes one site and records it (AGL-488, AGL-3936): the delete route's
 * whole path after its checks, shared with `core.site-erase` so a server
 * removal is never a partial one.
 *
 * Authorization, the lockdown verdict and the consent-group hold are the
 * caller's. `eraseHost` refuses a grouped site on its own as well, and throws
 * `SiteInConsentGroupError` having destroyed nothing.
 */
export async function eraseSiteAndRecord(
  hostSnapshot: ErasedSiteSnapshot,
  record: EraseSiteRecord,
): Promise<void> {
  const hostId = hostSnapshot.id
  /*==========================================
   * READ BEFORE THE ERASE, LOG AFTER IT (AGL-118).
   *
   * Both halves of that are forced, and by different things.
   *
   * READ FIRST because `eraseHost` drops the site's entry from the owning
   * org's `hosts` map, so `getOrgForHost` answers null the moment it
   * returns — an entry composed afterwards has no workspace to be filed
   * under and no name to call the site. Taken off the snapshot the caller
   * already holds, so it costs no read.
   *
   * LOG AFTER because an entry written first would be a claim about a
   * deletion that had not happened yet, and `eraseHost` can throw — the
   * route's catch answers 500 and the site is still there. The audit trail
   * must not be the one place that says otherwise.
   *=========================================*/
  const owningOrgId = hostSnapshot.get('orgId') as string | undefined
  const deletedName = (hostSnapshot.get('displayName') as string | undefined) ?? hostId

  /*==========================================
   * THE SENDING DOMAIN GOES WITH THE SITE, AND `eraseHost` OWNS THAT NOW.
   *
   * The ordering lives in `eraseHost`, which every erasure shares, and this
   * app's part is the one thing it has that a library cannot: the
   * credentials. `teardownSendingDomain` reads a full-access mail key and a
   * DNS token, neither of which the tenant runtime may hold, so it is passed
   * IN rather than imported by the library.
   *
   * A vendor that refuses does not fail the delete. What is owed is recorded
   * on the label claim and `/api/admin/reap-sending-domains` collects it.
   *=========================================*/
  await eraseHost(hostId, { tearDownSendingDomain: teardownSendingDomain })

  /*==========================================
   * THE LIVE SITE STOPS SERVING NOW, NOT IN AN HOUR (AGL-3386).
   *
   * Its pages are ISR-cached for an hour and its names are cached to its id
   * for as long, so without this a deleted site went on answering from
   * cache for the rest of the window. Dropped from the snapshot read above
   * — the routing map, the subdomain, the custom domain — because the
   * document it came from is gone, and AFTER the erase, because a visitor
   * arriving between a drop and the erase would re-cache the page from
   * documents that still existed. Best effort: the site is deleted either
   * way, and the hour is the backstop.
   *=========================================*/
  await dropDeletedSiteCache(hostSnapshot)

  /*==========================================
   * TO THE ORG'S FEED, NOT THE SITE'S.
   *
   * The site's own log is `hosts/{hostId}/activity`, which is inside the
   * tree `eraseHost` just recursive-deleted. An entry there would be written
   * into a document path that no longer exists, resurrecting a fragment of a
   * site that was destroyed — and no reader would ever see it.
   *
   * A destroyed site's last event therefore belongs to the workspace that
   * owned it, which is also where somebody asking "where did our site go"
   * is looking. An orphaned host names no workspace, and there is no honest
   * feed to file it under; the `adminAudit` row below still records it for
   * staff.
   *=========================================*/
  if (owningOrgId) {
    await logOrgActivity(owningOrgId, record.actor, record.activity, {
      type: 'host',
      id: hostId,
      name: deletedName,
    })
  }

  await addAdminAudit(firebaseAdmin.app().firestore(), {
    actorUid: record.auditActorUid,
    action: 'host.deleted',
    target: `hosts/${hostId}`,
    before: {
      displayName: hostSnapshot.get('displayName') ?? null,
      ...(record.auditReason ? { reason: record.auditReason } : {}),
    },
    at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
  }).catch(() => undefined)
}

/**
 * This app's implementation of `core.site-erase` (AGL-3936), deferred by
 * relative path from `instrumentation.ts` like `consoleSiteCache`.
 *
 * The site is read again here, so a caller's stale view cannot delete a site
 * that moved workspace, and a site its consent group still needs is refused
 * as the delete route refuses it. The removal is nobody's act, so the feed
 * names no actor and the audit names the scheduled job, with the caller's
 * reason.
 */
export const consoleSiteEraser: PluginSiteEraser = {
  erase: async ({ hostId, orgId, activity, reason }) => {
    const firestore = firebaseAdmin.app().firestore()
    const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) return { erased: false, reason: 'missing' }
    if (hostSnapshot.get('orgId') !== orgId) return { erased: false, reason: 'moved' }
    const org = (await firestore.collection('orgs').doc(orgId).get()).data() ?? null
    if (consentGroupSiteHold(org as Record<string, unknown> | null, hostId)) {
      return { erased: false, reason: 'consent-group' }
    }
    await eraseSiteAndRecord(
      { id: hostSnapshot.id, get: (field) => hostSnapshot.get(field) },
      {
        actor: { uid: null },
        activity,
        auditActorUid: 'system:cron',
        auditReason: reason,
      },
    )
    return { erased: true }
  },
}

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
'use client'

import {
  type HostActivityTarget,
  useHostActivityLogger,
} from '@aglyn/tenant-feature-instance'
import { useCallback } from 'react'
import { useCrmApi } from '../components/use-crm-api'
import type { CrmOrgActivityKind } from '../constants/api-routes'
import {
  orgActivityRefusal,
  reportDroppedActivityLine,
} from '../model/crm-activity-report'
import { useCrmOrgMount } from './use-crm-org-mount'

/**
 * A record kind BOTH feeds accept.
 *
 * The org feed also files tasks and the host feed also files screens, and a
 * line that can land in either has to name something both presenters can
 * render as a link. Spelled as the intersection rather than a third hand-
 * written union so a kind added to one side alone cannot silently become a
 * line the other side draws as unknown.
 */
export type CrmActivityKind = Extract<
  CrmOrgActivityKind,
  HostActivityTarget['type']
>

/** What a CRM activity line points at. */
export interface CrmActivityTarget {
  type: CrmActivityKind
  id?: string
  name?: string
}

/**
 * ONE LINE FOR ONE RECORD, IN THE FEED THE ACT BELONGS TO (AGL-2738).
 *
 * A CRM record is org data whichever hub it is edited from, but the feed
 * that holds "who deleted it" is not: under a SITE the line goes into that
 * site's `hosts/{hostId}/activity` client-direct, and at the ORGANIZATION
 * level it goes into `orgs/{orgId}/activity` through `crm/org-activity`,
 * because the org feed is closed to every client by rule.
 *
 * ## The two gates are on different axes, and that is the bug this closes
 *
 * The record write asks `canWriteOrgData()` — an org role of owner, admin
 * or editor, plus the scope tokens. The line asks `canWriteHostContent()`,
 * which resolves a role out of `hosts/{hostId}.memberRoles[uid]` and knows
 * nothing about the org roster. At the org hub the two come apart for
 * members who are genuinely admitted to the hub:
 *
 *  - a pre-`allHosts` member doc reads as org-wide (`isOrgWideMember`) and
 *    projects to NO host role at all (`hostRoleFor` returns null without
 *    `allHosts`), so an editor holding `data.manage` org-wide appears in no
 *    site's `memberRoles`;
 *  - an org editor carrying an explicit `hostAccess` entry of `viewer` on
 *    one site writes the record and cannot write that site's feed;
 *  - a site whose projection never ran, and a SUSPENDED site, refuse the
 *    append while the org-level record write goes through untouched.
 *
 * Each of those used to spend its audit line on a rejected client write
 * that `useHostActivityLogger` swallowed. Widening the rule is not the
 * answer — `cloud/rules-tests/firestore-rules.test.mjs` pins that a viewer
 * cannot forge a line, and adding `activity` to the create exclusion list
 * ends host logging rather than moving it. Routing the org-level line
 * through the org's own door is: `crm/org-activity` authorizes the caller
 * on the ORG, which is the axis the record write was authorized on, and
 * appends with the Admin SDK.
 *
 * ## Which door, decided by the MOUNTED site and not by the record's
 *
 * `hostId` here is the site the surface is mounted under, never the site
 * the record was captured by. A record page at the org hub is handed
 * `null` and posts to the org feed; the lead page, which the hub mounts
 * UNDER a site by address (AGL-2630), is handed that site and keeps
 * writing client-direct exactly as it does on the site's own hub. Falling
 * back to the record's own site is what put an org-level act in front of a
 * site-level gate in the first place.
 *
 * This is the same split `useCrmBulkApply` makes for the bulk bars and the
 * email and stage routes make on the server: the level the act was
 * performed at decides the feed.
 *
 * @param hostId the site the surface is MOUNTED under — `props.hostId`,
 *   which is `null` at the organization hub. Never the record's own
 *   `hostId`.
 */
export function useCrmActivityLogger(hostId: string | null | undefined) {
  const mount = useCrmOrgMount()
  const logHostActivity = useHostActivityLogger(hostId ?? undefined)
  // `null`, because the line is about the org and not about a site: the
  // hook stamps the mount's `orgId` into the body, which is what makes the
  // call the route's org variant.
  const callCrm = useCrmApi(null)
  return useCallback(
    (action: string, target: CrmActivityTarget) => {
      if (hostId || !mount) {
        logHostActivity(action, target)
        return
      }
      void callCrm('org-activity', { action, target })
        .then(({ response, payload }) => {
          if (!response.ok) throw orgActivityRefusal(response.status, payload)
        })
        .catch(reportDroppedActivityLine)
    },
    [hostId, mount, logHostActivity, callCrm],
  )
}

export default useCrmActivityLogger

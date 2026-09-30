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

import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { type CrmSharingObject, type CrmSharingSite, readCrmSharingRules } from '../model/crm-sharing'
import { callCrmSharing, followUpCrmSharing } from '../model/crm-sharing-api'
import { crmTaskCallScope } from '../model/task-routes'
import { useCrmOrgMount } from './use-crm-org-mount'
import type { CrmOrgDoc } from './use-crm-scope'

export interface CrmSharingSites {
  sites: CrmSharingSite[]
  ready: boolean
  /** How a site reads: its name, or a neutral phrase for one this reader cannot name. */
  siteName: (hostId: string) => string
}

/**
 * The org's sites, for a sharing surface (AGL-3336).
 *
 * At the organization level the hub already holds them (`useCrmOrgMount`).
 * Under a site a member cannot list the org's other sites, so a MANAGER's
 * surface asks `crm/sharing` for them — the one reader a share is offered
 * to — and every other reader names them as "another site".
 */
export function useCrmSharingSites(input: {
  hostId: string | null
  orgId: string | null
  enabled: boolean
}): CrmSharingSites {
  const { hostId, orgId, enabled } = input
  const mount = useCrmOrgMount()
  const { data: user } = useUser()
  const [fetched, setFetched] = useState<{ key: string; sites: CrmSharingSite[] } | null>(null)
  const scope = crmTaskCallScope(hostId, orgId)
  const key = scope ? JSON.stringify(scope) : ''
  const fromMount = mount && !hostId
  useEffect(() => {
    if (fromMount || !enabled || !scope || !user) return
    let cancelled = false
    callCrmSharing(user, scope, 'sites')
      .then((answer) => {
        if (!cancelled) setFetched({ key, sites: answer.sites ?? [] })
      })
      .catch(() => {
        if (!cancelled) setFetched({ key, sites: [] })
      })
    return () => {
      cancelled = true
    }
    // `scope` is keyed by `key`; the object itself is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromMount, enabled, key, user])
  const sites = useMemo<CrmSharingSite[]>(
    () =>
      fromMount
        ? mount.hosts.map((host) => ({ id: host.id, name: host.name }))
        : fetched?.key === key
          ? fetched.sites
          : [],
    [fromMount, mount, fetched, key],
  )
  const ready = fromMount ? mount.hostsReady : fetched?.key === key || !enabled
  const siteName = useCallback(
    (id: string) => sites.find((site) => site.id === id)?.name ?? (id === hostId ? 'This site' : 'another site'),
    [sites, hostId],
  )
  return { sites, ready, siteName }
}

/** The org's sharing rules, off the org document the shell already passed. */
export function useCrmSharingRules(org: CrmOrgDoc) {
  return useMemo(
    () => readCrmSharingRules((org ?? null) as Record<string, unknown> | null),
    [org],
  )
}


/**
 * The follow-up a CLIENT-DIRECT write to a lead, a company or a deal owes
 * the org's sharing rules (AGL-3336): a server write is followed by the
 * core's record-written seam, a browser's by this. Fire-and-forget — the
 * save has landed whether or not a rule then shares the record.
 */
export function useCrmSharingFollowUp(
  hostId: string | null | undefined,
  orgId: string | null | undefined,
): (object: CrmSharingObject, ids: readonly string[]) => void {
  const { data: user } = useUser()
  return useCallback(
    (object: CrmSharingObject, ids: readonly string[]) => {
      void followUpCrmSharing(user, crmTaskCallScope(hostId, orgId), object, ids)
    },
    [user, hostId, orgId],
  )
}

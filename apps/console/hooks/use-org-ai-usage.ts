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

import { aiUsageMonthKeys } from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useEffect, useMemo, useState } from 'react'
import type { OrgAiUsageTableWire } from '../utils/ai-usage-wire'

/**
 * Loading, answered, refused, or failed — four states, never three
 * (AGL-2928).
 *
 * `refused` is its own state because three surfaces read this and only one
 * of them is gated on the permission the route checks: the roster and the
 * site collaborators card are open to a member who manages people and may
 * not see billing, and for them a 403 is the ordinary answer — the column
 * renders a dash, not an error. Folding it into `error` would paint a
 * warning on every team page whose admin lacks `billing.view`.
 */
export type OrgAiUsageStatus = 'loading' | 'ready' | 'refused' | 'error'

export interface OrgAiUsageState {
  status: OrgAiUsageStatus
  data: OrgAiUsageTableWire | null
  /** The month the table describes, whether or not it has answered yet. */
  month: string
  /** The months a reader may pick, newest first. */
  months: string[]
  /** Credits by uid for the month — the roster column's join. */
  creditsByUid: Map<string, number>
  /** Credits on the named site by uid, when a site was named. */
  hostCreditsByUid: Map<string, number>
  /** A counter to bump to re-read the month. */
  reload: () => void
}

/**
 * One month of the per-user rollup for one org, through `/api/orgs/ai-usage`.
 *
 * Pass `hostId` to have each row carry its credits on that site. Pass
 * `enabled: false` to hold the read — a card that is not yet sure of its
 * org id, or a viewer the gate has already refused.
 */
export function useOrgAiUsage(
  orgId: string | null | undefined,
  options: { month?: string; hostId?: string; enabled?: boolean } = {},
): OrgAiUsageState {
  const { data: user } = useUser()
  const fallbackMonths = useMemo(() => aiUsageMonthKeys(), [])
  const month = options.month ?? fallbackMonths[0]
  const hostId = options.hostId ?? ''
  const enabled = options.enabled !== false
  const [state, setState] = useState<{
    status: OrgAiUsageStatus
    data: OrgAiUsageTableWire | null
  }>({ status: 'loading', data: null })
  const [epoch, setEpoch] = useState(0)

  useEffect(() => {
    if (!orgId || !user || !enabled) return undefined
    let active = true
    setState((previous) => ({ status: 'loading', data: previous.data }))
    void (async () => {
      try {
        const params = new URLSearchParams({ orgId, month })
        if (hostId) params.set('hostId', hostId)
        const response = await authorizedFetch(
          user,
          `/api/orgs/ai-usage?${params.toString()}`,
        )
        if (!active) return
        if (response.status === 403) {
          setState({ status: 'refused', data: null })
          return
        }
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok || !payload) {
          setState({ status: 'error', data: null })
          return
        }
        setState({ status: 'ready', data: payload as OrgAiUsageTableWire })
      } catch {
        if (active) setState({ status: 'error', data: null })
      }
    })()
    return () => {
      active = false
    }
  }, [orgId, user, enabled, month, hostId, epoch])

  const creditsByUid = useMemo(
    () => new Map((state.data?.rows ?? []).map((row) => [row.uid, row.credits])),
    [state.data],
  )
  const hostCreditsByUid = useMemo(
    () =>
      new Map(
        (state.data?.rows ?? []).map((row) => [row.uid, row.hostCredits ?? 0]),
      ),
    [state.data],
  )

  return {
    status: state.status,
    data: state.data,
    month,
    months: state.data?.months ?? fallbackMonths,
    creditsByUid,
    hostCreditsByUid,
    reload: () => setEpoch((value) => value + 1),
  }
}

export default useOrgAiUsage

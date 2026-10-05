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

import { isUnlimitedQuota, resolveOrgEntitlements } from '@aglyn/aglyn'
import { Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import {
  useFirestore,
  useFirestoreDoc,
} from '@aglyn/tenant-feature-instance'

export interface RunQuotaLineProps {
  /**
   * The site the line sits on, or `null` on the organization's hub. Its own
   * counter is read only when there is no workspace id to read the
   * workspace's by.
   */
  hostId: string | null
  /** The workspace whose runs are reported; defaults to the org doc's `$id`. */
  orgId?: string | null
  /** The resolved org doc, from the plugin shell. */
  org: unknown
  /** Which counter to report. */
  counter: 'workflowRuns' | 'actionRuns'
}

const COUNTER_LABEL = {
  workflowRuns: 'workflow runs',
  actionRuns: 'action runs',
} as const

const COUNTER_LIMIT = {
  workflowRuns: 'workflowRunsPerMonth',
  actionRuns: 'actionRunsPerMonth',
} as const

/**
 * `1,284 runs this month · 500,000 included` (AGL-2171).
 *
 * `/product/workflows`'s run-history mockup puts this line opposite the
 * heading. The only place the product reported it was the Billing page, as
 * `1284 / 500000` — and `actionRunsPerMonth` had **no customer-facing
 * surface at all**, only the staff panel and the usage-alerts route. So
 * the quota that silently stops an automation from running (`runEventActions`
 * returns early once `used + actions.length > limit`) was invisible on the
 * page where a person is looking at their automations.
 *
 * The figure is the WORKSPACE's (AGL-3472): the band is the organization's,
 * and the run gates hold it to every site's runs, counted at
 * `orgs/{orgId}/counters/{counter}`. One site's own count against the whole
 * band would read as headroom the gate has already spent elsewhere. Only a
 * line with no workspace id falls back to the site's counter.
 *
 * Renders NOTHING while the counter or the plan is unresolved, or when the
 * counter cannot be read. `0 runs this month` is what an unread counter looks
 * like, and it is the one reading that makes a customer stop debugging.
 */
export function RunQuotaLine(props: RunQuotaLineProps) {
  const { hostId, org, counter } = props
  const firestore = useFirestore()
  const monthKey = new Date().toISOString().slice(0, 7)
  const orgId =
    props.orgId ?? (org as { $id?: unknown } | null | undefined)?.$id
  const workspaceId = typeof orgId === 'string' && orgId ? orgId : null
  const { data: counterDoc, status } = useFirestoreDoc<Record<string, unknown>>(
    () =>
      workspaceId
        ? doc(firestore, 'orgs', workspaceId, 'counters', counter)
        : hostId
          ? doc(firestore, 'hosts', hostId, 'counters', counter)
          : null,
    [firestore, workspaceId, hostId, counter],
  )
  // A workspace that has never run one has no counter document; that is a
  // settled zero, not a pending read.
  if (status !== 'success') return null
  const limit = (
    resolveOrgEntitlements(org as never) as Record<string, unknown>
  )?.[COUNTER_LIMIT[counter]]
  if (typeof limit !== 'number') return null
  const used = Number(counterDoc?.[monthKey] ?? 0)
  // An unlimited band (an uncapped staff comp, AGL-3049) has no figure to
  // include: `Infinity.toLocaleString()` would print "∞ included".
  return (
    <Typography variant="caption" color="text.secondary">
      {`${used.toLocaleString()} ${COUNTER_LABEL[counter]} this month · ` +
        (isUnlimitedQuota(limit)
          ? 'no monthly limit'
          : `${limit.toLocaleString()} included`)}
    </Typography>
  )
}
RunQuotaLine.displayName = 'RunQuotaLine'

export default RunQuotaLine

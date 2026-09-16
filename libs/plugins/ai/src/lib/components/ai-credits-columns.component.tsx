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

import type { ConsoleWidgetColumnHeaderProps } from '@aglyn/aglyn'
import { TableSortLabel, Tooltip } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { aiUsageMonthLabel } from '../usage/ai-usage-wire'
import { useOrgAiUsage } from './use-org-ai-usage'

/** A roster row as the member tables hand it to a column. */
interface MemberRow {
  $id?: string
  uid?: string
  status?: string
}

/**
 * THE ORG TEAM TABLE'S AI CREDITS COLUMN (AGL-2928): the credits each member
 * drew this month across every site, through the `orgMembersListColumn`
 * zone. Every cell and the header share one read of the month. A reader the
 * route refuses — a manager without `billing.view` — sees a dash in every
 * row, not a warning: the roster is theirs to manage whether or not the
 * spend is theirs to see.
 */
export function AiMemberCreditsHeader(
  props: { orgId?: string } & Partial<ConsoleWidgetColumnHeaderProps>,
) {
  const { orgId, onSort, sorted } = props
  const usage = useOrgAiUsage(orgId)
  const [direction, setDirection] = useState<'desc' | 'asc' | null>(null)
  const onSortRef = useRef(onSort)
  onSortRef.current = onSort
  const compare = useMemo(() => {
    if (!direction || usage.status !== 'ready') return null
    const credits = (row: MemberRow) => usage.creditsByUid.get(String(row?.$id ?? '')) ?? 0
    return direction === 'desc'
      ? (a: MemberRow, b: MemberRow) => credits(b) - credits(a)
      : (a: MemberRow, b: MemberRow) => credits(a) - credits(b)
  }, [direction, usage.status, usage.creditsByUid])
  const compareRef = useRef(compare)
  compareRef.current = compare
  // Keyed on the comparator, which changes only with the direction or the
  // month's answer, so handing it over cannot re-run on every render.
  useEffect(() => {
    onSortRef.current?.(compare as never)
  }, [compare])
  // Another column taking the sort puts this one back to unsorted; a
  // comparator withdrawn while the month re-reads keeps its direction.
  useEffect(() => {
    if (sorted === false && compareRef.current) setDirection(null)
  }, [sorted])
  return (
    <Tooltip
      title={`AI credits each member has drawn in ${aiUsageMonthLabel(usage.month)}, across every site. Open a member for the split by site.`}
    >
      <TableSortLabel
        active={direction !== null}
        direction={direction ?? 'desc'}
        disabled={usage.status !== 'ready'}
        onClick={() =>
          setDirection((current) =>
            current === 'desc' ? 'asc' : current === 'asc' ? null : 'desc',
          )
        }
      >
        {'AI credits (month)'}
      </TableSortLabel>
    </Tooltip>
  )
}
AiMemberCreditsHeader.displayName = 'AiMemberCreditsHeader'

/** One member's credits this month, or a dash until the month is read. */
export function AiMemberCreditsCell(props: { orgId?: string; member?: MemberRow }) {
  const usage = useOrgAiUsage(props.orgId)
  return (
    <>
      {usage.status === 'ready'
        ? (usage.creditsByUid.get(String(props.member?.$id ?? '')) ?? 0).toLocaleString()
        : '—'}
    </>
  )
}
AiMemberCreditsCell.displayName = 'AiMemberCreditsCell'

/**
 * THE SITE COLLABORATORS TABLE'S AI CREDITS COLUMN (AGL-2928): what each
 * collaborator drew ON THIS SITE this month, from the per-member rollup's
 * split by host — so an agency sees which client site's people spend. Not
 * across the workspace, which is the org Team table's column.
 */
export function AiCollaboratorCreditsHeader(props: { orgId?: string; hostId?: string }) {
  const usage = useOrgAiUsage(props.orgId, { hostId: props.hostId })
  return (
    <Tooltip
      title={`AI credits drawn on this site in ${aiUsageMonthLabel(usage.month)}, per collaborator.`}
    >
      <span>{'AI credits (site, month)'}</span>
    </Tooltip>
  )
}
AiCollaboratorCreditsHeader.displayName = 'AiCollaboratorCreditsHeader'

/**
 * One collaborator's credits on this site this month. An invitation not yet
 * accepted has drawn nothing and reads as a dash; the owner's row is a row
 * like any other.
 */
export function AiCollaboratorCreditsCell(props: {
  orgId?: string
  hostId?: string
  member?: MemberRow
}) {
  const usage = useOrgAiUsage(props.orgId, { hostId: props.hostId })
  const member = props.member
  const uid = member?.uid ?? member?.$id
  return (
    <>
      {usage.status === 'ready' && uid && member?.status !== 'invited'
        ? (usage.hostCreditsByUid.get(uid) ?? 0).toLocaleString()
        : '—'}
    </>
  )
}
AiCollaboratorCreditsCell.displayName = 'AiCollaboratorCreditsCell'

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
import { TableSortLabel, Tooltip, Typography } from '@mui/material'
import { useEffect, useMemo, useRef, useState } from 'react'
import { aiUsageMonthLabel } from '../usage/ai-usage-wire'
import {
  aiSpendCell,
  aiSpendRowComparator,
} from '../usage/staff-orgs-ai-spend'
import { useStaffOrgsAiSpend } from './use-staff-orgs-ai-spend'

/**
 * THE STAFF ORGANIZATIONS LIST'S AI SPEND COLUMN (AGL-2984): each org's live
 * provider spend this month, through the `staffOrgsListColumn` zone. The
 * header and every cell on the page share one read of the page's orgs.
 *
 * The header sorts the page by the figures: dearest first, then cheapest
 * first, then back to the list's own order. An unmeasured org sorts last in
 * both directions — the column is for finding the org that is spending.
 */
export function StaffOrgsAiSpendHeader(
  props: { orgIds?: readonly string[] } & Partial<ConsoleWidgetColumnHeaderProps>,
) {
  const { orgIds, onSort, sorted } = props
  const spend = useStaffOrgsAiSpend(orgIds)
  const [direction, setDirection] = useState<'desc' | 'asc' | null>(null)
  const onSortRef = useRef(onSort)
  onSortRef.current = onSort
  const compare = useMemo(
    () =>
      direction && spend.status === 'ready'
        ? aiSpendRowComparator(spend.spendUsd, direction)
        : null,
    [direction, spend.status, spend.spendUsd],
  )
  const compareRef = useRef(compare)
  compareRef.current = compare
  // Keyed on the comparator, which changes only with the direction or the
  // page's answer, so handing it over cannot re-run on every render.
  useEffect(() => {
    onSortRef.current?.(compare as never)
  }, [compare])
  // Another column taking the sort puts this one back to unsorted; a
  // comparator withdrawn while the page re-reads keeps its direction.
  useEffect(() => {
    if (sorted === false && compareRef.current) setDirection(null)
  }, [sorted])
  return (
    <Tooltip
      title={`Live AI provider spend in ${
        spend.month ? aiUsageMonthLabel(spend.month) : 'the current month'
      }. Organizations with nothing recorded this month sort last.`}
    >
      <TableSortLabel
        active={direction !== null}
        direction={direction ?? 'desc'}
        disabled={spend.status !== 'ready'}
        onClick={() =>
          setDirection((current) =>
            current === 'desc' ? 'asc' : current === 'asc' ? null : 'desc',
          )
        }
      >
        {'AI spend (month)'}
      </TableSortLabel>
    </Tooltip>
  )
}
StaffOrgsAiSpendHeader.displayName = 'StaffOrgsAiSpendHeader'

/**
 * One org's spend this month: `$` and four decimals, or a dash for an org
 * with nothing recorded — and a dash, not a figure, until the page's read
 * has answered.
 */
export function StaffOrgsAiSpendCell(props: {
  orgId?: string
  orgIds?: readonly string[]
}) {
  const { orgId, orgIds } = props
  const spend = useStaffOrgsAiSpend(orgIds ?? (orgId ? [orgId] : null))
  return (
    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
      {spend.status === 'ready' && orgId
        ? aiSpendCell(spend.spendUsd[orgId])
        : '—'}
    </Typography>
  )
}
StaffOrgsAiSpendCell.displayName = 'StaffOrgsAiSpendCell'

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
  type ActivityNames,
  describeStaffAudit,
} from '@aglyn/aglyn/app-utils/activity-labels'
import { AppLink, type HelpTipContent } from '@aglyn/shared-ui-jsx'
import { Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useMemo } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { staffActivityLinks } from '../utils/activity-details'
import ActivityTable from './activity-table.component'
import { type StaffPerson, staffPersonLabel } from './staff-org-summary-card.component'

/** One `adminAudit` row as `/api/admin/org-detail` projects it. */
export interface StaffOrgAuditEntry {
  $id: string
  action: string | null
  target: string | null
  actorUid: string | null
  reason: string | null
  note: string | null
  at: { seconds?: number } | null
  subjectUid?: string | null
  after?: Record<string, unknown> | null
  names?: ActivityNames
}

export interface StaffOrgAdminActionsCardProps {
  /** `null` while loading or when the slice could not be read. */
  entries: StaffOrgAuditEntry[] | null
  /** The org-detail read has settled, so `null` means it failed. */
  ready: boolean
  people: Record<string, StaffPerson>
  help?: HelpTipContent
}

const when = (entry: StaffOrgAuditEntry) =>
  entry.at?.seconds ? new Date(entry.at.seconds * 1000).toLocaleString() : '—'

/**
 * "Recent admin actions on this organization" (AGL-3660).
 *
 * Was a stack of chips printing the stored code (`ai.job.output`) with no
 * target at all. Now the shared table and the shared words: what was done,
 * to which site and item, why, the credits an AI act spent, who and when —
 * and a click opens the shared details dialog, where the code and the path
 * are kept for staff.
 */
export function StaffOrgAdminActionsCard(props: StaffOrgAdminActionsCardProps) {
  const { entries, ready, people, help } = props
  // The slice is at most twenty rows (the route's cap), held whole: one
  // page, so a header sort orders every row the card has, not a window.
  const rows = entries ?? []

  const actorLabel = (entry: StaffOrgAuditEntry): string =>
    (entry.actorUid ? staffPersonLabel(people[entry.actorUid]) : null) ??
    entry.actorUid ??
    '—'

  const columns = useMemo((): GridColDef[] => [
    {
      field: 'action',
      headerName: 'Action',
      flex: 1.4,
      minWidth: 200,
      valueGetter: (_value, row: StaffOrgAuditEntry) => describeStaffAudit(row, row.names).action,
      renderCell: ({ row }: { row: StaffOrgAuditEntry }) => {
        const described = describeStaffAudit(row, row.names)
        return <span title={described.code ?? undefined}>{described.action}</span>
      },
    },
    {
      field: 'target',
      headerName: 'Target',
      flex: 1.2,
      minWidth: 180,
      valueGetter: (_value, row: StaffOrgAuditEntry) => describeStaffAudit(row, row.names).target,
      renderCell: ({ row }: { row: StaffOrgAuditEntry }) => {
        const described = describeStaffAudit(row, row.names)
        return <span title={described.path ?? undefined}>{described.target}</span>
      },
    },
    {
      // WHY the action was taken (AGL-1652): the surface an override is
      // looked at from is the surface the reason has to reach.
      field: 'reason',
      headerName: 'Why',
      flex: 1,
      minWidth: 160,
      valueGetter: (_value, row: StaffOrgAuditEntry) => describeStaffAudit(row, row.names).why ?? '',
      renderCell: ({ row }: { row: StaffOrgAuditEntry }) => {
        const why = describeStaffAudit(row, row.names).why
        if (why) return why
        return row.action === 'org.override' ? (
          <Typography variant="body2" color="warning.main" component="span">
            {'Not recorded — predates the required reason'}
          </Typography>
        ) : (
          '—'
        )
      },
    },
    {
      field: 'actorUid',
      headerName: 'Who',
      flex: 1,
      minWidth: 160,
      valueGetter: (_value, row: StaffOrgAuditEntry) => actorLabel(row),
      // A uid is an account: it links to that account's staff page. A
      // `system:*` actor has none.
      renderCell: ({ row }: { row: StaffOrgAuditEntry }) =>
        row.actorUid && !row.actorUid.includes(':') ? (
          <AppLink
            href={buildRoute(Route.ADMIN_USER_DETAIL, { uid: row.actorUid })}
            underline="hover"
            title={row.actorUid}
            onClick={(event) => event.stopPropagation()}
          >
            {actorLabel(row)}
          </AppLink>
        ) : (
          actorLabel(row)
        ),
    },
    {
      field: 'at',
      headerName: 'When',
      flex: 1,
      minWidth: 170,
      type: 'date',
      valueGetter: (_value, row: StaffOrgAuditEntry) =>
        row.at?.seconds ? new Date(row.at.seconds * 1000) : null,
      renderCell: ({ row }: { row: StaffOrgAuditEntry }) => when(row),
    },
    // `actorLabel` closes over `people`, the only thing that moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [people])

  return (
    <ActivityTable
      header="Recent admin actions on this organization"
      help={help}
      description="Changes recorded in the staff audit log about this organization, newest first. The full record is on the Audit log page."
      columns={columns}
      rows={rows}
      getRowId={(row: StaffOrgAuditEntry) => row.$id}
      loading={!ready}
      unreadable={ready && entries == null}
      unreadableLabel="Could not read the audit slice — a failed read, not an empty history."
      emptyLabel="No audit entries reference this organization in the latest 200."
      page={0}
      pageSize={Math.max(rows.length, 1)}
      count={rows.length}
      onPageChange={() => undefined}
      paginationDisabled
      staff
      details={(row: StaffOrgAuditEntry) => {
        const described = describeStaffAudit(row, row.names)
        return {
          description: described,
          who: actorLabel(row),
          when: when(row),
          links: staffActivityLinks(described),
          staffFields: [
            { label: 'Actor uid', value: row.actorUid ?? '—' },
            { label: 'Entry id', value: row.$id },
          ],
        }
      }}
    />
  )
}
StaffOrgAdminActionsCard.displayName = 'StaffOrgAdminActionsCard'

export default StaffOrgAdminActionsCard

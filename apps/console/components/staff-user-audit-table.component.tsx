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

import { orgOverrideReasonSummary } from '@aglyn/aglyn'
import {
  listPluginActivityFilters,
  pluginStaffAuditActionGroupLabel,
} from '@aglyn/aglyn/plugin-manager/plugin-activity-actions'
import type { AdminAuditKind } from '@aglyn/aglyn/app-utils/admin-audit-index'
import type { HelpTipContent } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListQueryNotices,
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  type ListFilterClause,
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { Chip, Stack } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { useMemo, useState } from 'react'
import { useStaffListQuery } from '../hooks/use-staff-list-query'
import {
  USER_AUDIT_LIST_FIELDS,
  USER_AUDIT_LIST_HEADERS,
  USER_AUDIT_LIST_SELECT_FIELDS,
  type UserAuditRow,
} from '../utils/admin-audit-list-query'
import ActivityTable from './activity-table.component'

export interface StaffUserAuditTableProps {
  uid: string
  /** `change`: what was done by or to the account. `access`: who only looked. */
  kind: AdminAuditKind
  header: string
  help?: HelpTipContent
  description: string
  emptyLabel: string
  filteredLabel: string
}

/**
 * ONE ACCOUNT'S AUDIT TRAIL, SERVED BY ITS QUERY (AGL-3321).
 *
 * The staff account page's two audit tables — changes, and reads of the
 * account's data — each read `/api/admin/users/audit` a page at a time. Every
 * Filters-panel clause (Action, Action group, When) and the search word go
 * onto that route's queries, so a filter reaches the account's whole trail,
 * not the entries a first read happened to fetch; what the query cannot take
 * is said above the table and not applied.
 */
export function StaffUserAuditTable(props: StaffUserAuditTableProps) {
  const { uid, kind, header, help, description, emptyLabel, filteredLabel } = props
  const [clauses, setClauses] = useState<ListFilterClause[]>([])
  const [searchWords, setSearchWords] = useState<string[]>([])
  const gridFilter = useListGridFilter({
    selectFields: USER_AUDIT_LIST_SELECT_FIELDS,
    clauses,
    onChange: setClauses,
    search: { words: searchWords, onChange: setSearchWords },
  })
  const params = useMemo(() => ({ uid, kind }), [uid, kind])
  const audit = useStaffListQuery<UserAuditRow>({
    endpoint: uid ? '/api/admin/users/audit' : null,
    clauses,
    search: searchWords,
    params,
  })

  const options = useMemo(
    (): Record<string, readonly ListFilterOption[]> => ({
      actionGroup: [
        ...new Set([
          ...listPluginActivityFilters().map(({ group }) => group.id),
          ...audit.rows.map((row) => row.actionGroup ?? '').filter(Boolean),
          ...clauses.filter((clause) => clause.field === 'actionGroup').map((clause) => clause.value),
        ]),
      ]
        .sort()
        .map((group) => ({ value: group, label: pluginStaffAuditActionGroupLabel(group) })),
    }),
    [audit.rows, clauses],
  )

  const columns = useMemo((): GridColDef[] => {
    const shown: GridColDef[] = [
      { field: 'action', headerName: 'Action', flex: 1.2, minWidth: 180 },
      { field: 'target', headerName: 'Target', flex: 1.2, minWidth: 180, sortable: false },
      {
        // An `org.override` this account performed shows up here too, so the
        // reason has to reach this table as well (AGL-1652) — the audit page
        // is not the only place the act is read from.
        field: 'reason',
        headerName: 'Why',
        flex: 1,
        minWidth: 160,
        sortable: false,
        valueGetter: (_value: unknown, row: UserAuditRow) =>
          orgOverrideReasonSummary(row.reason, row.note) ?? '—',
      },
      {
        field: 'actorUid',
        headerName: 'Actor',
        flex: 0.9,
        minWidth: 150,
        sortable: false,
        /*
         * "this account" is a real answer, not a placeholder: an entry is
         * either one this account performed or one performed about it, and a
         * bare uid in the second case is the staff member who acted.
         */
        valueGetter: (_value: unknown, row: UserAuditRow) =>
          row.actorUid === uid ? 'this account' : (row.actorUid ?? '—'),
        renderCell: ({ row }: { row: UserAuditRow }) =>
          row.actorUid === uid ? (
            <Chip size="small" variant="outlined" label="this account" />
          ) : (
            (row.actorUid ?? '—')
          ),
      },
      {
        field: 'at',
        headerName: 'When',
        flex: 1,
        minWidth: 180,
        type: 'date',
        sortable: false,
        valueGetter: (_value: unknown, row: UserAuditRow) => (row.at ? new Date(row.at) : null),
        /*
         * A COLLAPSED ROW SAYS SO. The writer merges an immediate repeat of
         * one act onto the row already there, and a row that quietly stands
         * for several accesses is the same lie as a missing row — so the
         * count and the last occurrence show whenever there was more than one.
         */
        renderCell: ({ row }: { row: UserAuditRow }) => {
          if (!row.at) return '—'
          const first = new Date(row.at).toLocaleString()
          if (!(row.repeatCount > 1)) return first
          const last = row.lastAt ? new Date(row.lastAt).toLocaleTimeString() : null
          return `${first} · ${row.repeatCount}x${last ? `, last ${last}` : ''}`
        },
      },
    ]
    return listFilterGridColumns(shown, USER_AUDIT_LIST_FIELDS, options, USER_AUDIT_LIST_HEADERS)
  }, [uid, options])

  const refused = useMemo(
    () =>
      listQueryRefusals(audit.refused, {
        fields: USER_AUDIT_LIST_FIELDS,
        headers: USER_AUDIT_LIST_HEADERS,
        options,
      }),
    [audit.refused, options],
  )

  return (
    <ActivityTable
      header={header}
      help={help}
      description={description}
      columns={columns}
      rows={audit.rows}
      getRowId={(row: UserAuditRow) => row.id}
      loading={audit.loading}
      unreadable={audit.failed}
      emptyLabel={emptyLabel}
      filteredLabel={filteredLabel}
      filtering={audit.filtering}
      filterModel={gridFilter.filterModel}
      onFilterModelChange={gridFilter.onFilterModelChange}
      quickFilter
      filterChips={
        <Stack spacing={1}>
          <ListFilterChips
            fields={USER_AUDIT_LIST_FIELDS}
            headers={USER_AUDIT_LIST_HEADERS}
            options={options}
            clauses={clauses}
            onChange={setClauses}
          />
          <ListQueryNotices refused={refused} notices={audit.notices} />
        </Stack>
      }
      page={audit.pageIndex}
      pageSize={audit.pageSize}
      hasMore={audit.hasMore}
      onPageChange={(next) => void audit.loadPage(next)}
      onPageSizeChange={audit.setPageSize}
      paginationDisabled={audit.loading}
    />
  )
}
StaffUserAuditTable.displayName = 'StaffUserAuditTable'

export default StaffUserAuditTable

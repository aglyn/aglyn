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
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_SOURCE_LABELS,
  type ContactSource,
} from '@aglyn/aglyn'
import {
  hiddenFilterColumns,
  listFilterColumn,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import { Chip, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  CONTACT_LIST_FILTER_FIELDS,
  CONTACT_LIST_FILTER_HEADERS,
} from '../constants/contact-filters'
import type { ContactRecord } from '../model/contact-record'

/**
 * The filterable fields that get a column. The rest of
 * `CONTACT_LIST_FILTER_FIELDS` still reaches the filter panel, hidden.
 */
/**
 * The declared filter fields that ARE table columns, so the hidden
 * filter-only columns are built for the others alone. Owner and Stage
 * joined it when the grammar learned them (AGL-2617): each is a shown
 * column already, and a second, hidden one under the same field would be
 * a duplicate the grid refuses.
 */
export const CONTACT_FILTER_COLUMNS = [
  'name',
  'ownerUid',
  'lifecycleStage',
  'sources',
  'tags',
  'updatedAt',
]

export interface ContactListColumnOptions {
  /** The owner's name for a uid — the roster's, or the uid itself. */
  memberName: (uid: string) => string
}

/**
 * The contacts list's columns (AGL-2596), in their own module so the list
 * file stays about the QUERY and the toolbar while other surfaces — a bulk
 * bar, an import — grow beside it.
 *
 * Owner and Stage read off the flattened row, which is already this
 * holder's facet (`contactRecordFromDoc`), so neither column can show
 * another holder's assignment. Both are `filterable: false` on purpose: the
 * grid's filter panel translates to a Firestore query over the top-level
 * fields in `CONTACT_LIST_FILTER_FIELDS`, and a facet path is not one of
 * them. The toolbar's stage select and "Assigned to me" switch narrow the
 * loaded window instead, and say so.
 */
export function contactListColumns(
  options: ContactListColumnOptions,
): GridColDef[] {
  const { memberName } = options
  return [
    {
      field: 'name',
      headerName: 'Contact',
      flex: 1.6,
      minWidth: 220,
      ...listFilterColumn(CONTACT_LIST_FILTER_FIELDS, 'name'),
      valueGetter: (_value, row: ContactRecord) =>
        String(row.name || row.email || ''),
      renderCell: ({ row }: { row: ContactRecord }) => (
        <Stack sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}>
          <Typography variant="body2" sx={{ lineHeight: 1.25 }}>
            {row.name || row.email}
          </Typography>
          {row.name ? (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ lineHeight: 1.25 }}
              noWrap
            >
              {row.email}
            </Typography>
          ) : null}
        </Stack>
      ),
    },
    {
      field: 'ownerUid',
      headerName: 'Owner',
      flex: 0.9,
      minWidth: 140,
      filterable: false,
      valueGetter: (_value, row: ContactRecord) =>
        row.ownerUid ? memberName(row.ownerUid) : '',
      renderCell: ({ row }: { row: ContactRecord }) =>
        row.ownerUid ? (
          <Typography variant="body2" noWrap>
            {memberName(row.ownerUid)}
          </Typography>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {'—'}
          </Typography>
        ),
    },
    {
      field: 'lifecycleStage',
      headerName: 'Stage',
      flex: 0.9,
      minWidth: 150,
      filterable: false,
      valueGetter: (_value, row: ContactRecord) =>
        row.lifecycleStage ? CONTACT_LIFECYCLE_STAGE_LABELS[row.lifecycleStage] : '',
      renderCell: ({ row }: { row: ContactRecord }) =>
        row.lifecycleStage ? (
          <Chip
            size="small"
            variant="outlined"
            label={CONTACT_LIFECYCLE_STAGE_LABELS[row.lifecycleStage]}
          />
        ) : (
          <Typography variant="caption" color="text.secondary">
            {'—'}
          </Typography>
        ),
    },
    {
      field: 'sources',
      headerName: 'Sources',
      flex: 1,
      minWidth: 160,
      // A map of provenance flags, not a scalar — `sources.form == true` is
      // queryable one key at a time, which is a menu of its own rather than
      // a filter on this column.
      filterable: false,
      sortable: false,
      valueGetter: (_value, row: ContactRecord) =>
        Object.keys(row.sources ?? {}).join(', '),
      renderCell: ({ row }: { row: ContactRecord }) => (
        <Stack
          direction="row"
          spacing={0.5}
          sx={{ alignItems: 'center', height: '100%' }}
        >
          {Object.keys(row.sources ?? {}).map((source) => (
            <Chip
              key={source}
              label={CONTACT_SOURCE_LABELS[source as ContactSource] ?? source}
              size="small"
            />
          ))}
        </Stack>
      ),
    },
    {
      field: 'tags',
      headerName: 'Tags',
      flex: 1,
      minWidth: 150,
      ...listFilterColumn(CONTACT_LIST_FILTER_FIELDS, 'tags'),
      sortable: false,
      valueGetter: (_value, row: ContactRecord) => (row.tags ?? []).join(', '),
      renderCell: ({ row }: { row: ContactRecord }) =>
        (row.tags ?? []).slice(0, 3).join(', '),
    },
    {
      field: 'updatedAt',
      headerName: 'Last activity',
      flex: 0.8,
      minWidth: 150,
      // `type: 'date'` is what gives the panel a date PICKER rather than a
      // free-text box for a value the query reads as a day.
      type: 'date',
      ...listFilterColumn(CONTACT_LIST_FILTER_FIELDS, 'updatedAt'),
      valueGetter: (_value, row: ContactRecord) => {
        const seconds = (row.updatedAt as { seconds?: number } | undefined)?.seconds
        return seconds ? new Date(seconds * 1000) : null
      },
      renderCell: ({ row }: { row: ContactRecord }) => (
        <Typography variant="caption" color="text.secondary">
          {row.interactions?.[0]
            ? new Date(row.interactions[0].atMs).toLocaleDateString()
            : '—'}
        </Typography>
      ),
    },
    ...hiddenFilterColumns(
      CONTACT_LIST_FILTER_FIELDS,
      CONTACT_FILTER_COLUMNS,
      CONTACT_LIST_FILTER_HEADERS,
    ),
  ]
}

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
  activityTimeLabel,
  CONTACT_LIFECYCLE_STAGE_LABELS,
  CONTACT_SOURCE_LABELS,
  type ContactSource,
} from '@aglyn/aglyn'
import {
  hiddenFilterColumns,
  listFilterColumn,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import { Chip, Stack, Tooltip, Typography } from '@mui/material'
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

/**
 * The columns that ship HIDDEN, for the grid's visibility model (AGL-2616).
 *
 * "Last engaged" is a fact most lists do not need on screen and every list
 * can turn on from the column menu; shipping it visible would widen a
 * table that already carries seven columns for a figure only a marketing
 * reader scans.
 */
export const CONTACT_OPTIONAL_COLUMNS = ['lastEmailEngagementAtMs']

export interface ContactListColumnOptions {
  /** The owner's name for a uid — the roster's, or the uid itself. */
  memberName: (uid: string) => string
  /**
   * How a site reads, by document id — handed in at the ORGANIZATION level
   * only (AGL-2630), where it turns on the "Known by" column: the sites
   * that have captured each person. Absent under a site, where every row
   * is known by the site and the column would say so on every line.
   */
  siteName?: (hostId: string) => string
  /**
   * One clock for every row of one paint, so two contacts engaged a second
   * apart cannot read "just now" and "1 min ago". Defaults to the paint's
   * own `Date.now()`.
   */
  nowMs?: number
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
  const { memberName, siteName } = options
  const nowMs = options.nowMs ?? Date.now()
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
    /*
     * KNOWN BY (AGL-2630): the sites that have captured this person, which
     * is the cross-site fact the organization-level list exists to show —
     * one deduplicated row per person, and which of the org's sites know
     * them. `capturedByHostIds` is a top-level array precisely so the
     * question can be answered without opening a facet. Not filterable from
     * the panel: an `array-contains` on it would displace the scope clause
     * under a site, and at the org level a saved view narrows the window
     * instead. A row that names no site predates attribution and says so,
     * rather than reading as "every site".
     */
    ...(siteName
      ? [
          {
            field: 'capturedByHostIds',
            headerName: 'Known by',
            flex: 1.1,
            minWidth: 200,
            sortable: false,
            filterable: false,
            valueGetter: (_value: unknown, row: ContactRecord) =>
              row.capturedByHostIds.map(siteName).join(', '),
            renderCell: ({ row }: { row: ContactRecord }) =>
              row.capturedByHostIds.length ? (
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'center', height: '100%', flexWrap: 'nowrap' }}
                >
                  {row.capturedByHostIds.slice(0, 2).map((hostId) => (
                    <Chip key={hostId} size="small" label={siteName(hostId)} />
                  ))}
                  {row.capturedByHostIds.length > 2 ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`+${row.capturedByHostIds.length - 2}`}
                    />
                  ) : null}
                </Stack>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {'No site recorded'}
                </Typography>
              ),
          } satisfies GridColDef,
        ]
      : []),
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
    {
      /*
       * When the person last opened or clicked one of this holder's
       * campaigns (AGL-2616). Off the facet like Owner and Stage, so it can
       * never show another holder's readers; `filterable: false` for the
       * same reason theirs are — a facet path is not a query the panel can
       * make. A date column, so a sort on it orders by the instant and an
       * export gets a date; the cell prints the relative form the timeline
       * uses and carries the full stamp in its tooltip.
       */
      field: 'lastEmailEngagementAtMs',
      headerName: 'Last engaged',
      flex: 0.8,
      minWidth: 140,
      type: 'date',
      filterable: false,
      valueGetter: (_value, row: ContactRecord) =>
        row.lastEmailEngagementAtMs ? new Date(row.lastEmailEngagementAtMs) : null,
      renderCell: ({ row }: { row: ContactRecord }) =>
        row.lastEmailEngagementAtMs ? (
          <Tooltip title={new Date(row.lastEmailEngagementAtMs).toLocaleString()}>
            <Typography variant="caption" color="text.secondary">
              {activityTimeLabel(row.lastEmailEngagementAtMs, nowMs)}
            </Typography>
          </Tooltip>
        ) : (
          <Typography variant="caption" color="text.secondary">
            {'—'}
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

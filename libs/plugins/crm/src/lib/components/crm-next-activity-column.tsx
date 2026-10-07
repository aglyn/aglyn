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

import { Tooltip, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { TaskDueText } from './task-cells'
import { CRM_NEXT_ACTIVITY_FIELD, readNextTaskAtMs } from '../model/crm-next-activity'

/**
 * The "Next activity" column the contacts, companies and deals lists share
 * (AGL-2661): when the record's earliest open task is due, off the
 * `nextTaskAtMs` every server-side task writer keeps on the row.
 *
 * Drawn the way the tasks list draws a due date — overdue in the warning
 * color, today emphasized — because it IS that date, seen from the record.
 * A dash for a record with nothing scheduled, and the same dash for one
 * written before the field existed: the reader's question is "is anything
 * planned", and to both the answer is no. Sorting is off for the reason
 * the custom columns' is — the value is on the row, and a sort over the
 * loaded window would look like a sort over the collection. Filtering is
 * the list's to switch on, through `CRM_NEXT_ACTIVITY_FILTER_FIELD`.
 */
export function nextActivityColumn(nowMs: number): GridColDef {
  return {
    field: CRM_NEXT_ACTIVITY_FIELD,
    headerName: 'Next activity',
    flex: 0.8,
    minWidth: 140,
    type: 'date',
    sortable: false,
    filterable: false,
    valueGetter: (_value: unknown, row: { nextTaskAtMs?: unknown }) => {
      const at = readNextTaskAtMs(row)
      return at === null ? null : new Date(at)
    },
    renderCell: ({ row }: { row: { nextTaskAtMs?: unknown } }) => {
      const at = readNextTaskAtMs(row)
      if (at === null) {
        return (
          <Typography variant="caption" color="text.secondary">
            {'—'}
          </Typography>
        )
      }
      return (
        <Tooltip title={new Date(at).toLocaleString()}>
          <span>
            <TaskDueText task={{ status: 'open', dueAtMs: at }} nowMs={nowMs} variant="caption" />
          </span>
        </Tooltip>
      )
    },
  }
}

export {
  CRM_NEXT_ACTIVITY_FILTER_FIELD,
  CRM_NEXT_ACTIVITY_FILTER_HEADER,
} from '../model/crm-next-activity'

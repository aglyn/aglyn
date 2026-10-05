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

/**
 * The records a data item carries — a dataset's records, a collection's
 * entries — as a table against this site's (AGL-3545): one row per record
 * the file adds, no longer holds or changes, one column per field, and
 * each changed cell marked with the value it replaces. Records the import
 * leaves as they are are counted, not listed. Paged, because a dataset
 * carries up to a few thousand.
 */

import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Chip,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import { useMemo, useState } from 'react'

import {
  packageRecordDiff,
  type PackageRecordRow,
  type PackageRecordStatus,
} from './site-package-import-state'
import { countOf, displayTransferValue } from './transfer-words'

export interface PackageRecordDiffTableProps {
  /** Names the table for assistive technology. */
  label: string
  /** The site's records; anything but a list reads as none. */
  site: unknown
  /** The file's records. */
  file: unknown
  pageSize?: number
}

const STATUS: Readonly<
  Record<PackageRecordStatus, { label: string; color: 'success' | 'error' | 'info' }>
> = {
  added: { label: 'New', color: 'success' },
  removed: { label: 'Not in the file', color: 'error' },
  changed: { label: 'Changed', color: 'info' },
}

function RecordCell(props: { row: PackageRecordRow; field: string }) {
  const { row, field } = props
  if (row.status === 'removed') {
    return (
      <TableCell>
        <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
          {displayTransferValue(row.site?.[field])}
        </Typography>
      </TableCell>
    )
  }
  const changed = row.status === 'changed' && row.changed.includes(field)
  if (!changed) {
    return (
      <TableCell>
        <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
          {displayTransferValue(row.file?.[field])}
        </Typography>
      </TableCell>
    )
  }
  return (
    <TableCell
      data-changed="true"
      sx={{ bgcolor: (theme) => alpha(theme.palette.warning.main, theme.palette.action.selectedOpacity * 2) }}
    >
      <Typography variant="body2" sx={{ fontWeight: 'fontWeightMedium', wordBreak: 'break-word' }}>
        {displayTransferValue(row.file?.[field])}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', textDecoration: 'line-through', wordBreak: 'break-word' }}
      >
        {displayTransferValue(row.site?.[field])}
      </Typography>
    </TableCell>
  )
}

export function PackageRecordDiffTable({ label, site, file, pageSize = 25 }: PackageRecordDiffTableProps) {
  const diff = useMemo(() => packageRecordDiff(site, file), [site, file])
  const [page, setPage] = useState(0)
  // A shorter list (another item compared) never leaves the page past its end.
  const lastPage = Math.max(0, Math.ceil(diff.rows.length / pageSize) - 1)
  const current = Math.min(page, lastPage)
  const visible = diff.rows.slice(current * pageSize, current * pageSize + pageSize)
  const { added, removed, changed, same } = diff.counts
  const summary = [
    `${countOf(added, 'new record')}`,
    `${countOf(changed, 'changed record')}`,
    `${countOf(removed, 'record')} not in the file`,
    `${same.toLocaleString()} unchanged`,
  ].join(' · ')

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Records</Typography>
      <Typography variant="body2" color="text.secondary">
        {summary}
      </Typography>
      {diff.rows.length ? (
        <ScrollTable size="small" aria-label={label}>
          <TableHead>
            <TableRow>
              <TableCell>Record</TableCell>
              <TableCell>Change</TableCell>
              {diff.fields.map((field) => (
                <TableCell key={field}>{field}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={`${row.status}:${row.id}`}>
                <TableCell>
                  <Typography variant="body2" sx={{ wordBreak: 'break-all' }}>
                    {row.id}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Chip size="small" variant="outlined" label={STATUS[row.status].label} color={STATUS[row.status].color} />
                </TableCell>
                {diff.fields.map((field) => (
                  <RecordCell key={field} row={row} field={field} />
                ))}
              </TableRow>
            ))}
          </TableBody>
        </ScrollTable>
      ) : (
        <Typography variant="body2" color="text.secondary">
          Every record in the file matches this site’s.
        </Typography>
      )}
      {diff.rows.length > pageSize ? (
        <TablePagination
          component="div"
          count={diff.rows.length}
          page={current}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[pageSize]}
          onPageChange={(_event, next) => setPage(next)}
        />
      ) : null}
    </Stack>
  )
}

export default PackageRecordDiffTable

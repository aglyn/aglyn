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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'

/** One monthly org usage rollup as `/api/admin/org-usage` serves it. */
export interface StaffOrgUsageMonth {
  month: string
  storageGb: number
  pageViews: number
  formSubmissions: number
  costUsd: number
  deltas: { pageViews: number | null; costUsd: number | null } | null
}

/**
 * The monthly usage rollup table (AGL-205), shared between the Organizations
 * list's Usage dialog and the org detail page's usage panel (AGL-939) so the
 * two surfaces can never drift on what a rollup row means.
 */
const StaffOrgUsageTable = ({ months }: { months: StaffOrgUsageMonth[] }) => {
  if (months.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'No usage rollups recorded for this organization yet.'}
      </Typography>
    )
  }
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell>{'Month'}</TableCell>
          <TableCell align="right">{'Page views'}</TableCell>
          <TableCell align="right">{'Storage GB'}</TableCell>
          <TableCell align="right">{'Forms'}</TableCell>
          <TableCell align="right">{'Cost'}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {months.map((row) => (
          <TableRow key={row.month}>
            <TableCell>{row.month}</TableCell>
            <TableCell align="right">
              {row.pageViews.toLocaleString()}
              {row.deltas?.pageViews != null ? (
                <Typography
                  component="span"
                  variant="caption"
                  color={
                    row.deltas.pageViews > 0
                      ? 'success.main'
                      : 'text.secondary'
                  }
                  sx={{ ml: 0.5 }}
                >
                  {`${row.deltas.pageViews > 0 ? '+' : ''}${Math.round(
                    row.deltas.pageViews * 100,
                  )}%`}
                </Typography>
              ) : null}
            </TableCell>
            <TableCell align="right">{row.storageGb.toFixed(2)}</TableCell>
            <TableCell align="right">
              {row.formSubmissions.toLocaleString()}
            </TableCell>
            <TableCell align="right">
              {`$${row.costUsd.toFixed(2)}`}
              {row.deltas?.costUsd != null ? (
                <Typography
                  component="span"
                  variant="caption"
                  color={
                    row.deltas.costUsd > 0 ? 'warning.main' : 'text.secondary'
                  }
                  sx={{ ml: 0.5 }}
                >
                  {`${row.deltas.costUsd > 0 ? '+' : ''}${Math.round(
                    row.deltas.costUsd * 100,
                  )}%`}
                </Typography>
              ) : null}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
StaffOrgUsageTable.displayName = 'StaffOrgUsageTable'

export default StaffOrgUsageTable

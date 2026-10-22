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

import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  TableBody,
  TableCell,
  TableRow,
  Typography,
} from '@mui/material'
import { Fragment } from 'react'
import {
  meteredBandField,
  meteredPluginBands,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import {
  NO_RECORDED_METERS,
  percentChange,
  recordedUsageLines,
  type StaffOrgUsageMonth,
} from '@aglyn/console-ui/staff-org-usage-view'
import {
  PluginListColumnCells,
  PluginListColumnHeaders,
  type PluginListColumn,
} from './plugin-list-columns.component'
import StaffTableHead from './staff-table-head.component'

export { recordedUsageLines, type StaffOrgUsageMonth }

/** The metered bands, each a core column after storage (`meteredPluginBands`). */
const METERED_COLUMNS = meteredPluginBands()

/** The core headers drawn before the plugin columns. */
const LEADING_COLUMNS = [
  'Month',
  'Page views',
  'Storage GB',
  ...METERED_COLUMNS.map((band) => band.label),
]

/** The core header drawn after them. */
const TRAILING_COLUMN = 'Cost'

/**
 * The core columns of every rollup row, in order — the spec pins them: the
 * platform's own, one for each metered band, then Cost. Columns a plugin
 * contributes through the `staffOrgUsageColumn` zone sit between the metered
 * bands and Cost.
 */
export const STAFF_ORG_USAGE_COLUMNS: readonly string[] = [
  ...LEADING_COLUMNS,
  TRAILING_COLUMN,
]

const NO_PLUGIN_COLUMNS: readonly PluginListColumn[] = []

/**
 * The monthly usage rollup table (AGL-205), shared between the Organizations
 * list's Usage dialog and the org detail page's usage panel (AGL-939) so the
 * two surfaces can never drift on what a rollup row means.
 */
const StaffOrgUsageTable = ({
  months,
  columns = NO_PLUGIN_COLUMNS,
  orgId,
}: {
  months: StaffOrgUsageMonth[]
  /**
   * The columns plugins contribute through the `staffOrgUsageColumn` zone
   * (AGL-2984), each drawn once per month with `{ month, orgId }`.
   */
  columns?: readonly PluginListColumn[]
  /** The org the rollups belong to, handed to every plugin column. */
  orgId?: string
}) => {
  if (months.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'No usage rollups recorded for this organization yet.'}
      </Typography>
    )
  }
  return (
    <ScrollTable size="small">
      <StaffTableHead>
        <TableRow>
          {LEADING_COLUMNS.map((column, index) => (
            <TableCell key={column} align={index === 0 ? 'left' : 'right'}>
              {column}
            </TableCell>
          ))}
          <PluginListColumnHeaders columns={columns} orgId={orgId} />
          <TableCell align="right">{TRAILING_COLUMN}</TableCell>
        </TableRow>
      </StaffTableHead>
      <TableBody>
        {months.map((row) => (
          <Fragment key={row.month}>
            {/*
            Two rows per month, hairline-joined: the scanned figures, then
            the recorded-not-priced detail (AGL-2321). The month's own bottom
            border is dropped so the pair reads as one row rather than as two
            months, and the detail row carries it instead.
          */}
            <TableRow sx={{ '& td': { borderBottom: 'none' } }}>
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
                    {percentChange(row.deltas.pageViews)}
                  </Typography>
                ) : null}
              </TableCell>
              <TableCell align="right">{row.storageGb.toFixed(2)}</TableCell>
              {METERED_COLUMNS.map((band) => (
                <TableCell key={band.id} align="right">
                  {Number(row[meteredBandField(band)] ?? 0).toLocaleString()}
                </TableCell>
              ))}
              <PluginListColumnCells
                columns={columns}
                month={row}
                orgId={orgId}
              />
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
                    {percentChange(row.deltas.costUsd)}
                  </Typography>
                ) : null}
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell
                colSpan={STAFF_ORG_USAGE_COLUMNS.length + columns.length}
                sx={{ pt: 0 }}
              >
                {recordedUsageLines(row.recorded).length ? (
                  recordedUsageLines(row.recorded).map((line) => (
                    <Typography
                      key={line}
                      variant="caption"
                      color="text.secondary"
                      component="div"
                    >
                      {line}
                    </Typography>
                  ))
                ) : (
                  /*
                   * Said plainly rather than left blank. A month whose rollup
                   * predates these meters recorded nothing, and an empty cell
                   * reads as "nothing happened" — the exact confusion the
                   * null-vs-zero handling above exists to prevent.
                   */
                  <Typography
                    variant="caption"
                    color="text.disabled"
                    component="div"
                  >
                    {NO_RECORDED_METERS}
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          </Fragment>
        ))}
      </TableBody>
    </ScrollTable>
  )
}
StaffOrgUsageTable.displayName = 'StaffOrgUsageTable'

export default StaffOrgUsageTable

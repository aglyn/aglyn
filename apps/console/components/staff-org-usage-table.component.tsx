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
  countedPluginBands,
  meteredBandField,
  meteredPluginBands,
} from '@aglyn/aglyn/plugin-manager/plugin-usage-axes'
import {
  PluginListColumnCells,
  PluginListColumnHeaders,
  type PluginListColumn,
} from './plugin-list-columns.component'
import StaffTableHead from './staff-table-head.component'

/**
 * One monthly org usage rollup as `/api/admin/org-usage` serves it. The row
 * carries more fields than the core columns draw: every field a plugin's cost
 * axis reads, records or serves staff, under its rollup name — a metered
 * band's count among them, which the table draws — and a plugin column reads
 * the ones that are its own off the same row.
 */
export interface StaffOrgUsageMonth {
  month: string
  storageGb: number
  pageViews: number
  costUsd: number
  /**
   * What the rollup recorded and nothing priced (AGL-2321).
   *
   * A detail LINE under the row rather than sixteen more columns: these are
   * the history a future rate gets derived from, not figures a reader scans
   * across months, and a table wide enough to hold them all would stop being
   * readable for the figures that are.
   *
   * Every field is optional and every one distinguishes null from zero,
   * because the route does — a rollup written before a meter existed recorded
   * nothing, and printing `0` there would be a fabricated measurement.
   */
  recorded?: {
    emailSends?: number
    emailSendsOverage?: number
    /**
     * Each plugin band counted by a per-site counter and never billed past it
     * (`countedPluginBands`), by band id.
     */
    counted?: Readonly<Record<string, number>>
    actionRuns?: number
    billableCostUsd?: number
    apiOverageUsd?: number
    /**
     * Each metered band that waits behind a release flag, by band id: whether
     * the month billed its overage, and what was forgone, at cost, if not.
     */
    meteredVerdicts?: Readonly<
      Record<string, { billed: boolean | null; withheldUsd: number }>
    >
    contactsOverageBilled?: boolean | null
    contactsOverageUsd?: number
    contactsOverageWithheldUsd?: number
    orgLibraryStorageGb?: number | null
    orgLibraryBilled?: boolean | null
    orgLibraryBilledFrom?: string | null
    siteSizeMb?: number | null
    siteSizeTruncated?: boolean | null
  }
  deltas: { pageViews: number | null; costUsd: number | null } | null
  readonly [field: string]: unknown
}

/**
 * The withheld/billed pair as ONE sentence (AGL-2321).
 *
 * `*WithheldUsd` is zero whenever the release flag was on, so the dollar
 * figure alone cannot tell a withheld month from an in-band one — the writer's
 * own comment says so and it has been true ever since. Rendering the flag with
 * the number is the whole fix.
 */
function overageSentence(
  label: string,
  billed: boolean | null | undefined,
  withheldUsd: number | undefined,
  billedUsd?: number,
): string | null {
  if (billed == null) return null
  if (billed) {
    return billedUsd == null
      ? `${label} billed`
      : `${label} billed $${billedUsd.toFixed(2)}`
  }
  return `${label} withheld $${Number(withheldUsd ?? 0).toFixed(2)}`
}

/**
 * The org library's own recorded answer to "was THIS month billed for it".
 *
 * Read off the rollup, never re-derived from `BILL_ORG_LIBRARY_STORAGE_FROM`.
 * The env var answers "what is the switch now", which is the right question
 * for the current-month estimate card and the wrong one for a July row: the
 * switch may have moved since, and a past invoice does not change when it
 * does. The rollup froze the value for exactly this reader (AGL-2321 item 3).
 */
function librarySentence(
  recorded: StaffOrgUsageMonth['recorded'],
): string | null {
  if (!recorded || recorded.orgLibraryStorageGb == null) return null
  const size = `Org library ${recorded.orgLibraryStorageGb.toFixed(3)} GB`
  if (recorded.orgLibraryBilled == null) return size
  if (!recorded.orgLibraryBilled) return `${size}, not billed`
  return recorded.orgLibraryBilledFrom
    ? `${size}, billed from ${recorded.orgLibraryBilledFrom}`
    : `${size}, billed`
}

/** The recorded block as the short lines a staff reader actually scans. */
export function recordedUsageLines(
  recorded: StaffOrgUsageMonth['recorded'],
): string[] {
  if (!recorded) return []
  const meters: string[] = []
  if (recorded.emailSends != null) {
    meters.push(
      `Emails ${recorded.emailSends.toLocaleString()}` +
        (recorded.emailSendsOverage
          ? ` (${recorded.emailSendsOverage.toLocaleString()} over band)`
          : ''),
    )
  }
  for (const band of countedPluginBands()) {
    const count = recorded.counted?.[band.id]
    if (count != null) meters.push(`${band.label} ${count.toLocaleString()}`)
  }
  if (recorded.actionRuns != null) {
    meters.push(`Action runs ${recorded.actionRuns.toLocaleString()}`)
  }
  const money: string[] = []
  if (recorded.billableCostUsd != null) {
    // The pre-markup twin of `costUsd`. Four decimals for the AGL-2280
    // reason: a sub-cent month rounded to `$0.00` is the silence this exists
    // to end.
    money.push(`Billable $${recorded.billableCostUsd.toFixed(4)}`)
  }
  if (recorded.apiOverageUsd) {
    money.push(`API overage $${recorded.apiOverageUsd.toFixed(2)}`)
  }
  const gates = [
    ...meteredPluginBands().map((band) => {
      const verdict = recorded.meteredVerdicts?.[band.id]
      return overageSentence(
        `${band.label} overage`,
        verdict?.billed,
        verdict?.withheldUsd,
      )
    }),
    overageSentence(
      'Contacts overage',
      recorded.contactsOverageBilled,
      recorded.contactsOverageWithheldUsd,
      recorded.contactsOverageUsd,
    ),
    librarySentence(recorded),
  ].filter(Boolean) as string[]
  const site: string[] = []
  if (recorded.siteSizeMb != null) {
    // The truncation flag changes the NUMBER'S MEANING, so it is rendered on
    // the number and not beside it: a truncated measurement is a floor.
    site.push(
      `Site size ${recorded.siteSizeMb.toFixed(1)} MB` +
        (recorded.siteSizeTruncated
          ? ' (at least — measurement truncated)'
          : ''),
    )
  }
  return [meters, money, gates, site]
    .filter((group) => group.length > 0)
    .map((group) => group.join(' · '))
}

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
                    {`${row.deltas.pageViews > 0 ? '+' : ''}${Math.round(
                      row.deltas.pageViews * 100,
                    )}%`}
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
                    {`${row.deltas.costUsd > 0 ? '+' : ''}${Math.round(
                      row.deltas.costUsd * 100,
                    )}%`}
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
                    {'No additional meters recorded for this month.'}
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

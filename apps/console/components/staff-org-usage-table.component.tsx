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
import { Fragment } from 'react'

/** One monthly org usage rollup as `/api/admin/org-usage` serves it. */
export interface StaffOrgUsageMonth {
  month: string
  storageGb: number
  pageViews: number
  formSubmissions: number
  costUsd: number
  /**
   * Aglyn Assist provider spend for the month, in dollars (AGL-2280).
   *
   * A separate column rather than folded into `costUsd`, because they are not
   * the same kind of number: `costUsd` is the metering estimate over storage,
   * page views and form submissions, and this is a real provider bill. It is
   * also the only line here that can plausibly clear the $2/site COGS floor
   * on its own, which is why it needs to be visible next to the others rather
   * than summed into one of them.
   */
  assistCostUsd?: number
  /**
   * What the rollup recorded and nothing priced (AGL-2321).
   *
   * A detail LINE under the row rather than sixteen more columns: these are
   * the history a future rate gets derived from, not figures a reader scans
   * across months, and a table wide enough to hold them all would stop being
   * readable for the six that are.
   *
   * Every field is optional and every one distinguishes null from zero,
   * because the route does — a rollup written before a meter existed recorded
   * nothing, and printing `0` there would be a fabricated measurement.
   */
  recorded?: {
    emailSends?: number
    emailSendsOverage?: number
    workflowRuns?: number
    actionRuns?: number
    billableCostUsd?: number
    apiOverageUsd?: number
    formSubmissionsBilled?: boolean | null
    formSubmissionsOverageWithheldUsd?: number
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
  if (recorded.workflowRuns != null) {
    meters.push(`Workflow runs ${recorded.workflowRuns.toLocaleString()}`)
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
    overageSentence(
      'Form overage',
      recorded.formSubmissionsBilled,
      recorded.formSubmissionsOverageWithheldUsd,
    ),
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
          <TableCell align="right">{'Assist'}</TableCell>
          <TableCell align="right">{'Cost'}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {months.map((row) => (
          <Fragment key={row.month}>
            {/*
            Two rows per month, hairline-joined: the six scanned figures, then
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
              <TableCell align="right">
                {row.formSubmissions.toLocaleString()}
              </TableCell>
              {/*
              Rendered to FOUR decimals, not two (AGL-2280). Assist spend
              arrives in thousandths of a dollar per exchange, and `$0.00` for
              a month that really cost eight cents is the same silence this
              column exists to end.
            */}
              <TableCell align="right">
                {`$${Number(row.assistCostUsd ?? 0).toFixed(4)}`}
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
            <TableRow>
              <TableCell colSpan={6} sx={{ pt: 0 }}>
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
    </Table>
  )
}
StaffOrgUsageTable.displayName = 'StaffOrgUsageTable'

export default StaffOrgUsageTable

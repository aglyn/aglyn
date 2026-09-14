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

import { aiAddonName, countCsvDataRows } from '@aglyn/aglyn'
import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { buildRoute, Route } from '@aglyn/aglyn/app-utils/console-routes'
import { useCallback, useEffect, useState } from 'react'
import { topAiUsageKinds } from '../model/ai-usage-by-user'
import { useOrgAiUsage } from './use-org-ai-usage'
import {
  AI_USAGE_EXPORT_ROWS_HEADER,
  aiUsageMonthLabel,
  formatAiUsageShare,
} from '../usage/ai-usage-wire'

export interface BillingAiTopUsersProps {
  orgId: string | undefined
  /** The org's slug, for the links into each person's page. */
  orgSlug: string
}

/**
 * WHO IS GENERATING WHAT (AGL-2928) — the per-person table beneath the
 * credit meter on Billing → Usage.
 *
 * The meter above says how much of the pool the workspace has drawn; this
 * says who drew it. Each row is one member's month: credits, their share of
 * the workspace's spend, requests, and how often the gate refused them. A
 * month picker walks the retention window, and the file button hands the
 * same month to a spreadsheet through the streamed export.
 *
 * ## The file is checked, not trusted
 *
 * The route promises its row count in a header taken before the first row
 * is written. A stream that dies halfway yields a well-formed shorter file,
 * so a body with fewer rows than promised is refused rather than saved.
 *
 * The copy stays descriptive on purpose — who, how much, on which site — and
 * never characterizes what the numbers mean about a person.
 */
export function BillingAiTopUsersComponent(props: BillingAiTopUsersProps) {
  const { orgId, orgSlug } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [month, setMonth] = useState<string | undefined>(undefined)
  const [exporting, setExporting] = useState(false)
  const usage = useOrgAiUsage(orgId, { month })
  // One row per member, so the table pages in memory over the month it read.
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  useEffect(() => {
    setPage(0)
  }, [usage.month])
  const name = aiAddonName()

  const handleExport = useCallback(async () => {
    if (!orgId || exporting) return
    setExporting(true)
    try {
      const params = new URLSearchParams({ orgId, month: usage.month, format: 'csv' })
      const response = await authorizedFetch(
        user,
        `/api/ai/usage?${params.toString()}`,
      )
      if (!response.ok) {
        const failure = await response.json().catch(() => ({}))
        throw new Error(failure?.error ?? 'Export failed')
      }
      const text = await response.text()
      const promised = Number(response.headers.get(AI_USAGE_EXPORT_ROWS_HEADER) ?? '')
      const received = countCsvDataRows(text)
      if (Number.isFinite(promised) && received < promised) {
        enqueueSnackbar(
          `Export incomplete — ${received} of ${promised} rows arrived. ` +
            'Nothing was saved; try again.',
          { variant: 'error' },
        )
        return
      }
      const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `ai-usage-${usage.month}.csv`
      anchor.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      enqueueSnackbar(error instanceof Error ? error.message : 'Export failed', {
        variant: 'error',
      })
    } finally {
      setExporting(false)
    }
  }, [orgId, exporting, usage.month, user, enqueueSnackbar])

  const rows = usage.data?.rows ?? []
  const visible = rows.slice(page * pageSize, page * pageSize + pageSize)

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {`Who is generating what, per site: each member's ${name} credits for the month and their share of the workspace's spend. Open a member for the split by site and by kind.`}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <TextField
          select
          size="small"
          label="Month"
          value={usage.month}
          onChange={(event) => setMonth(event.target.value)}
          sx={{ minWidth: 180 }}
        >
          {usage.months.map((key) => (
            <MenuItem key={key} value={key}>
              {aiUsageMonthLabel(key)}
            </MenuItem>
          ))}
        </TextField>
        <Button
          size="small"
          disabled={exporting || usage.status !== 'ready' || rows.length === 0}
          onClick={() => void handleExport()}
        >
          {exporting ? 'Exporting…' : 'Export CSV'}
        </Button>
        {usage.data ? (
          <Typography variant="caption" color="text.secondary">
            {`${usage.data.orgCredits.toLocaleString()} credits drawn by the workspace in ${aiUsageMonthLabel(usage.month)}`}
          </Typography>
        ) : null}
      </Stack>
      {usage.status === 'refused' ? (
        <Alert severity="info">
          {'Seeing who used AI credits requires the View billing permission.'}
        </Alert>
      ) : usage.status === 'error' ? (
        <Alert severity="warning">
          {'Could not read this month’s per-member usage — a failed read, not zero usage.'}
        </Alert>
      ) : usage.status === 'loading' && !usage.data ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {`No ${name} usage attributed to a member in ${aiUsageMonthLabel(usage.month)}.`}
        </Typography>
      ) : (
        <>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Member'}</TableCell>
                <TableCell align="right">{'Credits'}</TableCell>
                <TableCell align="right">{'Share'}</TableCell>
                <TableCell align="right">{'Requests'}</TableCell>
                <TableCell align="right">{'Refusals'}</TableCell>
                <TableCell>{'Mostly'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.uid} hover>
                  <TableCell>
                    <AppLink
                      href={buildRoute(Route.MANAGE_TEAM_MEMBER, { orgSlug, uid: row.uid })}
                      color="inherit"
                      underline="hover"
                    >
                      {row.name}
                    </AppLink>
                    {row.email && row.email !== row.name ? (
                      <Typography variant="caption" color="text.secondary" component="div">
                        {row.email}
                      </Typography>
                    ) : null}
                  </TableCell>
                  <TableCell align="right">{row.credits.toLocaleString()}</TableCell>
                  <TableCell align="right">{formatAiUsageShare(row.share)}</TableCell>
                  <TableCell align="right">{row.requests.toLocaleString()}</TableCell>
                  <TableCell align="right">{row.refusals.toLocaleString()}</TableCell>
                  <TableCell>
                    {topAiUsageKinds(row.byKind, 2)
                      .map((entry) => entry.kind)
                      .join(', ') || '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={visible.length}
            count={rows.length}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size)
              setPage(0)
            }}
          />
        </>
      )}
    </Stack>
  )
}
BillingAiTopUsersComponent.displayName = 'BillingAiTopUsersComponent'

/**
 * The card on Billing → Usage, through the `orgBillingUsage` zone: its own
 * band beneath the meters, full width, because it is a table of people rather
 * than a gauge. Registered with `billing.view`, so a manager without it sees
 * no card rather than a refusal.
 */
export function AiTopUsersCard(props: { orgId?: string; org?: { slug?: string } | null }) {
  return (
    <div id="ai-usage-by-member">
      <CardDisplay
        header={'Who is generating what'}
        help={pluginDocsHelp('billing', {
          anchor: '#who-is-generating-what',
          excerpt:
            'Each member’s AI credits for a month, their share of the ' +
            'workspace’s spend, requests and refusals — with a month picker ' +
            'and a CSV export.',
        })}
        contentGutterX
        contentGutterY
      >
        <BillingAiTopUsersComponent orgId={props.orgId} orgSlug={props.org?.slug ?? ''} />
      </CardDisplay>
    </div>
  )
}
AiTopUsersCard.displayName = 'AiTopUsersCard'

export default BillingAiTopUsersComponent

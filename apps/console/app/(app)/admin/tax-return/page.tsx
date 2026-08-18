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
 * SALES TAX — the Texas return for one filing period (AGL-1900 / AGL-1811).
 *
 * AGL-1811 built the mechanism and stopped there: `GET /api/admin/tax-return`
 * computed a filable return that only a curl could reach. This page is the
 * surface, and the standing rule it was raised under — *a capability
 * reachable only by curling a route is not shipped* — is why it exists.
 *
 * ## What this page must never do
 *
 * **Never let a qualified figure read as a final one.** The
 * verdict banner sits ABOVE the figures, not beside them, and a period with
 * a blocking finding renders the numbers dimmed under a "do not file" error
 * rather than as a clean total a tired preparer copies into Webfile. A
 * silently-dropped row is a filing error made under penalty of perjury; the
 * whole reason `attention` exists is that an undercount presented as a total
 * is the one failure this record cannot have.
 *
 * **Never show platform totals where the return wants Texas.** Items 1 and 2
 * come from `byJurisdiction['US-TX']`. The all-jurisdictions table below is
 * the audit trail for why the rest of the quarter is not on the return —
 * and the early-warning list for economic nexus elsewhere.
 *
 * **Never claim a figure it did not compute.** Taxable purchases (use tax on
 * Aglyn's own purchases) is not in `platformRevenue`; the line says NOT
 * COMPUTED rather than printing a zero that would pass for a derived one.
 *
 * Read-only, like the route: this page files nothing and writes nothing. The
 * filing happens at the Comptroller's Webfile keyboard, which is why the
 * export is a spreadsheet of working papers and the credentials ride along.
 */

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  LinearProgress,
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
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import {
  centsToDollars,
  defaultTaxReturnPeriod,
  taxReturnAttention,
  taxReturnCsv,
  taxReturnCsvFilename,
  taxReturnJurisdictionRows,
  taxReturnPeriodOptions,
  taxReturnWebfileLines,
  TX_TAXPAYER_NUMBER,
  TX_WEBFILE_NUMBER,
  type TaxReturnPayload,
} from '../../../../utils/tx-return-webfile'

const AdminTaxReturn: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const isStaff = useIsStaff()
  const { enqueueSnackbar } = useSnackbar()

  // The clock is read ONCE per mount rather than per render: the period list
  // and the default selection must not shift under a page left open across
  // a quarter boundary while someone is reading it.
  const [now] = useState(() => new Date())
  const periodOptions = useMemo(() => taxReturnPeriodOptions(now), [now])
  const [period, setPeriod] = useState(() => defaultTaxReturnPeriod(now))

  const [payload, setPayload] = useState<TaxReturnPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isStaff || !user || !period) return
    let active = true
    setLoading(true)
    // The previous period's figures are cleared BEFORE the new ones arrive.
    // Leaving them on screen under a newly-selected period label would put
    // Q3's totals under a Q4 heading for as long as the fetch takes, and a
    // screenshot of that is indistinguishable from a real answer.
    setPayload(null)
    setError(null)
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/tax-return?period=${encodeURIComponent(period)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const body = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          setError(body?.error ?? 'Tax return summary failed')
        } else {
          setPayload(body as TaxReturnPayload)
        }
      } catch {
        if (active) setError('Tax return summary failed')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, user, period])

  const verdict = useMemo(() => taxReturnAttention(payload), [payload])
  const webfileLines = useMemo(() => taxReturnWebfileLines(payload), [payload])
  const jurisdictions = useMemo(
    () => taxReturnJurisdictionRows(payload),
    [payload],
  )

  const handleExport = useCallback(() => {
    const csv = taxReturnCsv(payload)
    if (!csv) return
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = taxReturnCsvFilename(payload?.period ?? period)
    anchor.click()
    URL.revokeObjectURL(url)
    enqueueSnackbar('Working papers exported', {
      variant: 'success',
      persist: false,
    })
  }, [payload, period, enqueueSnackbar])

  const refunds = payload?.summary?.refunds

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Sales tax', href: buildRoute(Route.ADMIN_TAX_RETURN) },
      ]}
      help="salesTaxReturn"
      header={{
        children: 'Texas Sales Tax Return',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            <CardDisplay
              header={'Filing period'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#choosing-the-period',
                excerpt:
                  'Pick the quarter (or month) to file. Periods start at the registration’s first taxable sales date — 2026-09-01 — because nothing earlier can be filed.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={2}
                sx={{ alignItems: { sm: 'center' } }}
              >
                <TextField
                  select
                  size="small"
                  label="Period"
                  value={period}
                  onChange={(event) => setPeriod(event.target.value)}
                  sx={{ minWidth: 220 }}
                >
                  {periodOptions.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleExport}
                  disabled={!payload}
                >
                  {'Export working papers (CSV)'}
                </Button>
                <Stack sx={{ ml: { sm: 'auto' } }}>
                  <Typography variant="caption" color="text.secondary">
                    {`Webfile number ${TX_WEBFILE_NUMBER}`}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {`Taxpayer number ${TX_TAXPAYER_NUMBER}`}
                  </Typography>
                </Stack>
              </Stack>
              {loading ? <LinearProgress sx={{ mt: 2 }} /> : null}
            </CardDisplay>

            {error ? <Alert severity="error">{error}</Alert> : null}

            {/*
              THE VERDICT, above the figures. Its prominence is the feature:
              the counts it renders are the difference between a return and
              an understated return, and a number in a corner is a number
              nobody reads before pressing Submit at the Comptroller.
            */}
            {payload ? (
              verdict.clean ? (
                <Alert severity="success">
                  <AlertTitle>{'Every row read cleanly'}</AlertTitle>
                  {`All ${payload.summary?.transactionCount ?? 0} invoices in ` +
                    'this period were fully readable — no row was dropped, ' +
                    'and no figure below is a lower bound.'}
                </Alert>
              ) : (
                <Alert severity={verdict.blocking ? 'error' : 'warning'}>
                  <AlertTitle>
                    {verdict.blocking
                      ? `Do not file — ${verdict.total} ${
                          verdict.total === 1 ? 'row needs' : 'rows need'
                        } attention`
                      : `${verdict.total} ${
                          verdict.total === 1 ? 'row needs' : 'rows need'
                        } attention before filing`}
                  </AlertTitle>
                  <Stack spacing={1.5} sx={{ mt: 1 }}>
                    {verdict.items.map((item) => (
                      <Stack key={item.id} spacing={0.5}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Chip
                            size="small"
                            color={
                              item.severity === 'blocking' ? 'error' : 'warning'
                            }
                            label={
                              item.severity === 'blocking'
                                ? 'Blocking'
                                : 'Review'
                            }
                          />
                          <Typography variant="subtitle2">
                            {`${item.count} · ${item.label}`}
                          </Typography>
                        </Stack>
                        <Typography variant="body2">{item.detail}</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Alert>
              )
            ) : null}

            <CardDisplay
              header={'Form 01-114 figures — Texas only'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#the-figures',
                excerpt:
                  'The lines to type into Webfile, in dollars, for Texas receipts only. Everything sold outside Texas is on the jurisdiction table instead.',
              })}
              contentGutterX
              contentGutterY
            >
              {/*
                Dimmed, not hidden, while a blocking finding stands: the
                preparer still needs to see the figures to investigate the
                findings — they just must not read as ready to file.
              */}
              <Box
                sx={{
                  opacity: payload && verdict.blocking ? 0.45 : 1,
                  transition: 'opacity 120ms',
                }}
              >
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{'Item'}</TableCell>
                      <TableCell>{'Line'}</TableCell>
                      <TableCell align="right">{'Amount'}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {webfileLines.map((line) => (
                      <TableRow key={line.label}>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          {line.item}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{line.label}</Typography>
                          <Typography variant="caption" color="text.secondary">
                            {line.note}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography
                            variant="h6"
                            sx={{ fontFamily: 'monospace' }}
                            color={
                              line.dollars === null
                                ? 'text.secondary'
                                : 'text.primary'
                            }
                          >
                            {payload
                              ? (line.dollars ?? 'not computed')
                              : loading
                                ? '…'
                                : '—'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
              {payload && verdict.blocking ? (
                <Typography variant="body2" color="error" sx={{ mt: 2 }}>
                  {'These figures are incomplete — see the findings above. ' +
                    'Do not type them into Webfile.'}
                </Typography>
              ) : null}
            </CardDisplay>

            <GridItems
              spacing={3}
              items={[
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Refunds recorded in the period'}
                      help={docsHelp('salesTaxReturn', {
                        anchor: '#refunds',
                        excerpt:
                          'Refunds are stated, never netted out of the figures — a row carries only its latest refund stamp, so applying them is the preparer’s call.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                          {'Stated, not netted. A row keeps only its latest ' +
                            'refund stamp, so two refunds in different ' +
                            'quarters cannot be split apart from the row — ' +
                            'applying these to the return is a judgement, ' +
                            'not a computation.'}
                        </Typography>
                        {[
                          {
                            label: 'Rows refunded',
                            value: String(refunds?.rowsRefundedInPeriod ?? 0),
                          },
                          {
                            label: 'Refunded gross',
                            value: `$${centsToDollars(
                              refunds?.refundedGrossCents,
                            )}`,
                          },
                          {
                            label: 'Estimated refunded tax',
                            value: `$${centsToDollars(
                              refunds?.estimatedRefundedTaxCents,
                            )}`,
                          },
                        ].map((entry) => (
                          <Stack
                            key={entry.label}
                            direction="row"
                            sx={{ justifyContent: 'space-between' }}
                          >
                            <Typography variant="body2">
                              {entry.label}
                            </Typography>
                            <Typography
                              variant="body2"
                              sx={{ fontFamily: 'monospace' }}
                            >
                              {payload ? entry.value : '—'}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </CardDisplay>
                  ),
                },
                {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={'Period bounds'}
                      help={docsHelp('salesTaxReturn', {
                        anchor: '#the-figures',
                        excerpt:
                          'The exact UTC window the figures were swept from — echoed so a filed return can be reproduced later.',
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1}>
                        <Typography variant="body2" color="text.secondary">
                          {'The exact window swept, echoed so a filed return ' +
                            'can be reproduced from the same bounds later.'}
                        </Typography>
                        {[
                          {
                            label: 'From (UTC)',
                            value: payload?.summary?.periodStart,
                          },
                          {
                            label: 'To (UTC, exclusive)',
                            value: payload?.summary?.periodEnd,
                          },
                          {
                            label: 'Invoices swept',
                            value:
                              payload &&
                              String(payload.summary?.transactionCount ?? 0),
                          },
                        ].map((entry) => (
                          <Stack
                            key={entry.label}
                            direction="row"
                            spacing={1}
                            sx={{ justifyContent: 'space-between' }}
                          >
                            <Typography variant="body2">
                              {entry.label}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{ fontFamily: 'monospace' }}
                              color="text.secondary"
                            >
                              {entry.value ?? '—'}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </CardDisplay>
                  ),
                },
              ]}
            />

            <CardDisplay
              header={'All jurisdictions'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#all-jurisdictions',
                excerpt:
                  'Every buyer state in the period. Texas is the return; the rest is the audit trail for why that revenue is not on it, and the early warning for nexus elsewhere.',
              })}
              contentGutterX
              contentGutterY
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {'Texas is the return. The other rows are the record of why ' +
                  'the rest of the period is not on it — and the ' +
                  'early-warning list for economic nexus in another state.'}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Jurisdiction'}</TableCell>
                    <TableCell align="right">{'Invoices'}</TableCell>
                    <TableCell align="right">{'Total sales'}</TableCell>
                    <TableCell align="right">{'Taxable sales'}</TableCell>
                    <TableCell align="right">{'Tax collected'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {jurisdictions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          {payload
                            ? 'No invoices in this period.'
                            : loading
                              ? 'Loading…'
                              : '—'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    jurisdictions.map((row) => (
                      <TableRow key={row.jurisdiction}>
                        <TableCell>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center' }}
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: 'monospace',
                                fontWeight: row.isTexas ? 600 : 400,
                              }}
                            >
                              {row.jurisdiction}
                            </Typography>
                            {row.isTexas ? (
                              <Chip
                                size="small"
                                color="primary"
                                label="On the return"
                              />
                            ) : null}
                            {row.jurisdiction === 'unknown' ? (
                              <Chip
                                size="small"
                                color="warning"
                                label="No address"
                              />
                            ) : null}
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          {row.transactionCount}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`$${row.totalSalesDollars}`}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`$${row.taxableSalesDollars}`}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`$${row.taxCollectedDollars}`}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminTaxReturn.displayName = 'Page:AdminTaxReturn'

export default AdminTaxReturn

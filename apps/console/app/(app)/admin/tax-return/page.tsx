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
 * SALES TAX — the return for one filing period (AGL-1900 / AGL-1811).
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
 * **Never show platform totals where the return wants one jurisdiction.** The
 * filing figures come from `byJurisdiction[configured code]`. The "Aglyn's own
 * sales by jurisdiction" table below is the audit trail for why the rest of
 * the quarter is not on the return.
 *
 * **Never leave the jurisdiction unsaid.** The same quarter filed in two
 * jurisdictions is two different returns, and this page named neither — it
 * read Texas everywhere and said so nowhere, so a self-host operator filing in
 * California or the United Kingdom was handed Texas Comptroller lines with
 * their own figures in them. The heading, the figures card and the export all
 * name the configured jurisdiction, and a jurisdiction with no exporter of its
 * own gets a breakdown that says out loud it is not a return.
 *
 * **Never let one taxpayer's table answer for another's** (AGL-1956). That
 * table used to call itself the economic-nexus early warning, and it reads
 * `platformRevenue` — Aglyn's own invoices. Nexus from MERCHANTS' sales is a
 * different taxpayer's money and is answered by "Facilitated sales by buyer
 * state" in the storefront card. Two adjacent tables, never one: the rule that
 * `platformRevenue` and `storefrontTaxCollected` are never summed is what
 * keeps both figures meaning something.
 *
 * **Never claim a figure it did not compute.** Taxable purchases (use tax on
 * Aglyn's own purchases) is not in `platformRevenue`; the line says NOT
 * COMPUTED rather than printing a zero that would pass for a derived one.
 *
 * **Never leave a bucket in the JSON.** The route computes THREE sets of
 * figures and this page showed one (AGL-2163). Storefront (AGL-1904) reached
 * the screen only as an attention count and two Webfile footnotes; marketplace
 * (AGL-2137) did not reach it at all — two of the three buckets a human files
 * from existed only in a response nobody sees, which is the same failure this
 * page was raised to fix. Both are rendered below, each as its own card, each
 * with its own liability sentence, and with NO grand total anywhere: adding
 * them is the mistake the three-way split exists to prevent.
 *
 * Read-only, like the route: this page files nothing and writes nothing. The
 * filing happens at the authority's own keyboard — the Comptroller's Webfile,
 * for Texas — which is why the export is a spreadsheet of working papers and
 * the credentials ride along.
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
import { taxRegistrationSetupHint } from '../../../../utils/tax-jurisdictions'
import {
  centsToDollars,
  defaultTaxReturnPeriod,
  taxReturnAttention,
  taxReturnCsv,
  taxReturnCsvFilename,
  taxReturnFacilitatedJurisdictionRows,
  taxReturnFilingLines,
  taxReturnJurisdictionRows,
  taxReturnMarketplaceLines,
  taxReturnPeriodOptions,
  taxReturnRegistration,
  taxReturnStorefrontRows,
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
  const registration = useMemo(() => taxReturnRegistration(payload), [payload])
  // WHICH AUTHORITY THIS IS FOR. It rides on the payload, so nothing names a
  // jurisdiction until the response has said which one — a heading that
  // defaults to Texas while the request is in flight is a Texas return in the
  // only glance most readers give it.
  const filing = registration.jurisdiction
  // Named only once the response has said which jurisdiction it is. Copy that
  // reads "US-TX" for the second before a GB deployment's figures land is the
  // same wrong-jurisdiction glance the heading is guarded against.
  const filingName = payload ? filing.code : 'The filing jurisdiction'
  const filingLines = useMemo(() => taxReturnFilingLines(payload), [payload])
  const jurisdictions = useMemo(
    () => taxReturnJurisdictionRows(payload),
    [payload],
  )
  // The other two of the three buckets the route computes (AGL-2163).
  // Facilitated sales BY STATE (AGL-1956) — already computed server-side and
  // already in this payload; nothing rendered it, so the nexus question had no
  // answer on any screen. See `taxReturnFacilitatedJurisdictionRows`.
  const facilitatedByState = useMemo(
    () => taxReturnFacilitatedJurisdictionRows(payload),
    [payload],
  )
  const storefrontBuckets = useMemo(
    () => taxReturnStorefrontRows(payload),
    [payload],
  )
  const marketplaceLines = useMemo(
    () => taxReturnMarketplaceLines(payload),
    [payload],
  )

  const handleExport = useCallback(() => {
    const csv = taxReturnCsv(payload)
    if (!csv) return
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = taxReturnCsvFilename(
      payload?.period ?? period,
      payload?.registration?.jurisdiction,
    )
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
        children: payload
          ? `${filing.label} Sales Tax Return`
          : 'Sales Tax Return',
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
                {/*
                  WHICH JURISDICTION EVERY FIGURE BELOW IS FOR. Beside the
                  period, because the two together are the only thing that
                  identifies what is on this screen: the same quarter filed in
                  two jurisdictions is two different returns, and the page used
                  to name neither out loud.
                */}
                {payload ? (
                  <Chip
                    size="small"
                    color={filing.recognized ? 'default' : 'error'}
                    variant="outlined"
                    label={`Jurisdiction ${filing.code}`}
                  />
                ) : null}
                {/*
                  AGL-2021. The registration comes from server-only env via the
                  staff-gated route, so it is absent on any deployment that has
                  not configured one. Says so in words — and names the
                  variables to set — rather than rendering a label with nothing
                  after it, because a filer copying a number off this corner
                  must never be handed a blank.
                */}
                <Stack sx={{ ml: { sm: 'auto' } }}>
                  {!payload ? null : registration.configured ? (
                    <>
                      <Typography variant="caption" color="text.secondary">
                        {`${filing.registrationIdLabel} ${registration.registrationId}`}
                      </Typography>
                      {registration.filingId ? (
                        <Typography variant="caption" color="text.secondary">
                          {`${filing.filingIdLabel} ${registration.filingId}`}
                        </Typography>
                      ) : null}
                    </>
                  ) : (
                    <Typography variant="caption" color="warning.main">
                      {taxRegistrationSetupHint(filing)}
                    </Typography>
                  )}
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
              header={payload ? filing.figuresHeader : 'Return figures'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#the-figures',
                excerpt:
                  'The filing figures, in dollars, for the configured jurisdiction only. Everything sold elsewhere is on the jurisdiction table instead.',
              })}
              contentGutterX
              contentGutterY
            >
              {/*
                THE DOCUMENT SAYS WHAT IT IS. Texas has an exporter that knows
                Form 01-114's own lines; every other jurisdiction gets what was
                collected there and nothing about the form, because nothing
                here knows the form. A breakdown read as a return is the
                failure this banner exists to prevent, and it is stated on the
                screen as well as in the export because only one of those gets
                looked at twice.
              */}
              {payload && filing.form !== 'tx-webfile' ? (
                <Alert severity="info" sx={{ mb: 2 }}>
                  <AlertTitle>
                    {`A breakdown for manual filing — not a ${filing.code} return`}
                  </AlertTitle>
                  {'These are the figures a return is assembled from: what ' +
                    'was collected in this jurisdiction, and on what base. ' +
                    'No form for this jurisdiction is known here, so nothing ' +
                    'below is a form line — transcribe them onto the return ' +
                    'the authority asks for.'}
                </Alert>
              ) : null}
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
                    {filingLines.map((line) => (
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
                    (filing.form === 'tx-webfile'
                      ? 'Do not type them into Webfile.'
                      : 'Do not file from them.')}
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
                            'applying these to the return is a judgment, ' +
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

            {/*
              THE SECOND BUCKET (AGL-1904/2163): tax on MERCHANTS' storefront
              sales. Split by who owes it, never summed — `aglynLiable` is
              money in Aglyn's balance under Aglyn's own registrations, and
              `merchantManual` never touched them. One "storefront tax" total
              would merge those two facts into a number that is true of
              neither.
            */}
            <CardDisplay
              header={'Storefront commerce tax — merchants’ sales'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#the-figures',
                excerpt:
                  'Tax charged to shoppers on merchants’ storefronts, split by who owes it. None of it is in the filing figures above.',
              })}
              contentGutterX
              contentGutterY
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {`None of this is in the ${
                  filing.form === 'tx-webfile' ? 'Webfile' : 'breakdown'
                } figures above, which sum ` +
                  'Aglyn’s OWN sales only. The first row is the one that ' +
                  'needs a decision: those sessions are created on Aglyn’s ' +
                  'platform account, so Stripe computed that tax against ' +
                  'Aglyn’s registrations and it settled into Aglyn’s balance.'}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Bucket'}</TableCell>
                    <TableCell align="right">{'Sales'}</TableCell>
                    <TableCell align="right">{'Gross'}</TableCell>
                    <TableCell align="right">{'Taxable sales'}</TableCell>
                    <TableCell align="right">{'Tax collected'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {storefrontBuckets.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          {payload
                            ? 'This period’s response carries no storefront figures.'
                            : loading
                              ? 'Loading…'
                              : '—'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    storefrontBuckets.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <Stack spacing={0.5}>
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                            >
                              <Typography variant="body2">
                                {row.label}
                              </Typography>
                              {row.aglynLiable ? (
                                <Chip
                                  size="small"
                                  color="warning"
                                  label="Aglyn holds this"
                                />
                              ) : null}
                            </Stack>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              {row.liability}
                            </Typography>
                          </Stack>
                        </TableCell>
                        <TableCell align="right">
                          {row.transactionCount}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`$${row.grossDollars}`}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {`$${row.taxableSalesDollars}`}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            fontFamily: 'monospace',
                            fontWeight: row.aglynLiable ? 600 : 400,
                          }}
                        >
                          {`$${row.taxCollectedDollars}`}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              {payload?.storefront?.truncated ? (
                <Typography variant="body2" color="error" sx={{ mt: 2 }}>
                  {'Storefront rows exceeded the row cap — these figures are ' +
                    'a lower bound.'}
                </Typography>
              ) : null}

              {/*
                WHERE THE SHOPPERS WERE (AGL-1956). Aglyn is a marketplace
                facilitator, so every state asks the same question — how much
                did you facilitate into me, in how many transactions — and
                nothing on any screen could answer it. The figures were already
                being computed by `storefrontTaxSummary` and already arriving in
                this payload; only the rendering was missing.

                The three liability buckets are SUMMED here, deliberately: a
                threshold counts the sale whoever remits the tax. Who remits is
                still carried per row, so the nexus question and the "what do we
                owe" question stay separable.
              */}
              <Typography variant="subtitle2" sx={{ mt: 3 }}>
                {'Facilitated sales by buyer state'}
              </Typography>
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 0.5, mb: 1.5 }}
              >
                {'What Aglyn facilitated into each state, whoever remits the ' +
                  'tax — the figure an economic-nexus threshold is measured ' +
                  `against. ${filingName} needs no threshold: the filer is ` +
                  'established there, so the obligation is unconditional. A ' +
                  'region showing sales and no tax is the one to watch.'}
              </Typography>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'Buyer state'}</TableCell>
                    <TableCell align="right">{'Sales'}</TableCell>
                    <TableCell align="right">{'Total sales'}</TableCell>
                    <TableCell align="right">{'Tax collected'}</TableCell>
                    <TableCell align="right">{'Of which Aglyn owes'}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {facilitatedByState.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          {payload
                            ? 'No storefront sales recorded in this period.'
                            : loading
                              ? 'Loading…'
                              : '—'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    facilitatedByState.map((row) => (
                      <TableRow key={row.jurisdiction}>
                        <TableCell>
                          <Stack
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                          >
                            <Typography variant="body2">
                              {row.jurisdiction === 'unknown'
                                ? 'Not stated'
                                : row.jurisdiction}
                            </Typography>
                            {row.isFilingJurisdiction ? (
                              <Chip
                                size="small"
                                color="warning"
                                label="Registered"
                              />
                            ) : row.untaxed ? (
                              <Chip
                                size="small"
                                variant="outlined"
                                label="No tax collected"
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
                          {`$${row.taxCollectedDollars}`}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            fontFamily: 'monospace',
                            fontWeight:
                              Number(row.aglynLiableTaxDollars) > 0 ? 600 : 400,
                          }}
                        >
                          {`$${row.aglynLiableTaxDollars}`}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 1.5 }}
              >
                {'A LOWER BOUND. A storefront sale that collected no tax at ' +
                  'all files no row, so it is missing here — which is exactly ' +
                  'the population a nexus check wants. Recorded on AGL-1956.'}
              </Typography>
            </CardDisplay>

            {/*
              THE THIRD BUCKET (AGL-2137/2163). One liability arm, not three:
              marketplace checkout adds the tax EXCLUSIVE on the platform's own
              charge and pays the publisher from the pre-tax price, so all of
              it is Aglyn's. Stated as a platform figure with no jurisdiction
              breakdown because purchase rows store no buyer address — a
              "Texas" slice here would be a guess printed as a total.
            */}
            <CardDisplay
              header={'Marketplace tax — plugin and theme purchases'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#the-figures',
                excerpt:
                  'Tax on marketplace purchases. Charged on the platform’s own charge, kept platform-side, and in no filing line above.',
              })}
              contentGutterX
              contentGutterY
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {'All of this tax is Aglyn’s: it is added on top of the ' +
                  'listing price on Aglyn’s own charge, and the publisher’s ' +
                  'transfer is computed from the pre-tax price. No buyer ' +
                  'address is stored on a purchase row, so none of it can be ' +
                  'placed in a state — which is why it is absent from the ' +
                  'jurisdiction table below.'}
              </Typography>
              <Stack spacing={1}>
                {marketplaceLines.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    {payload
                      ? 'This period’s response carries no marketplace figures.'
                      : loading
                        ? 'Loading…'
                        : '—'}
                  </Typography>
                ) : (
                  marketplaceLines.map((line) => (
                    <Stack key={line.label} spacing={0.25}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ justifyContent: 'space-between' }}
                      >
                        <Typography variant="body2">{line.label}</Typography>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace' }}
                        >
                          {line.value}
                        </Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {line.note}
                      </Typography>
                    </Stack>
                  ))
                )}
              </Stack>
              {payload?.marketplace?.truncated ? (
                <Typography variant="body2" color="error" sx={{ mt: 2 }}>
                  {'Marketplace rows exceeded the row cap — these figures are ' +
                    'a lower bound.'}
                </Typography>
              ) : null}
            </CardDisplay>

            {/*
              THE LABEL WAS WRITING A CHEQUE THE SOURCE COULD NOT CASH
              (AGL-1956). This card reads `payload.summary`, which is
              `platformRevenue` — AGLYN'S OWN SaaS invoices. It nonetheless
              called itself "the early-warning list for economic nexus in
              another state", which is a question about FACILITATED storefront
              sales and is answered by the by-state table in the storefront card
              above. A staff reader checking nexus would have read Aglyn's
              subscription revenue and believed it was merchant sales.

              Relabelled rather than resourced: the two collections describe two
              different taxpayers' money and must never be summed, so the fix is
              two adjacent honest tables, not one merged one.
            */}
            <CardDisplay
              header={'Aglyn’s own sales by jurisdiction'}
              help={docsHelp('salesTaxReturn', {
                anchor: '#aglyns-own-sales-by-jurisdiction',
                excerpt:
                  'Every buyer state for Aglyn’s OWN subscription and add-on revenue in the period. The configured jurisdiction is the return; the rest is the audit trail for why that revenue is not on it. NOT the nexus list — see “Facilitated sales by buyer state”.',
              })}
              contentGutterX
              contentGutterY
            >
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mb: 1.5 }}
              >
                {'Aglyn’s own subscription and add-on revenue, by the ' +
                  `customer’s state. ${filingName} is the return; the other ` +
                  'rows are the record of why the rest of the period is not ' +
                  'on it. ' +
                  'For nexus from MERCHANTS’ sales, read “Facilitated sales ' +
                  'by buyer state” above — a different taxpayer’s money, and ' +
                  'never summed with this.'}
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
                                fontWeight: row.isFilingJurisdiction ? 600 : 400,
                              }}
                            >
                              {row.jurisdiction}
                            </Typography>
                            {row.isFilingJurisdiction ? (
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
                          {/*
                            THE WORKING PAPERS (AGL-2329).

                            `taxabilityReason`, `taxRateId`, `percentage`,
                            `rateState` and `jurisdiction` are written on
                            every tax line — three of them annotated "for the
                            working papers" at the writer — and nothing read
                            any of them. A jurisdiction row that states a
                            total and cannot say WHY is the figure without
                            the paper behind it: $0 of tax reads identically
                            whether we are unregistered, the product is
                            exempt, or the rate is genuinely zero, and an
                            examiner asks which one first.

                            Rendered under the jurisdiction rather than in a
                            column of its own because there are several per
                            row and they belong to it, not beside it.
                          */}
                          {row.taxabilityReasons.length ? (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}
                            >
                              {row.taxabilityReasons.map((paper) => (
                                <Chip
                                  key={paper.key}
                                  size="small"
                                  variant="outlined"
                                  label={`${paper.label}: $${paper.taxCollectedDollars} on $${paper.taxableSalesDollars}`}
                                />
                              ))}
                            </Stack>
                          ) : null}
                          {row.rates.length ? (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ display: 'block', mt: 0.5 }}
                            >
                              {`Rates: ${row.rates
                                .map(
                                  (rate) =>
                                    `${rate.label} — $${rate.taxCollectedDollars}`,
                                )
                                .join(' · ')}`}
                            </Typography>
                          ) : null}
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

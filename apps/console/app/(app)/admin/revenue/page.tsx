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
 * REVENUE — what Aglyn earned, on both bases, with the gap named (AGL-2486).
 *
 * Zach asked for reporting on "how much has been earned, net, gross, from
 * where, marketplace commission, commerce commission, monthly subscriptions,
 * add-ons", and — asked whether revenue meant settled cash or contracted plan
 * value — answered "Both, side by side".
 *
 * ## What this page must never do
 *
 * **Never present a fee as earnings.** A storefront sale's platform fee is
 * the advertised take PLUS Stripe's card processing, passed through at cost
 * (AGL-2152). On a destination charge Stripe debits the PLATFORM, so that
 * half is recovering money already spent. Reporting the whole fee would
 * overstate margin on every storefront sale and, on a small order, would
 * report the 30¢ Stripe just took as money Aglyn made. Both halves are shown,
 * and the earned column carries only the take.
 *
 * **Never show a refund as a neutral adjustment.** Stripe keeps its
 * processing fee on a refund and a lost dispute costs a further fee, so a
 * reversal is a LOSS and always was. It is subtracted, and the page says why
 * rather than leaving a smaller total unexplained.
 *
 * **Never let the two bases sit side by side without the gap.** Two totals
 * and a reader left to subtract has wasted the decision. The gap is the
 * point — it is dunning, failed cards, trials and comps — so it is a section
 * with named causes and an action for each, and any residual the page cannot
 * explain is shown as a residual rather than absorbed.
 *
 * **Never let a plan tier imply revenue.** `org.plan` is not revenue
 * (AGL-925): a comped org, a 100%-off coupon, a negotiated enterprise price
 * and an org carrying add-ons all diverge from the plan's list price. Every
 * figure here comes from the route, which computes them through the billing
 * helpers. This page does no revenue arithmetic of its own.
 *
 * Read-only, like the route: it reports and it writes nothing — to Firestore
 * or to Stripe.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
  Box,
  Chip,
  Divider,
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
import { useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import {
  defaultRevenuePeriod,
  dollars,
  earnedLines,
  gapCauses,
  money,
  ORG_STATE_LABELS,
  revenuePeriodOptions,
  usdDollars,
  usdMoney,
  type SourceAttributionView,
  type RevenuePayload,
} from '../../../../utils/revenue-view'

/**
 * One attributed source table — listing, publisher or host (AGL-2486).
 *
 * GAIN and LOSS sit side by side in every one of them. A refund or chargeback
 * with no name on it is the row someone most needs to chase, so a reversal is
 * never netted silently into the earnings column.
 */
function SourceTable({
  table,
  unit,
  countLabel,
  empty,
}: {
  table: SourceAttributionView | undefined
  unit: string
  countLabel: string
  empty: string
}) {
  const rows = table?.rows ?? []
  if (rows.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {empty}
      </Typography>
    )
  }
  return (
    <>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>{unit}</TableCell>
              <TableCell align="right">Earned</TableCell>
              <TableCell align="right">Returned</TableCell>
              <TableCell align="right">{countLabel}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>
                  {row.name}
                  {row.detail ? (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ display: 'block' }}
                    >
                      {row.detail}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell align="right">{money(row.gainCents)}</TableCell>
                <TableCell align="right">
                  {Number(row.lossCents ?? 0) > 0 ? (
                    <Typography variant="body2" color="error.main">
                      −{money(row.lossCents)}
                    </Typography>
                  ) : (
                    money(0)
                  )}
                </TableCell>
                <TableCell align="right">{row.count}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
      {Number(table?.omittedRows ?? 0) > 0 ? (
        <Alert severity="info" sx={{ mt: 2 }}>
          <AlertTitle>
            {table?.omittedRows} more not listed
          </AlertTitle>
          The table shows the largest contributors. The rest account for{' '}
          {money(table?.omittedGainCents)} earned and{' '}
          {money(table?.omittedLossCents)} returned between them, so these rows
          plus this line still add up to the total above — a shortened list,
          never a partial accounting.
        </Alert>
      ) : null}
    </>
  )
}

/** A large figure with its basis stated directly beneath it, never beside. */
function Figure({
  label,
  value,
  caption,
}: {
  label: string
  value: string
  caption: string
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h4" component="p">
        {value}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {caption}
      </Typography>
    </Stack>
  )
}

const AdminRevenue: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const isStaff = useIsStaff()

  // Read ONCE per mount: the period list and default must not shift under a
  // page left open across a month boundary while someone is reading it.
  const [now] = useState(() => new Date())
  const periodOptions = useMemo(() => revenuePeriodOptions(now), [now])
  const [period, setPeriod] = useState(() => defaultRevenuePeriod(now))

  const [payload, setPayload] = useState<RevenuePayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!isStaff || !user || !period) return
    let active = true
    setLoading(true)
    // Cleared BEFORE the new figures arrive: leaving the previous period's
    // totals under a newly-selected label would put one month's revenue under
    // another month's heading, and a screenshot of that is indistinguishable
    // from a real answer.
    setPayload(null)
    setError(null)
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/revenue?period=${encodeURIComponent(period)}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const body = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          setError(body?.error ?? 'Revenue report failed')
        } else {
          setPayload(body as RevenuePayload)
        }
      } catch {
        if (active) setError('Revenue report failed')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, user, period])

  const contracted = payload?.contracted
  const settled = payload?.settled
  const gap = payload?.gap
  const earned = useMemo(() => earnedLines(payload), [payload])
  const causes = useMemo(() => gapCauses(payload), [payload])
  const subscriptions = settled?.subscriptions ?? {}
  const marketplace = settled?.marketplace ?? {}
  const commerce = settled?.commerce ?? {}
  // TRUNCATION ONLY. `commerceQueryFailed` is deliberately NOT folded in
  // here: a query that could not run is not a sweep that hit a ceiling, and
  // reporting the failure as a row cap is what sent this page's own diagnosis
  // to the wrong half of the system (AGL-2486).
  const truncated =
    payload?.subscriptionsTruncated === true ||
    payload?.marketplaceTruncated === true ||
    payload?.contractedTruncated === true ||
    payload?.attention?.commerceTruncated === true
  const truncatedSources = payload?.truncatedSources ?? []
  // A CLOSED period cannot be compared like for like: contracted is a
  // run-rate measured today, settled is cash collected then. See the route's
  // `periodIsClosed` note — the page shows both figures and computes no
  // difference, rather than calling a known artefact "unexplained".
  const periodClosed = payload?.periodIsClosed === true
  const shownCauses = periodClosed
    ? causes.filter((cause) => cause.periodScoped)
    : causes
  const attributionRows = payload?.attribution?.rows ?? []

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Revenue', href: buildRoute(Route.ADMIN_REVENUE) },
      ]}
      help="revenue"
      header={{
        children: 'Revenue',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            <CardDisplay
              header="Period"
              help={docsHelp('revenue', {
                anchor: '#the-two-bases',
                excerpt:
                  'Pick the month or quarter to report. Settled figures are ranged over the period; contracted MRR is what the book bills today.',
              })}
              contentGutterX
              contentGutterY
            >
              <TextField
                select
                size="small"
                label="Period"
                value={period}
                onChange={(event) => setPeriod(event.target.value)}
                sx={{ minWidth: 240 }}
              >
                {periodOptions.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
            </CardDisplay>

            {loading ? <LinearProgress /> : null}
            {error ? (
              <Alert severity="error">
                <AlertTitle>Revenue report failed</AlertTitle>
                {error}
              </Alert>
            ) : null}

            {truncated ? (
              <Alert severity="warning">
                <AlertTitle>
                  {truncatedSources.length > 0
                    ? `A lower bound: ${truncatedSources.join(', ')}`
                    : 'These figures are a lower bound'}
                </AlertTitle>
                {truncatedSources.length > 0
                  ? `The sweep stopped at its safety ceiling for ${truncatedSources.join(
                      ', ',
                    )}, so those totals are incomplete. Every other figure on this page is whole.`
                  : 'The sweep stopped at its safety ceiling, so at least one total below is incomplete.'}{' '}
                Narrow the period rather than quoting the incomplete numbers. A
                period this large is past what a request-time report should
                compute — the answer is a precomputed monthly rollup, not a
                bigger ceiling.
              </Alert>
            ) : null}
            {payload?.periodPrecedesCoverage === true ||
            payload?.settledMirrorEmpty === true ? (
              <Alert severity="warning">
                <AlertTitle>
                  Settled figures do not cover this whole period
                </AlertTitle>
                {payload?.settledMirrorEmpty === true
                  ? `No invoice has ever been recorded, so every settled figure below is unanswerable rather than zero.`
                  : `Invoices have only been recorded since ${new Date(
                      String(payload?.settledCoverageStart),
                    ).toLocaleDateString()}. Anything ${PLATFORM_BRAND_NAME} collected before that was never mirrored, so the settled figures below are a lower bound for this period — not a measured zero.`}{' '}
                Contracted figures are unaffected: they are point-in-time and
                read the subscription mirror directly.
              </Alert>
            ) : null}
            {payload?.unbilledMeteredFailed === true ? (
              <Alert severity="warning">
                <AlertTitle>Unbilled metered usage could not be read</AlertTitle>
                The gap below is missing that cause entirely, so its residual is
                overstated by however much usage went unbilled.
              </Alert>
            ) : null}
            {payload?.commerceQueryFailed === true ? (
              <Alert severity="warning">
                <AlertTitle>Storefront orders could not be read</AlertTitle>
                The storefront commission below reads $0 because the query
                failed, not because there were no sales. The sweep needs the
                COLLECTION_GROUP index on <code>orders.createdAtMs</code> —
                check it is still declared in the Firestore index config and
                actually deployed, since indexes ship separately from the app.
              </Alert>
            ) : null}
            {Number(payload?.attention?.rowsOutsideEveryPeriod ?? 0) > 0 ? (
              <Alert severity="warning">
                <AlertTitle>
                  {payload?.attention?.rowsOutsideEveryPeriod} invoices carry no
                  payment date
                </AlertTitle>
                A date-range query cannot match a row whose timestamp is empty,
                so those invoices are invisible to every period and the settled
                figure is short by them.
              </Alert>
            ) : null}

            {/* ---- The two bases, side by side ---- */}
            <CardDisplay
              header="The two bases"
              help={docsHelp('revenue', {
                anchor: '#the-two-bases',
                excerpt:
                  'Contracted is what the book bills; settled is what Stripe collected. They answer different questions and the difference between them is the useful number.',
              })}
              contentGutterX
              contentGutterY
            >
              <GridItems
                spacing={3}
                items={[
                  {
                    size: { xs: 12, md: 6 },
                    children: (
                      <Figure
                        label="Contracted (monthly)"
                        value={`$${usdDollars(contracted?.total?.mrrUsd)}`}
                        caption={`${
                          contracted?.total?.orgs ?? 0
                        } live subscriptions, net of discounts. What the book bills right now — a signup counts the moment its subscription lands. This is a point-in-time figure, not a figure for the selected period.`}
                      />
                    ),
                  },
                  {
                    size: { xs: 12, md: 6 },
                    children: (
                      <Figure
                        label={`Settled & earned (${payload?.period ?? period})`}
                        value={money(settled?.totalEarnedCents)}
                        caption={`Money Stripe actually collected in the period and ${PLATFORM_BRAND_NAME} actually kept: subscriptions, marketplace commission and storefront take — net of sales tax, seller payouts, card processing, refunds and disputes.`}
                      />
                    ),
                  },
                ]}
              />
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  These are not two attempts at the same number. Contracted is a
                  monthly run-rate for the book as it stands today; settled is
                  cash that arrived during the selected period and includes
                  marketplace and storefront commission that the contracted
                  figure has no concept of. Compare them only through the gap
                  section below, which compares like with like.
                </Typography>
              </Box>
            </CardDisplay>

            {/* ---- How each org status is treated ---- */}
            <CardDisplay
              header="How each org is treated"
              help={docsHelp('revenue', {
                anchor: '#how-each-org-is-treated',
                excerpt:
                  'Comped, trialing and past-due orgs each contribute differently to the two bases. Stated here rather than left in the code.',
              })}
              contentGutterX
              contentGutterY
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Org state</TableCell>
                    <TableCell align="right">Count</TableCell>
                    <TableCell align="right">Contracted</TableCell>
                    <TableCell align="right">Settled</TableCell>
                    <TableCell>Why</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>Active and collecting</TableCell>
                    <TableCell align="right">
                      {contracted?.collecting?.orgs ?? 0}
                    </TableCell>
                    <TableCell align="right">
                      ${usdDollars(contracted?.collecting?.mrrUsd)}
                    </TableCell>
                    <TableCell align="right">counted</TableCell>
                    <TableCell>
                      A live Stripe subscription that is billing. The only group
                      expected to appear on both sides.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Trialing</TableCell>
                    <TableCell align="right">
                      {contracted?.trialing?.orgs ?? 0}
                    </TableCell>
                    <TableCell align="right">
                      ${usdDollars(contracted?.trialing?.mrrUsd)}
                    </TableCell>
                    <TableCell align="right">$0</TableCell>
                    <TableCell>
                      Counted in contracted MRR because the subscription is
                      real; settles nothing until the trial converts. Not a
                      failure.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Past due</TableCell>
                    <TableCell align="right">
                      {contracted?.pastDue?.orgs ?? 0}
                    </TableCell>
                    <TableCell align="right">
                      ${usdDollars(contracted?.pastDue?.mrrUsd)}
                    </TableCell>
                    <TableCell align="right">$0</TableCell>
                    <TableCell>
                      Owed and unpaid — Stripe is retrying the card. Counted as
                      contracted because the money is genuinely owed.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Comped / staff override</TableCell>
                    <TableCell align="right">
                      {contracted?.compedOrgs ?? 0}
                    </TableCell>
                    <TableCell align="right">$0</TableCell>
                    <TableCell align="right">$0</TableCell>
                    <TableCell>
                      On a paid plan with no Stripe subscription behind it. It
                      bills nothing, so it contributes nothing to either base —
                      deliberately with no dollar figure at all, because pricing
                      a comp off the plan table would invent revenue that never
                      existed.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  A plan tier is not a price. A comped org, an org on a 100%-off
                  coupon, an enterprise org on a negotiated rate and an org
                  carrying add-ons all bill something other than their plan’s
                  list price, so every figure on this page is derived from the
                  Stripe subscription mirror rather than from the plan field.
                  Discounts given away this month:{' '}
                  <strong>${usdDollars(contracted?.discountUsd)}</strong> off a
                  list price of ${usdDollars(contracted?.total?.listPriceUsd)}.
                </Typography>
              </Box>
            </CardDisplay>

            {/* ---- The gap ---- */}
            <CardDisplay
              header="The gap, and what is in it"
              help={docsHelp('revenue', {
                anchor: '#the-gap',
                excerpt:
                  'Contracted MRR for the orgs that should be collecting, minus the subscription cash that actually settled — decomposed into causes.',
              })}
              contentGutterX
              contentGutterY
            >
              <GridItems
                spacing={3}
                items={[
                  {
                    size: { xs: 12, md: 4 },
                    children: (
                      <Figure
                        label="Should have collected"
                        value={money(gap?.collectingMrrCents)}
                        caption={
                          periodClosed
                            ? 'Contracted MRR excluding trialing and past-due. Measured TODAY, not during the period below — a run-rate, not a historical figure.'
                            : 'Contracted MRR excluding trialing and past-due, which settle $0 by definition.'
                        }
                      />
                    ),
                  },
                  {
                    size: { xs: 12, md: 4 },
                    children: (
                      <Figure
                        label="Subscription cash settled"
                        value={money(gap?.settledSubscriptionCents)}
                        caption="Paid invoices in the period, net of tax and of every reversal. Marketplace and storefront are excluded here so the comparison is like for like."
                      />
                    ),
                  },
                  {
                    size: { xs: 12, md: 4 },
                    children: periodClosed ? (
                      <Figure
                        label="Gap"
                        value="Not comparable"
                        caption="This period has ended, so the two figures beside this one are measured at different instants. No difference is computed — see below."
                      />
                    ) : (
                      <Figure
                        label="Gap"
                        value={money(gap?.gapCents)}
                        caption="Positive means money contracted that did not arrive. Negative means cash arrived that the contracted base does not account for — most often an annual invoice landing in one month, or a subscription that has since ended. The causes below account for it."
                      />
                    ),
                  },
                ]}
              />
              {periodClosed ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                  <AlertTitle>
                    No gap is shown for a period that has ended
                  </AlertTitle>
                  Contracted is what the book bills <strong>today</strong>;
                  settled is cash collected <strong>during the period</strong>.
                  Subtracting them would measure two different instants, so a
                  subscription that collected in the period and has since ended
                  shows up as cash with no contracted counterpart — and the
                  difference would look like a modelling failure every time.
                  That case is known and modelled, not unexplained, so this page
                  declines to compute a residual rather than label it one. A
                  past period&apos;s contracted base is not recoverable: org
                  records carry only current state and nothing snapshots MRR per
                  month.
                </Alert>
              ) : null}
              <Divider sx={{ my: 2 }} />
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Cause</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>What it means</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {shownCauses.map((cause) => (
                    <TableRow key={cause.id}>
                      <TableCell>{cause.label}</TableCell>
                      <TableCell align="right">
                        {money(cause.cents)}
                      </TableCell>
                      <TableCell>{cause.action}</TableCell>
                    </TableRow>
                  ))}
                  {periodClosed ? null : (
                    <TableRow>
                      <TableCell>
                        <strong>Unexplained residual</strong>
                      </TableCell>
                      <TableCell align="right">
                        <strong>{money(gap?.unexplainedCents)}</strong>
                      </TableCell>
                      <TableCell>
                        What is left once every cause above is accounted for. A
                        large residual means something this page does not model
                        — a mid-period signup or cancellation, a proration, or
                        an invoice that has not been paid yet. Investigate it;
                        do not treat it as noise.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
              {payload?.unbilledMeteredApplies === false ? (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="body2" color="text.secondary">
                    Unbilled metered usage is not available for a quarter — the
                    usage rollup keys on a single month. Select a month to see
                    it. The $0 above is “not measured”, not “nothing missed”.
                  </Typography>
                </Box>
              ) : null}
            </CardDisplay>

            {/* ---- Who produced the numbers ---- */}
            <CardDisplay
              header="Which orgs did what"
              help={docsHelp('revenue', {
                anchor: '#how-each-org-is-treated',
                excerpt:
                  'Every figure above, traced to the org behind it. Contracted MRR is measured today; settled cash is measured over the selected period.',
              })}
              contentGutterX
              contentGutterY
            >
              <Typography variant="body2" color="text.secondary" gutterBottom>
                The totals above, attributed. <strong>Contracted</strong> is
                what each org bills today; <strong>settled</strong> is what it
                actually paid during the period, net of tax and reversals. The
                two columns answer different questions on purpose — an org can
                have one without the other, and that is usually the interesting
                row rather than an error.
              </Typography>
              {attributionRows.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No org contributed to either base in this period. That is a
                  real answer, not a failed read — every banner above would be
                  showing if a query had failed.
                </Typography>
              ) : (
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Org</TableCell>
                        <TableCell>State</TableCell>
                        <TableCell>Plan</TableCell>
                        <TableCell align="right">Contracted / mo</TableCell>
                        <TableCell align="right">Settled in period</TableCell>
                        <TableCell align="right">Unbilled meter</TableCell>
                        <TableCell align="right">Invoices</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {attributionRows.map((row) => (
                        <TableRow key={row.orgId}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={
                                ORG_STATE_LABELS[String(row.state)] ??
                                String(row.state)
                              }
                              color={
                                row.state === 'collecting'
                                  ? 'success'
                                  : row.state === 'pastDue'
                                    ? 'error'
                                    : row.state === 'trialing'
                                      ? 'info'
                                      : 'default'
                              }
                            />
                          </TableCell>
                          <TableCell>{row.plan}</TableCell>
                          <TableCell align="right">
                            {usdMoney(row.mrrUsd)}
                          </TableCell>
                          <TableCell align="right">
                            {money(row.settledCents)}
                            {Number(row.refundedCents ?? 0) > 0 ? (
                              <Typography
                                variant="caption"
                                color="text.secondary"
                                sx={{ display: 'block' }}
                              >
                                after {money(row.refundedCents)} returned
                              </Typography>
                            ) : null}
                          </TableCell>
                          <TableCell align="right">
                            {Number(row.unbilledMeteredCents ?? 0) > 0 ? (
                              <Typography variant="body2" color="error.main">
                                −{money(row.unbilledMeteredCents)}
                              </Typography>
                            ) : (
                              money(0)
                            )}
                          </TableCell>
                          <TableCell align="right">{row.invoices}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
              {Number(payload?.attribution?.omittedOrgs ?? 0) > 0 ? (
                <Alert severity="info" sx={{ mt: 2 }}>
                  <AlertTitle>
                    {payload?.attribution?.omittedOrgs} more org(s) not listed
                  </AlertTitle>
                  The table shows the largest contributors. The rest carry{' '}
                  {usdMoney(payload?.attribution?.omittedMrrUsd)} of contracted
                  MRR and {money(payload?.attribution?.omittedSettledCents)} of
                  settled cash between them, so the rows above plus this line
                  still account for the totals — a shortened list, never a
                  partial accounting.
                </Alert>
              ) : null}
              {payload?.contractedTruncated === true ? (
                <Alert severity="warning" sx={{ mt: 2 }}>
                  <AlertTitle>This attribution is incomplete</AlertTitle>
                  The org sweep hit its safety ceiling, so orgs beyond it are in
                  neither the table nor the totals.
                </Alert>
              ) : null}
            </CardDisplay>

            {/* ---- Marketplace and storefront attribution ---- */}
            <CardDisplay
              header="Which plugin, and which storefront"
              help={docsHelp('revenue', {
                anchor: '#where-the-money-came-from',
                excerpt:
                  'Marketplace commission attributed by listing and by publisher; storefront take attributed by host. Each table sums to its line in "Where the money came from".',
              })}
              contentGutterX
              contentGutterY
            >
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Each source is attributed on the dimension it is actually
                measured in — commission by the plugin that earned it, take by
                the storefront that generated it. Every table sums to its own
                line in “Where the money came from”; a plugin table that did
                not would be worse than no plugin table.
              </Typography>

              <Typography variant="overline" color="text.secondary">
                Marketplace commission by listing
              </Typography>
              <SourceTable
                table={payload?.attributionByListing}
                unit="Listing"
                countLabel="Sales"
                empty={`No marketplace sale settled in this period. ${PLATFORM_BRAND_NAME}'s commission is a share of each sale, so no sales means no commission — not a failed read.`}
              />

              <Divider sx={{ my: 3 }} />
              <Typography variant="overline" color="text.secondary">
                Marketplace commission by publisher
              </Typography>
              <SourceTable
                table={payload?.attributionByPublisher}
                unit="Publisher"
                countLabel="Sales"
                empty={`No publisher earned ${PLATFORM_BRAND_NAME} a commission in this period.`}
              />

              <Divider sx={{ my: 3 }} />
              <Typography variant="overline" color="text.secondary">
                Storefront take by host
              </Typography>
              <SourceTable
                table={payload?.attributionByHost}
                unit="Storefront"
                countLabel="Orders"
                empty={`No storefront order settled in this period. Note this is ${PLATFORM_BRAND_NAME}'s take only — the shopper's spend is the merchant's money and is never counted here.`}
              />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ mt: 2 }}
              >
                Storefront figures above are the advertised take with
                Stripe&apos;s processing cost already subtracted, on the basis
                stated in “Gross versus net” below. Attribution is by host
                rather than by org because one org can run several storefronts,
                and rolling them up destroys the question.
              </Typography>
            </CardDisplay>

            {/* ---- Where the earned money came from ---- */}
            <CardDisplay
              header="Where the money came from"
              help={docsHelp('revenue', {
                anchor: '#where-the-money-came-from',
                excerpt:
                  'Earned revenue by source, each already net of the thing that would overstate it.',
              })}
              contentGutterX
              contentGutterY
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Source</TableCell>
                    <TableCell align="right">Earned</TableCell>
                    <TableCell>What is and is not in it</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {earned.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell>{line.label}</TableCell>
                      <TableCell align="right">
                        {money(line.cents)}
                      </TableCell>
                      <TableCell>{line.note}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell>
                      <strong>Total earned</strong>
                    </TableCell>
                    <TableCell align="right">
                      <strong>{money(settled?.totalEarnedCents)}</strong>
                    </TableCell>
                    <TableCell>
                      {`Net throughout. There is no gross figure here that means “${PLATFORM_BRAND_NAME}’s money” — see the gross-versus-net table below.`}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardDisplay>

            {/* ---- Gross vs net, unambiguously ---- */}
            <CardDisplay
              header="Gross versus net — what was subtracted"
              help={docsHelp('revenue', {
                anchor: '#gross-versus-net',
                excerpt:
                  `Every deduction between the money that moved through Stripe and the money ${PLATFORM_BRAND_NAME} kept, named and quantified.`,
              })}
              contentGutterX
              contentGutterY
            >
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Line</TableCell>
                    <TableCell align="right">Amount</TableCell>
                    <TableCell>Whose money</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  <TableRow>
                    <TableCell>
                      Subscription invoices paid (gross, tax included)
                    </TableCell>
                    <TableCell align="right">
                      ${dollars(subscriptions.grossCents)}
                    </TableCell>
                    <TableCell>
                      {`${PLATFORM_BRAND_NAME}’s, apart from the tax below.`}{' '}
                      {subscriptions.transactionCount ?? 0} invoices.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>— less sales tax collected</TableCell>
                    <TableCell align="right">
                      −${dollars(subscriptions.taxCents)}
                    </TableCell>
                    <TableCell>
                      The state’s. Held and remitted, never revenue.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      — less refunds and lost disputes
                    </TableCell>
                    <TableCell align="right">
                      −${dollars(subscriptions.refundedCents)}
                    </TableCell>
                    <TableCell>
                      A loss. Stripe keeps its processing fee on a refund and a
                      lost dispute costs a further fee, so the true cost is
                      higher than this line. Of this,{' '}
                      ${dollars(subscriptions.chargedBackCents)} was charged
                      back rather than refunded voluntarily.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Marketplace sales (buyer gross)</TableCell>
                    <TableCell align="right">
                      ${dollars(marketplace.grossCents)}
                    </TableCell>
                    <TableCell>
                      {`Mostly the publisher’s. ${PLATFORM_BRAND_NAME} keeps only the commission.`}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>— less publisher payouts</TableCell>
                    <TableCell align="right">
                      −${dollars(marketplace.sellerTransferCents)}
                    </TableCell>
                    <TableCell>The publisher’s. Transferred out.</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Storefront sales (shopper gross)</TableCell>
                    <TableCell align="right">
                      ${dollars(commerce.grossCents)}
                    </TableCell>
                    <TableCell>
                      The merchant’s. It transfers straight to their connected
                      account and is shown only for scale.
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Storefront platform fee collected</TableCell>
                    <TableCell align="right">
                      ${dollars(commerce.applicationFeeCents)}
                    </TableCell>
                    <TableCell>
                      {`Not all ${PLATFORM_BRAND_NAME}’s — see the next line.`}
                    </TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      — less card processing passed through at cost
                    </TableCell>
                    <TableCell align="right">
                      −${dollars(commerce.processingPassThroughCents)}
                    </TableCell>
                    <TableCell>
                      {`Stripe’s. On a destination charge Stripe debits ${PLATFORM_BRAND_NAME}’s balance for processing, and this half of the fee recovers exactly that. It is a recovery, not earnings, and reporting it as revenue would overstate every storefront sale.`}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
              <Box sx={{ mt: 2 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  useFlexGap
                  sx={{ flexWrap: 'wrap', rowGap: 1 }}
                >
                  {Number(subscriptions.internalTrafficCents ?? 0) > 0 ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`$${dollars(
                        subscriptions.internalTrafficCents,
                      )} of this is ${PLATFORM_BRAND_NAME}’s own tagged purchases — real cash, excluded from GA`}
                    />
                  ) : null}
                  {Number(marketplace.estimatedProcessingCostCents ?? 0) > 0 ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      color="warning"
                      label={`~$${dollars(
                        marketplace.estimatedProcessingCostCents,
                      )} of card processing on marketplace sales is NOT recovered — the commission above is gross of it`}
                    />
                  ) : null}
                  {Number(commerce.subscriptionOrders ?? 0) > 0 ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      color="warning"
                      label={`${commerce.subscriptionOrders} storefront subscription renewals recover no card cost — ${PLATFORM_BRAND_NAME} absorbs it`}
                    />
                  ) : null}
                </Stack>
              </Box>
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}

AdminRevenue.displayName = 'Page:AdminRevenue'

export default AdminRevenue

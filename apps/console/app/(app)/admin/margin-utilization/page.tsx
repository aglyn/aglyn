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

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { ceilingedWindow, useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  IconButton,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import {
  BANDS_WITHOUT_A_UNIT_COST,
  MARGIN_SCOPE_NOTE,
  UTILIZATION_BAND_LABELS,
  byWorstMargin,
  fleetUtilization,
  type BandUtilization,
  type OrgMarginRow,
} from '../../../../utils/margin-utilization'

/**
 * HOW MUCH OF WHAT THEY BOUGHT DO CUSTOMERS ACTUALLY USE?
 *
 * Every margin figure the business plans against rests on an assumed
 * utilization rate. `tier-margin-floor.spec.ts` pins what each tier yields at
 * 3 / 25 / 50 / 100% of its bands, and on Pro that ladder runs from 89.3% down
 * to 7.1%. Nothing measured which rung the platform is standing on.
 *
 * This page is the measurement, and the FLEET DISTRIBUTION at the top is the
 * point of it — the per-org table underneath exists to name the outlier the
 * distribution says is there.
 *
 * ## It scans on an ASK, never on mount
 *
 * The scan is four Firestore reads per organization: the org document, its
 * billing mirror, its newest usage rollup, and the Assist spend for that
 * rollup's month. A staff dashboard that spent that on every page load would
 * be a bill that grows with the customer base for a number nobody asked for.
 * So the page opens idle, and every page of organizations is a button press
 * whose cost is reported back on the page.
 *
 * ## It says what it did NOT read
 *
 * The route pages an id-ordered walk and reports a cursor when more
 * organizations exist. A median over part of the fleet is still worth having;
 * a median over part of the fleet presented as the whole one is not, so every
 * aggregate here is captioned with the number of organizations behind it and
 * the banner stays up while a cursor remains.
 */

/** Rows rendered in the per-org table. Beyond it the fold is still complete. */
const TABLE_CEILING = 200

const pct = (fraction: number | null): string =>
  fraction === null ? '—' : `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`

const usd = (amount: number): string =>
  `$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * A band reading, rendered so an absent denominator cannot be mistaken for a
 * zero one.
 *
 * `Uncapped` and `No allowance` are words rather than numbers on purpose. Both
 * states have a real usage figure and no percentage, and every way of forcing
 * one — 0%, 100%, a full bar, an empty bar — states something the data does
 * not support.
 */
function BandCell({ reading }: { reading: BandUtilization | undefined }) {
  // A row from a route that predates a band this bundle knows about. Version
  // skew between a deployed route and a cached page is not a reason to take
  // the whole margin table down, and an em dash says "not reported" without
  // claiming a reading.
  if (!reading) {
    return (
      <Typography variant="body2" color="text.secondary">
        —
      </Typography>
    )
  }
  if (reading.state === 'uncapped') {
    return (
      <Stack spacing={0.5}>
        <Chip label="Uncapped" size="small" color="tertiary" variant="outlined" />
        <Typography variant="caption" color="text.secondary">
          {reading.used.toLocaleString()} used
        </Typography>
      </Stack>
    )
  }
  if (reading.state === 'noAllowance') {
    return (
      <Stack spacing={0.5}>
        <Chip
          label="No allowance"
          size="small"
          color={reading.used > 0 ? 'warning' : 'default'}
          variant="outlined"
        />
        <Typography variant="caption" color="text.secondary">
          {reading.used.toLocaleString()} used
        </Typography>
      </Stack>
    )
  }
  const fraction = reading.fraction ?? 0
  return (
    <Stack spacing={0.5}>
      <Typography
        variant="body2"
        sx={{ fontWeight: fraction >= 1 ? 'bold' : undefined }}
      >
        {pct(fraction)}
      </Typography>
      <LinearProgress
        variant="determinate"
        // The BAR is clamped because a bar cannot show 340%; the NUMBER above
        // it is not, and it is the number that carries the fact.
        value={Math.min(100, fraction * 100)}
        color={fraction >= 1 ? 'error' : fraction >= 0.75 ? 'warning' : 'primary'}
      />
      <Typography variant="caption" color="text.secondary">
        {reading.used.toLocaleString()} of {reading.included.toLocaleString()}
      </Typography>
    </Stack>
  )
}

/** The per-org row's overflow menu — the table is row-click plus this. */
function RowActions({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <IconButton
        size="small"
        aria-label="Organization actions"
        onClick={(event) => {
          event.stopPropagation()
          setAnchor(event.currentTarget)
        }}
      >
        <Box component="span" sx={{ fontWeight: 'bold', lineHeight: 1 }}>
          ⋮
        </Box>
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        onClick={(event) => event.stopPropagation()}
      >
        <MenuItem
          onClick={() => {
            setAnchor(null)
            router.push(buildRoute(Route.ADMIN_ORG_DETAIL, { orgId }))
          }}
        >
          Open organization
        </MenuItem>
      </Menu>
    </>
  )
}

const AdminMarginUtilization: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const isStaff = useIsStaff()
  const router = useRouter()

  const [rows, setRows] = useState<OrgMarginRow[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  /** Null until the first scan — distinct from "scanned and found nothing". */
  const [scannedAt, setScannedAt] = useState<string | null>(null)
  const [reads, setReads] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(
    async (after: string | null) => {
      if (!user) return
      setLoading(true)
      setError(null)
      try {
        const response = await authorizedFetch(
          user,
          `/api/admin/margin-utilization${after ? `?after=${encodeURIComponent(after)}` : ''}`,
        )
        const payload = await response.json()
        if (!response.ok) {
          setError(payload?.error ?? 'Scan failed')
          return
        }
        // Appended, never replaced: each press continues the same id-ordered
        // walk, and a page dropped on the floor would silently shrink every
        // aggregate below.
        setRows((previous) => (after ? [...previous, ...payload.rows] : payload.rows))
        setCursor(payload.nextCursor ?? null)
        setReads((previous) => (after ? previous + payload.reads : payload.reads))
        setScannedAt(new Date().toISOString())
      } catch {
        setError('Scan failed')
      } finally {
        setLoading(false)
      }
    },
    [user],
  )

  const fleet = useMemo(() => fleetUtilization(rows), [rows])
  const ordered = useMemo(() => [...rows].sort(byWorstMargin), [rows])
  // Bounded, and it says when it bit. The FOLD above is over every row read;
  // only the rendering is capped, so no aggregate changes with this number.
  const table = useMemo(() => ceilingedWindow(ordered, TABLE_CEILING), [ordered])

  const bands = fleet.distributions

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Margin', href: buildRoute(Route.ADMIN_MARGIN_UTILIZATION) },
      ]}
      // The topic AND the heading. A bare topic key opens the same docs
      // destination as the staff overview page, which makes two help icons
      // interchangeable and lands the reader at the top of a long page.
      help={{ topic: 'staffConsole', anchor: '#billing-insight' }}
      header={{
        children: 'Margin & utilization',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            <CardDisplay
              header="Scan"
              help={docsHelp('staffConsole', {
                anchor: '#billing-insight',
                excerpt:
                  'Reads each organization’s newest usage rollup and prices it through the shared cost model. Four Firestore reads per organization, so it runs when asked rather than on load.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  Consumption of each included band, the resulting cost, and the
                  realised margin — for every organization, worst first. Four
                  Firestore reads per organization, which is why nothing is read
                  until this is pressed.
                </Typography>
                <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                  <Button
                    variant="contained"
                    disabled={loading || !isStaff}
                    onClick={() => scan(null)}
                  >
                    {scannedAt ? 'Rescan from the start' : 'Scan organizations'}
                  </Button>
                  {cursor ? (
                    <Button
                      variant="outlined"
                      disabled={loading}
                      onClick={() => scan(cursor)}
                    >
                      Scan the next page
                    </Button>
                  ) : null}
                </Stack>
                {loading ? <LinearProgress /> : null}
                {scannedAt ? (
                  <Typography variant="caption" color="text.secondary">
                    {fleet.orgs.toLocaleString()} organizations read,{' '}
                    {fleet.withRollup.toLocaleString()} with a usage rollup.{' '}
                    {reads.toLocaleString()} Firestore document reads so far.
                  </Typography>
                ) : null}
                {error ? <Alert severity="error">{error}</Alert> : null}
              </Stack>
            </CardDisplay>

            {/*
              THE UNREAD REMAINDER, while any remains. Stated before the
              figures rather than under them: a median captioned "of the
              organizations scanned" after the reader has already taken it as
              the fleet's is a caption doing no work.
            */}
            {cursor ? (
              <Alert severity="warning">
                <AlertTitle>This is part of the fleet, not all of it</AlertTitle>
                More organizations exist past the {fleet.orgs.toLocaleString()}{' '}
                read so far. Every figure below describes those{' '}
                {fleet.orgs.toLocaleString()} and no others. Keep scanning to
                complete it.
              </Alert>
            ) : null}

            {scannedAt === null ? (
              <Alert severity="info">
                <AlertTitle>Nothing has been read yet</AlertTitle>
                This page holds no figures until a scan runs. An empty table
                here is the absence of a measurement, not a report that margin
                is healthy.
              </Alert>
            ) : fleet.orgs === 0 ? (
              <Alert severity="info">
                <AlertTitle>No organizations exist</AlertTitle>
                The scan completed and found no organizations at all. There is
                no utilization to report — which is different from utilization
                being zero.
              </Alert>
            ) : (
              <>
                <CardDisplay
                  header="Utilization across the fleet"
                  help={docsHelp('staffConsole', {
                    anchor: '#billing-insight',
                    excerpt:
                      'The median and spread of each included band, measured against the band the organization’s own plan sells. Uncapped and zero bands are excluded rather than counted as 0%.',
                  })}
                  contentGutterX
                  contentGutterY
                >
                  <Stack spacing={2}>
                    <Typography variant="body2" color="text.secondary">
                      Each organization is measured against its OWN plan’s
                      bands. A band that is uncapped, or that the plan does not
                      include at all, has no percentage and is excluded from the
                      sample rather than folded in as zero.
                    </Typography>
                    <Box sx={{ overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Band</TableCell>
                            <TableCell align="right">Orgs</TableCell>
                            <TableCell align="right">Median</TableCell>
                            <TableCell align="right">25th</TableCell>
                            <TableCell align="right">75th</TableCell>
                            <TableCell align="right">90th</TableCell>
                            <TableCell align="right">Max</TableCell>
                            <TableCell align="right">Over band</TableCell>
                            <TableCell>Excluded</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {bands.map((band) => (
                            <TableRow key={band.band}>
                              <TableCell>
                                {UTILIZATION_BAND_LABELS[band.band]}
                                {/*
                                  A band with no unit cost is still a band a
                                  customer consumes. Marked rather than hidden,
                                  so its utilization is readable without being
                                  mistaken for a cost driver.
                                */}
                                {BANDS_WITHOUT_A_UNIT_COST.includes(band.band) ? (
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: 'block' }}
                                  >
                                    no unit cost
                                  </Typography>
                                ) : null}
                              </TableCell>
                              <TableCell align="right">{band.counted}</TableCell>
                              <TableCell align="right">
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 'bold' }}
                                >
                                  {pct(band.p50)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">{pct(band.p25)}</TableCell>
                              <TableCell align="right">{pct(band.p75)}</TableCell>
                              <TableCell align="right">{pct(band.p90)}</TableCell>
                              <TableCell align="right">{pct(band.max)}</TableCell>
                              <TableCell align="right">{band.overBand}</TableCell>
                              <TableCell>
                                <Stack
                                  direction="row"
                                  spacing={0.5}
                                  sx={{ flexWrap: 'wrap', gap: 0.5 }}
                                >
                                  {band.excludedUncapped ? (
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      color="tertiary"
                                      label={`${band.excludedUncapped} uncapped`}
                                    />
                                  ) : null}
                                  {band.excludedNoAllowance ? (
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      label={`${band.excludedNoAllowance} no allowance`}
                                    />
                                  ) : null}
                                  {band.usageWithNoAllowance ? (
                                    <Chip
                                      size="small"
                                      variant="outlined"
                                      color="warning"
                                      label={`${band.usageWithNoAllowance} spending it anyway`}
                                    />
                                  ) : null}
                                </Stack>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                    <Typography variant="caption" color="text.secondary">
                      Over {fleet.orgs.toLocaleString()} organizations
                      {fleet.withRollup < fleet.orgs
                        ? `, of which ${(
                            fleet.orgs - fleet.withRollup
                          ).toLocaleString()} have no usage rollup and count only toward Sites`
                        : ''}
                      . A dash means no organization in the sample has a
                      percentage on that band.
                    </Typography>
                  </Stack>
                </CardDisplay>

                <CardDisplay
                  header="Margin"
                  help={docsHelp('staffConsole', {
                    anchor: '#billing-insight',
                    excerpt:
                      'Net revenue less infrastructure COGS, on the same arithmetic the discount guardrail underwrites against. A contribution margin, not a profit.',
                  })}
                  contentGutterX
                  contentGutterY
                >
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                      <Chip
                        label={`Median margin ${pct(fleet.medianMarginPct)}`}
                        color={fleet.medianMarginPct === null ? 'default' : 'primary'}
                      />
                      <Chip
                        label={`${fleet.orgsUnderFloor} under the floor`}
                        color={fleet.orgsUnderFloor ? 'warning' : 'default'}
                        variant="outlined"
                      />
                      <Chip
                        label={`${fleet.orgsUnderwater} underwater`}
                        color={fleet.orgsUnderwater ? 'error' : 'default'}
                        variant="outlined"
                      />
                      <Chip
                        label={`${usd(fleet.totalCogsUsd)} cost / ${usd(
                          fleet.totalNetRevenueUsd,
                        )} net revenue`}
                        variant="outlined"
                      />
                    </Stack>
                    {fleet.medianMarginPct === null ? (
                      <Alert severity="info">
                        No organization in this scan bills anything, so there is
                        no margin to report. That is an absence of revenue, not
                        a margin of zero.
                      </Alert>
                    ) : null}
                    <Typography variant="caption" color="text.secondary">
                      {MARGIN_SCOPE_NOTE}
                    </Typography>
                  </Stack>
                </CardDisplay>

                <CardDisplay
                  header="By organization, worst margin first"
                  help={docsHelp('staffConsole', {
                    anchor: '#organizations-admin',
                    excerpt:
                      'One row per organization scanned, ordered so the thinnest margin surfaces first. Select a row to open that organization.',
                  })}
                  contentGutterX
                  contentGutterY
                >
                  <Stack spacing={2}>
                    {table.truncated ? (
                      <Alert severity="info">
                        Showing the {TABLE_CEILING} worst of{' '}
                        {ordered.length.toLocaleString()} organizations read.
                        Every figure above still covers all of them.
                      </Alert>
                    ) : null}
                    <Box sx={{ overflowX: 'auto' }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Organization</TableCell>
                            <TableCell>Plan</TableCell>
                            <TableCell>Month</TableCell>
                            <TableCell align="right">Net revenue</TableCell>
                            <TableCell align="right">COGS</TableCell>
                            <TableCell align="right">Margin</TableCell>
                            {bands.map((band) => (
                              <TableCell key={band.band}>
                                {UTILIZATION_BAND_LABELS[band.band]}
                              </TableCell>
                            ))}
                            <TableCell align="right" />
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {table.rows.map((row) => (
                            <TableRow
                              key={row.orgId}
                              hover
                              sx={{ cursor: 'pointer' }}
                              onClick={() =>
                                router.push(
                                  buildRoute(Route.ADMIN_ORG_DETAIL, {
                                    orgId: row.orgId,
                                  }),
                                )
                              }
                            >
                              <TableCell>{row.name ?? row.orgId}</TableCell>
                              <TableCell>{row.plan}</TableCell>
                              <TableCell>
                                {row.month ?? (
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label="No rollup"
                                  />
                                )}
                              </TableCell>
                              <TableCell align="right">
                                {usd(row.netRevenueUsd)}
                              </TableCell>
                              <TableCell align="right">
                                {usd(row.cogs.cogsUsd)}
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ display: 'block' }}
                                >
                                  {/*
                                    WHICH ARM PRODUCED THE FIGURE. `floor` means
                                    the meters came in under the flat per-site
                                    estimate, so the number says nothing about
                                    what this organization actually consumed.
                                  */}
                                  {row.cogs.basis}
                                </Typography>
                              </TableCell>
                              <TableCell align="right">
                                {row.marginPct === null ? (
                                  <Chip
                                    size="small"
                                    variant="outlined"
                                    label="Not billing"
                                  />
                                ) : (
                                  <Chip
                                    size="small"
                                    label={pct(row.marginPct)}
                                    color={
                                      row.rating === 'ok'
                                        ? 'success'
                                        : row.rating === 'warn'
                                          ? 'warning'
                                          : 'error'
                                    }
                                  />
                                )}
                              </TableCell>
                              {bands.map((band) => (
                                <TableCell key={band.band} sx={{ minWidth: 120 }}>
                                  <BandCell reading={row.bands[band.band]} />
                                </TableCell>
                              ))}
                              <TableCell align="right">
                                <RowActions orgId={row.orgId} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </Box>
                  </Stack>
                </CardDisplay>
              </>
            )}
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}

AdminMarginUtilization.displayName = 'Page:AdminMarginUtilization'

export default AdminMarginUtilization

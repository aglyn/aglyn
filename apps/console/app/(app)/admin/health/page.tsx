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
 * PLATFORM HEALTH — the probes, on a screen (AGL-1900).
 *
 * Five capabilities shipped as endpoints nobody could reach without a curl:
 * serving health, backups and exports (AGL-1490/1843), durable rate-limiter
 * fallback (AGL-1693), signup-wave detection (AGL-1536) and email
 * deliverability (AGL-709) — plus the CSP violation counters (AGL-1799),
 * which are what a directive flip is decided from. Each answers a question
 * an operator has on a bad day. None of them had a screen.
 *
 * ## Invariants
 *
 * **A 503 is the report, not a broken read.** The `/api/health/*` family
 * speaks a 200/503 contract, so a degraded probe answers 503 with a full
 * body. See `readHealthResponse`.
 *
 * **Three states, never two.** ok / degraded / unreachable. A probe that
 * refused or never answered renders as its own thing and can never be
 * mistaken for green — including in the headline, which requires every probe
 * to have ANSWERED before it says all clear.
 *
 * **Every tile says what it means and what to do.** A red light with a code
 * on it is a puzzle; the descriptors carry the consequence and the first
 * step, because the person reading this at 3am should not need the issue
 * history to act.
 *
 * Read-only: everything here is a GET. The remedies point at Lockdown and
 * the runbooks, which is where the levers actually live.
 */

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container, GridItems } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  AlertTitle,
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
import ScopeDriftCard from '../../../../components/scope-drift-card.component'
import PendingErasuresCard from '../../../../components/pending-erasures-card.component'
import IdempotencyClaimsCard from '../../../../components/idempotency-claims-card.component'
import ServerConfigCard from '../../../../components/server-config-card.component'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useIsStaff } from '../../../../hooks/use-is-staff'
import {
  HEALTH_PROBES,
  readCspReport,
  readEmailHealthResponse,
  readHealthResponse,
  summarizePlatformHealth,
  type CspReportView,
  type HealthProbeResult,
  type HealthVerdict,
} from '../../../../utils/platform-health'

const VERDICT_COLOR: Record<
  HealthVerdict,
  'success' | 'error' | 'warning'
> = {
  ok: 'success',
  degraded: 'error',
  unreachable: 'warning',
}

const VERDICT_LABEL: Record<HealthVerdict, string> = {
  ok: 'OK',
  degraded: 'Degraded',
  unreachable: 'No answer',
}

const CSP_WINDOWS = [7, 14, 30, 60]

const AdminHealth: NextPageWithLayout<Record<string, never>> = () => {
  const { data: user } = useUser()
  const isStaff = useIsStaff()

  const [results, setResults] = useState<HealthProbeResult[]>([])
  const [checkedAt, setCheckedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  const [cspDays, setCspDays] = useState(14)
  const [csp, setCsp] = useState<CspReportView | null>(null)
  const [cspError, setCspError] = useState<string | null>(null)

  useEffect(() => {
    if (!isStaff || !user) return
    let active = true
    setLoading(true)
    void (async () => {
      const idToken = await (user as any)?.getIdToken?.().catch(() => null)
      const probed = await Promise.all(
        HEALTH_PROBES.map(async (probe) => {
          try {
            const response = await fetch(probe.path, {
              cache: 'no-store',
              headers:
                probe.auth === 'staff' && idToken
                  ? { Authorization: `Bearer ${idToken}` }
                  : {},
            })
            const body = await response.json().catch(() => null)
            const read =
              probe.id === 'email'
                ? readEmailHealthResponse(response.status, body)
                : readHealthResponse(response.status, body)
            return { ...read, id: probe.id }
          } catch {
            // A thrown fetch is the only genuine "could not read" — every
            // answered status, 503 included, went through the readers above.
            return {
              id: probe.id,
              verdict: 'unreachable' as const,
              httpStatus: null,
              checks: [],
              error: 'The probe did not answer.',
            }
          }
        }),
      )
      if (!active) return
      setResults(probed)
      setCheckedAt(new Date())
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [isStaff, user, reloadKey])

  useEffect(() => {
    if (!isStaff || !user) return
    let active = true
    setCsp(null)
    setCspError(null)
    void (async () => {
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch(
          `/api/admin/csp-reports?days=${encodeURIComponent(String(cspDays))}`,
          { headers: idToken ? { Authorization: `Bearer ${idToken}` } : {} },
        )
        const body = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          setCspError(
            (body && typeof body.error === 'string' && body.error) ||
              'CSP report read failed',
          )
          return
        }
        setCsp(readCspReport(body))
      } catch {
        if (active) setCspError('CSP report read failed')
      }
    })()
    return () => {
      active = false
    }
  }, [isStaff, user, cspDays, reloadKey])

  const summary = useMemo(() => summarizePlatformHealth(results), [results])
  const byId = useMemo(
    () => new Map(results.map((result) => [result.id, result])),
    [results],
  )

  const handleRefresh = useCallback(() => setReloadKey((key) => key + 1), [])

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Health', href: buildRoute(Route.ADMIN_HEALTH) },
      ]}
      help="platformHealth"
      header={{
        children: 'Platform Health',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            <Stack
              direction="row"
              spacing={2}
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <Button size="small" variant="outlined" onClick={handleRefresh}>
                {'Re-check now'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                {checkedAt
                  ? `Last checked ${checkedAt.toLocaleTimeString()}. Probes memoise for 5 minutes, so a re-check may repeat a recent reading.`
                  : 'Checking…'}
              </Typography>
            </Stack>
            {loading ? <LinearProgress /> : null}

            {/*
              The headline. `allGreen` is false while any probe has not
              answered — "all systems normal" over an unread probe is a claim
              the page did not check.
            */}
            {results.length ? (
              summary.allGreen ? (
                <Alert severity="success">
                  <AlertTitle>{'Every probe answered, all healthy'}</AlertTitle>
                  {`All ${results.length} checks reported OK.`}
                </Alert>
              ) : (
                <Alert
                  severity={summary.degraded.length ? 'error' : 'warning'}
                >
                  <AlertTitle>
                    {summary.degraded.length
                      ? `${summary.degraded.length} degraded`
                      : 'Some probes did not answer'}
                    {summary.unreachable.length
                      ? ` · ${summary.unreachable.length} unreadable`
                      : ''}
                  </AlertTitle>
                  {summary.unreachable.length
                    ? 'A probe that did not answer is NOT healthy — its state is unknown, and unknown is not green.'
                    : 'See the affected checks below for what it means and what to do.'}
                </Alert>
              )
            ) : null}

            {/* MASONRY. Every probe card is a different height — Serving
                carries one check and Billing webhook carries five plus a
                paragraph — and a twelve-column flex row makes each row as tall
                as its tallest card. That left a screen of dead space under
                Serving with Error beacon pushed below it, on the page whose
                job is showing eight verdicts at a glance. */}
            <GridItems
              masonry
              spacing={3}
              items={HEALTH_PROBES.map((probe) => {
                const result = byId.get(probe.id)
                const verdict = result?.verdict
                return {
                  size: { xs: 12, md: 6 },
                  children: (
                    <CardDisplay
                      header={probe.label}
                      help={docsHelp('platformHealth', {
                        anchor: '#the-probes',
                        excerpt: probe.meaning,
                      })}
                      contentGutterX
                      contentGutterY
                    >
                      <Stack spacing={1.5}>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Chip
                            size="small"
                            color={
                              verdict ? VERDICT_COLOR[verdict] : 'default'
                            }
                            label={
                              verdict ? VERDICT_LABEL[verdict] : 'Checking…'
                            }
                          />
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ fontFamily: 'monospace' }}
                          >
                            {`${probe.path}${
                              result?.httpStatus
                                ? ` → ${result.httpStatus}`
                                : ''
                            }`}
                          </Typography>
                          {probe.auth === 'staff' ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label="Staff only"
                            />
                          ) : null}
                        </Stack>

                        <Typography variant="body2" color="text.secondary">
                          {probe.meaning}
                        </Typography>

                        {result?.error ? (
                          <Alert severity="warning">{result.error}</Alert>
                        ) : null}

                        {result?.checks.map((check) => (
                          <Stack key={check.name} spacing={0.25}>
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ alignItems: 'center' }}
                            >
                              <Chip
                                size="small"
                                color={check.ok ? 'success' : 'error'}
                                variant="outlined"
                                label={check.ok ? 'pass' : 'fail'}
                              />
                              <Typography
                                variant="body2"
                                sx={{ fontFamily: 'monospace' }}
                              >
                                {check.name}
                              </Typography>
                              {check.code ? (
                                <Typography variant="caption" color="error">
                                  {check.code}
                                </Typography>
                              ) : null}
                              {check.ms !== null ? (
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ ml: 'auto' }}
                                >
                                  {`${check.ms} ms`}
                                </Typography>
                              ) : null}
                            </Stack>
                            {check.facts.map((fact) => (
                              <Typography
                                key={fact}
                                variant="caption"
                                color="text.secondary"
                                sx={{ pl: 1 }}
                              >
                                {fact}
                              </Typography>
                            ))}
                          </Stack>
                        ))}

                        {/*
                          The remedy shows only when it is needed. On a green
                          tile it is noise; on a red one it is the reason the
                          page is worth opening.
                        */}
                        {verdict && verdict !== 'ok' ? (
                          <Typography variant="body2">
                            <strong>{'What to do: '}</strong>
                            {probe.remedy}
                          </Typography>
                        ) : null}
                      </Stack>
                    </CardDisplay>
                  ),
                }
              })}
            />

            <CardDisplay
              header={'Content-Security-Policy violations'}
              help={docsHelp('platformHealth', {
                anchor: '#csp-violations',
                excerpt:
                  'The durable violation counters. A directive with no rows across the window is one that can safely be flipped from report-only to enforcing.',
              })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                >
                  <TextField
                    select
                    size="small"
                    label="Window"
                    value={cspDays}
                    onChange={(event) => setCspDays(Number(event.target.value))}
                    sx={{ minWidth: 140 }}
                  >
                    {CSP_WINDOWS.map((days) => (
                      <MenuItem key={days} value={days}>
                        {`${days} days`}
                      </MenuItem>
                    ))}
                  </TextField>
                  <Typography variant="body2" color="text.secondary">
                    {'A directive with zero rows across the window is one ' +
                      'that can be flipped from report-only to enforcing. ' +
                      'That decision is the reason these counters exist.'}
                  </Typography>
                </Stack>

                {cspError ? <Alert severity="warning">{cspError}</Alert> : null}

                {csp?.truncated ? (
                  <Alert severity="warning">
                    {'The read hit its row cap — this window is INCOMPLETE ' +
                      'and the missing rows are the oldest days. Narrow the ' +
                      'window before concluding a directive is clean.'}
                  </Alert>
                ) : null}

                {csp ? (
                  csp.rows.length === 0 ? (
                    <Alert severity="success">
                      <AlertTitle>
                        {`No violations recorded since ${csp.since}`}
                      </AlertTitle>
                      {'Every report-only directive was clean across this ' +
                        'window. That is the evidence a flip to enforcing ' +
                        'needs — check the window is long enough to have ' +
                        'seen real traffic.'}
                    </Alert>
                  ) : (
                    <>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ flexWrap: 'wrap' }}
                      >
                        {csp.directives.map((entry) => (
                          <Chip
                            key={entry.directive}
                            size="small"
                            /*
                             * BLOCKED is red; measured is amber. They were
                             * one amber count, so a login script that did not
                             * run for somebody looked like an analytics pixel
                             * a stricter policy would have stopped.
                             */
                            color={entry.blocked ? 'error' : 'warning'}
                            label={
                              entry.blocked
                                ? `${entry.directive}: ${entry.blocked} blocked` +
                                  (entry.reported
                                    ? `, ${entry.reported} measured`
                                    : '')
                                : `${entry.directive}: ${entry.reported} measured`
                            }
                          />
                        ))}
                      </Stack>
                      {/* A blocked violation is an INCIDENT, and an incident
                          that stopped is not the same as one still happening.
                          Without the date, twenty-two scripts blocked on a
                          Wednesday read for the rest of the fortnight exactly
                          like this morning's. */}
                      {csp.lastBlockedMs ? (
                        <Alert
                          severity={
                            Date.now() - csp.lastBlockedMs < 86_400_000
                              ? 'error'
                              : 'info'
                          }
                        >
                          <AlertTitle>
                            {Date.now() - csp.lastBlockedMs < 86_400_000
                              ? 'Something is being blocked right now'
                              : 'Nothing has been blocked since ' +
                                new Date(csp.lastBlockedMs).toLocaleString()}
                          </AlertTitle>
                          {Date.now() - csp.lastBlockedMs < 86_400_000
                            ? 'A script or resource did not run, for somebody, ' +
                              'on a live page. Read the enforced rows below.'
                            : 'The enforced rows below are a past incident ' +
                              'still inside the window, not a live one. They ' +
                              'age out on their own.'}
                        </Alert>
                      ) : null}
                      <Typography variant="body2" color="text.secondary">
                        {`${csp.totalViolations} violations across ` +
                          `${csp.rowCount} rows since ${csp.since}.`}
                      </Typography>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>{'Day'}</TableCell>
                            <TableCell>{'App'}</TableCell>
                            <TableCell>{'Directive'}</TableCell>
                            <TableCell>{'Blocked origin'}</TableCell>
                            <TableCell align="right">{'Count'}</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {csp.rows.slice(0, 100).map((row, index) => (
                            <TableRow
                              key={`${row.day}-${row.directive}-${row.blockedOrigin}-${index}`}
                            >
                              <TableCell>{row.day ?? '—'}</TableCell>
                              <TableCell>{row.app ?? '—'}</TableCell>
                              <TableCell sx={{ fontFamily: 'monospace' }}>
                                {row.directive ?? '—'}
                              </TableCell>
                              <TableCell
                                sx={{
                                  fontFamily: 'monospace',
                                  maxWidth: 320,
                                  overflowWrap: 'anywhere',
                                }}
                              >
                                {row.blockedOrigin ?? '—'}
                              </TableCell>
                              <TableCell align="right">
                                {row.count ?? 0}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {csp.rows.length > 100 ? (
                        <Typography variant="caption" color="text.secondary">
                          {`Showing the 100 highest-count rows of ${csp.rows.length}.`}
                        </Typography>
                      ) : null}
                    </>
                  )
                ) : cspError ? null : (
                  <Typography variant="body2" color="text.secondary">
                    {'Loading…'}
                  </Typography>
                )}
              </Stack>
            </CardDisplay>

            {/* The repair half of the scope-drift pair (AGL-2062). The
                detector has run weekly since AGL-1478 and the only way to
                act on what it found was a curl carrying a hand-harvested
                staff token. */}
            <ScopeDriftCard />

            <PendingErasuresCard />

            {/* Idempotency claims that never settled (AGL-2329). Here rather
                than on a billing screen because a stuck key is a reliability
                fact, not a money one — the money did not move, which is
                exactly the point. */}
            <IdempotencyClaimsCard />

            {/* What this deployment actually resolved (AGL-2069). Last on
                the board because it is the one card that is not a probe: it
                answers "is production running the config we think it is",
                which is the question every red tile above eventually
                becomes. A var set on the Vercel PROJECT while the
                DEPLOYMENT lacks it looks identical from outside. */}
            <ServerConfigCard />
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminHealth.displayName = 'Page:AdminHealth'

export default AdminHealth

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
 * STAFF → MAINTENANCE (AGL-1949).
 *
 * Three staff-gated routes existed with no console surface, and each was
 * reachable only from a shell holding the production cron secret:
 * `audit-archive`, `reap-plugin-artifacts` and `reverify-plugin-versions`.
 * Two of them destroy things permanently.
 *
 * ## Two questions, and only one of them is a button
 *
 * **"Is this job still running?"** is the important one, and it is not
 * answered by being able to trigger the job. Both scheduled jobs here are
 * silent-failure shaped: an archival that stopped running looks exactly like
 * one with nothing to archive — the AGL-1490 failure that produced unusable
 * backups for eleven days behind a green badge. So each card carries the
 * schedule row from `/api/health/crons`, read through the same
 * `readHealthResponse` the health board uses rather than a second reading of
 * the same endpoint.
 *
 * **"Run it now"** is the smaller one, and it is deliberately awkward: a
 * preview first, then a reason, then — for the two destructive jobs — a typed
 * phrase, all enforced by the route. A one-click irreversible sweep would be
 * strictly worse than the curl it replaces.
 *
 * ## What is NOT here
 *
 * `backfill-scope` (AGL-2062) and `run-erasures` (AGL-2165) already have
 * cards on the health board. Adding them here too would be a second surface
 * for the same route, which is how two surfaces come to disagree.
 */

import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { Container } from '@aglyn/shared-ui-jsx'
import type { NextPageWithLayout } from '@aglyn/shared-ui-next'
import {
  Alert,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'

import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import MaintenanceJobCard from '../../../../components/maintenance-job-card.component'
import StaffOnly from '../../../../components/staff-only.component'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { MAINTENANCE_JOBS } from '../../../../utils/maintenance-jobs'
import {
  readHealthResponse,
  type HealthCheckLine,
} from '../../../../utils/platform-health'

const AdminMaintenance: NextPageWithLayout<Record<string, never>> = () => {
  const [checks, setChecks] = useState<HealthCheckLine[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*==========================================
   * The schedule rows come from the CRONS PROBE, not from a query of our own.
   *
   * `/api/health/crons` already knows every job's cadence, grace and last
   * beat (AGL-1955). Re-deriving "is it late" here would be a second copy of
   * a rule that is genuinely subtle — an idle job must read green — and the
   * two would drift.
   *=========================================*/
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/health/crons')
      // A 503 IS the report: degraded means a job stopped being scheduled,
      // which is the single most important thing this page can say.
      const body = await response.json().catch(() => null)
      const result = readHealthResponse(response.status, body)
      if (result.verdict === 'unreachable') {
        setChecks([])
        setError(result.error)
        return
      }
      setChecks(result.checks)
    } catch (loadError) {
      setChecks([])
      setError(String((loadError as Error).message))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const byId = useMemo(
    () => new Map(checks.map((check) => [check.name, check])),
    [checks],
  )

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        { children: 'Maintenance', href: buildRoute(Route.ADMIN_MAINTENANCE) },
      ]}
      help="maintenance"
      header={{
        children: 'Maintenance',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={3}>
            <Typography variant="body2" color="text.secondary">
              {'These jobs run on a schedule. The point of this page is ' +
                'seeing whether the schedule is still working — a job that ' +
                'stopped running looks exactly like one with nothing to do. ' +
                'Running one by hand is for when something cannot wait, and ' +
                'every run by hand is recorded in the audit log.'}
            </Typography>

            {error ? <Alert severity="warning">{error}</Alert> : null}
            {loading ? <LinearProgress /> : null}

            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <Button size="small" variant="outlined" onClick={() => void load()}>
                {'Re-read schedules'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                {'Scope drift and pending erasures have their own cards on '}
                <a href={buildRoute(Route.ADMIN_HEALTH)}>{'Health'}</a>
                {'.'}
              </Typography>
            </Stack>

            {MAINTENANCE_JOBS.map((job) => {
              const check = byId.get(job.id)
              return (
                <Stack key={job.id} spacing={1}>
                  {/*
                    The schedule verdict sits ABOVE the card's controls: the
                    first thing to know about a job is whether it is still
                    firing, not whether you can fire it.
                  */}
                  {check ? (
                    <Alert severity={check.ok ? 'success' : 'error'}>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <Chip
                          size="small"
                          color={check.ok ? 'success' : 'error'}
                          label={check.ok ? 'Scheduled' : 'NOT RUNNING'}
                        />
                        {check.code ? (
                          <Chip size="small" variant="outlined" label={check.code} />
                        ) : null}
                        <Typography variant="body2">
                          {check.facts.join(' · ')}
                        </Typography>
                      </Stack>
                    </Alert>
                  ) : (
                    // Never folded into "fine". A job whose schedule row we
                    // could not read is its own state.
                    <Alert severity="warning">
                      {'No schedule reading for this job — the crons probe ' +
                        'did not report it.'}
                    </Alert>
                  )}
                  <MaintenanceJobCard job={job} />
                </Stack>
              )
            })}
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}

export default AdminMaintenance

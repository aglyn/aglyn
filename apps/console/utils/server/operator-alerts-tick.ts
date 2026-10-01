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

import {
  firebaseAdmin,
  healthStateOfBody,
  HEALTH_SERVICE_LABELS,
  raiseOperatorAlert,
  recordHealthState,
  sendOperatorAlertDigest,
  type OperatorDigestResult,
} from '@aglyn/tenant-data-admin'
import { evaluateEmailHealth } from './email-health'

/**
 * THE OPERATOR ALERTS TICK (AGL-3377), every fifteen minutes: the three
 * things nothing else would do on their own schedule.
 *
 * 1. **The health sweep.** Every health endpoint is pull-only: it answers
 *    whoever asks, and an install with no external monitor asks nothing. The
 *    tick asks each one on the install's own origins, so each records its
 *    verdict (`recordHealthResponse`) and a degraded check raises
 *    `system.healthDegraded` whether or not anybody else is watching. The
 *    provider credential and shared-pool probe runs here too.
 * 2. **The support SLA sweep.** A ticket's `responseDueAt` was written and
 *    never read; an open ticket past it with no staff reply raises
 *    `support.slaBreached`.
 * 3. **The digest**, once a day after the hour staff chose.
 *
 * The tick cannot report its own death. It is itself a row on
 * `/api/health/crons`, which records its own state on every read — so an
 * external monitor on that endpoint, or on the out-of-band webhook's
 * silence, is what covers the case where this stops.
 *
 * Each stage is isolated: one that throws is reported and the next runs.
 */

/** The console's own health endpoints, by path. */
export const CONSOLE_HEALTH_PATHS: readonly string[] = [
  '/api/health',
  '/api/health/auth-doors',
  '/api/health/backups',
  '/api/health/billing',
  '/api/health/crons',
  '/api/health/error-beacon',
  '/api/health/journeys',
  '/api/health/rate-limits',
  '/api/health/server-errors',
  '/api/health/signup-volume',
]

/** The tenant runtime's, probed when `OPERATOR_HEALTH_TENANT_ORIGIN` is set. */
export const TENANT_HEALTH_PATHS: readonly string[] = [
  '/api/health',
  '/api/health/error-beacon',
  '/api/health/funnel',
  '/api/health/render/site',
  '/api/health/render/marketing',
]

const PROBE_TIMEOUT_MS = 20_000

export interface HealthSweepRow {
  origin: 'console' | 'tenant'
  path: string
  service: string | null
  status: 'ok' | 'degraded' | 'unreachable'
  httpStatus: number | null
  /** Why an unreachable probe got no answer. */
  error?: string
}

function trimOrigin(value: string | undefined): string {
  const trimmed = String(value ?? '').trim().replace(/\/+$/, '')
  return /^https?:\/\/[^/\s]+$/i.test(trimmed) ? trimmed : ''
}

/** The headers that get our own request past our own edge, when configured. */
function edgeBypassHeaders(): Record<string, string> {
  const probe = String(process.env['AGLYN_PROBE_TOKEN'] ?? '').trim()
  const bypass = String(process.env['AGLYN_VERCEL_BYPASS'] ?? '').trim()
  return {
    ...(probe ? { 'x-aglyn-probe': probe } : {}),
    ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
  }
}

async function probe(
  origin: HealthSweepRow['origin'],
  base: string,
  path: string,
  fetcher: typeof fetch,
): Promise<HealthSweepRow> {
  try {
    const response = await fetcher(`${base}${path}`, {
      headers: { accept: 'application/json', ...edgeBypassHeaders() },
      cache: 'no-store',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
    const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
    const service = typeof body?.['service'] === 'string' ? (body['service'] as string) : null
    if (!service || (response.status !== 200 && response.status !== 503)) {
      // Not an answer from a health endpoint: a 404 from an older release, a
      // challenge page from the edge. Nothing is recorded, because it says
      // nothing about the check.
      return { origin, path, service, status: 'unreachable', httpStatus: response.status }
    }
    const { status, detail } = healthStateOfBody(body, response.status)
    await recordHealthState(service, status, detail, {
      label: HEALTH_SERVICE_LABELS[service] ?? service,
    })
    return { origin, path, service, status, httpStatus: response.status }
  } catch (error) {
    return {
      origin,
      path,
      service: null,
      status: 'unreachable',
      httpStatus: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/**
 * Asks every health endpoint on the console origin (and the tenant origin,
 * when configured). `consoleOrigin` defaults to `NEXT_PUBLIC_CONSOLE_URL`,
 * then to the origin the tick was called on.
 */
export async function runHealthSweep(options: {
  requestOrigin?: string
  fetcher?: typeof fetch
}): Promise<{ rows: HealthSweepRow[]; tenant: 'probed' | 'unconfigured' }> {
  const fetcher = options.fetcher ?? fetch
  const consoleBase =
    trimOrigin(process.env['NEXT_PUBLIC_CONSOLE_URL']) || trimOrigin(options.requestOrigin)
  const tenantBase = trimOrigin(process.env['OPERATOR_HEALTH_TENANT_ORIGIN'])
  const jobs: Array<Promise<HealthSweepRow>> = []
  if (consoleBase) {
    for (const path of CONSOLE_HEALTH_PATHS) jobs.push(probe('console', consoleBase, path, fetcher))
  }
  if (tenantBase) {
    for (const path of TENANT_HEALTH_PATHS) jobs.push(probe('tenant', tenantBase, path, fetcher))
  }
  const rows = await Promise.all(jobs)
  // The provider credential and pool probe is staff-gated over HTTP, so it
  // runs in-process: it raises its own alert when the key is refused.
  try {
    await evaluateEmailHealth({ probe: true })
  } catch (error) {
    console.error('[operator-alerts] email health probe failed', error)
  }
  return { rows, tenant: tenantBase ? 'probed' : 'unconfigured' }
}

/** How far back the SLA sweep looks for tickets past their response time. */
const SLA_LOOKBACK_MS = 14 * 24 * 3_600_000
const SLA_READ_LIMIT = 200

function describeOverdue(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000))
  if (minutes < 120) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours} h` : `${Math.round(hours / 24)} days`
}

function millisOf(value: unknown): number | null {
  if (!value) return null
  if (typeof value === 'number') return value
  const candidate = value as { toMillis?: () => number }
  return typeof candidate.toMillis === 'function' ? candidate.toMillis() : null
}

/**
 * Open tickets past their first-response time with no staff reply. One range
 * on `responseDueAt` (its single-field index), bounded to a fortnight; the
 * open-and-unanswered test runs on what that returns.
 */
export async function runSupportSlaSweep(options: {
  now?: number
  dryRun?: boolean
}): Promise<{ breached: number; raised: number }> {
  const now = options.now ?? Date.now()
  const { Timestamp } = firebaseAdmin.firestore
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('supportTickets')
    .where('responseDueAt', '<', Timestamp.fromMillis(now))
    .where('responseDueAt', '>=', Timestamp.fromMillis(now - SLA_LOOKBACK_MS))
    .orderBy('responseDueAt', 'asc')
    .limit(SLA_READ_LIMIT)
    .get()
  let breached = 0
  let raised = 0
  /*
   * The workspace's name for the alert (AGL-3432): the ticket stores only the
   * id. Read once per workspace per run, and only for a ticket that is
   * actually breaching. Blank when the read fails or finds no name, and the
   * alert names the workspace by its id alone.
   */
  const workspaceNames = new Map<string, Promise<string>>()
  const workspaceName = (orgId: string): Promise<string> => {
    if (!orgId) return Promise.resolve('')
    let known = workspaceNames.get(orgId)
    if (!known) {
      known = (async () => {
        try {
          const name = (
            await firebaseAdmin.app().firestore().collection('orgs').doc(orgId).get()
          ).get('name')
          return typeof name === 'string' ? name.trim() : ''
        } catch {
          return ''
        }
      })()
      workspaceNames.set(orgId, known)
    }
    return known
  }
  for (const doc of snapshot.docs) {
    const ticket = doc.data() as Record<string, unknown>
    if (ticket['status'] !== 'open' || ticket['firstRespondedAt']) continue
    const dueMs = millisOf(ticket['responseDueAt'])
    if (!dueMs) continue
    breached += 1
    if (options.dryRun) continue
    const orgId = String(ticket['orgId'] ?? '')
    const result = await raiseOperatorAlert('support.slaBreached', {
      dedupeKey: doc.id,
      context: {
        ticketId: doc.id,
        subject: String(ticket['subject'] ?? '').slice(0, 120) || 'Untitled ticket',
        tier: String(ticket['supportTier'] ?? '') || 'support',
        orgId,
        orgName: await workspaceName(orgId),
        overdue: describeOverdue(now - dueMs),
      },
      ...(orgId ? { orgId } : {}),
    })
    if (result.outcome === 'delivered' || result.outcome === 'queued' || result.outcome === 'console-only') {
      raised += 1
    }
  }
  return { breached, raised }
}

export interface OperatorAlertsTickReport {
  health: { rows: HealthSweepRow[]; tenant: 'probed' | 'unconfigured' } | { error: string }
  sla: { breached: number; raised: number } | { error: string }
  digest: OperatorDigestResult | { error: string }
}

export async function runOperatorAlertsTick(options: {
  dryRun: boolean
  requestOrigin?: string
  now?: number
}): Promise<OperatorAlertsTickReport> {
  const stage = async <T>(name: string, work: () => Promise<T>): Promise<T | { error: string }> => {
    try {
      return await work()
    } catch (error) {
      console.error(`[operator-alerts] ${name} failed`, error)
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }
  const health = options.dryRun
    ? { rows: [], tenant: trimOrigin(process.env['OPERATOR_HEALTH_TENANT_ORIGIN']) ? 'probed' as const : 'unconfigured' as const }
    : await stage('health sweep', () => runHealthSweep({ requestOrigin: options.requestOrigin }))
  const sla = await stage('support SLA sweep', () =>
    runSupportSlaSweep({ dryRun: options.dryRun, ...(options.now ? { now: options.now } : {}) }),
  )
  const digest = await stage('digest', () =>
    sendOperatorAlertDigest({ dryRun: options.dryRun, ...(options.now ? { now: options.now } : {}) }),
  )
  return { health, sla, digest }
}

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

import { isDomainConnectTerminal } from '../../model/domain-connect'
import {
  DOMAIN_CONNECT_LEASE_MS,
  sessionAfterConnect,
  sessionAfterDnsCheck,
  sessionExpired,
  type DomainConnectSession,
  type DomainConnectSessionPatch,
  type SessionConnectOutcome,
} from './session'

/*
 * MOVING ONE SESSION FORWARD (AGL-3963): check the records, and connect the
 * domain once they resolve.
 *
 * Two callers run this for the same session: the widget, polling while the
 * owner watches, and the console sweep for an owner who closed the tab. A
 * short lease taken in a transaction makes them take turns, so a domain is
 * connected once and its activity entry written once.
 */

export interface DomainConnectStore {
  get(id: string): Promise<DomainConnectSession | null>
  create(id: string, session: DomainConnectSession): Promise<void>
  update(id: string, patch: DomainConnectSessionPatch): Promise<void>
  /**
   * Holds the session until `untilMs` when nobody else holds it, and answers
   * it as read inside that hold; null when it is held or gone.
   */
  lease(id: string, nowMs: number, untilMs: number): Promise<DomainConnectSession | null>
  /**
   * Open sessions due a look by `nowMs`, least recently looked at first, at
   * most `limit`.
   */
  listDue(nowMs: number, limit: number): Promise<Array<{ id: string; session: DomainConnectSession }>>
}

export interface DomainConnectEngineDeps {
  store: DomainConnectStore
  /** Whether `name` points at the tenant edge now. Never throws. */
  pointsHere(name: string): Promise<boolean>
  /** Connects the domain to the site through core's one claim. Never throws. */
  connect(input: {
    hostId: string
    domain: string
    twin: string | null
    actor: { uid: string; email: string | null }
  }): Promise<SessionConnectOutcome>
  /**
   * Whether the session's owner may still connect a domain to its site — a
   * refusal code, or null. The sweep asks it, hours after the owner was
   * checked; a route that just checked them passes none.
   */
  permitted?: (session: DomainConnectSession) => Promise<string | null>
  now(): number
}

/**
 * Advances session `id` as far as DNS allows and answers it as it now
 * stands; null when there is no such session. A session another checker
 * holds is answered as read, unchanged.
 */
export async function advanceDomainConnectSession(
  id: string,
  deps: DomainConnectEngineDeps,
): Promise<DomainConnectSession | null> {
  const current = await deps.store.get(id)
  if (!current || isDomainConnectTerminal(current.status)) return current
  const nowMs = deps.now()
  const session = await deps.store.lease(id, nowMs, nowMs + DOMAIN_CONNECT_LEASE_MS)
  if (!session) return current
  if (isDomainConnectTerminal(session.status)) return session

  // Every look releases the hold and sends the session to the back of the
  // sweep's queue, or out of it once terminal.
  const write = async (patch: DomainConnectSessionPatch) => {
    const status = patch.status ?? session.status
    const full: DomainConnectSessionPatch = {
      ...patch,
      leaseUntilMs: null,
      nextCheckAtMs: isDomainConnectTerminal(status) ? null : nowMs,
    }
    await deps.store.update(id, full)
    return { ...session, ...full }
  }

  // A session past its 48 hours is closed without another look: the owner
  // asked two days ago, and connecting a name now would surprise them.
  if (sessionExpired(session, nowMs)) {
    return write({ status: 'expired', code: 'dns-not-pointed', updatedAtMs: nowMs })
  }

  const [primary, twin] = await Promise.all([
    deps.pointsHere(session.domain).catch(() => false),
    session.twin ? deps.pointsHere(session.twin).catch(() => false) : Promise.resolve(null),
  ])
  const step = sessionAfterDnsCheck(session, { primary, twin }, nowMs)
  if (step.kind === 'none') return write({})
  if (step.kind === 'update') return write(step.patch)

  const refusal = deps.permitted ? await deps.permitted(session).catch(() => 'not-permitted') : null
  if (refusal) {
    return write({ ...step.patch, status: 'failed', code: refusal, updatedAtMs: nowMs })
  }
  const outcome = await deps
    .connect({
      hostId: session.hostId,
      domain: session.domain,
      twin: step.twin,
      actor: { uid: session.createdBy, email: session.createdByEmail },
    })
    .catch((): SessionConnectOutcome => ({ ok: 'refused', code: 'attach-failed' }))
  return write({ ...step.patch, ...sessionAfterConnect(outcome, nowMs) })
}

/** What one sweep did, for the job's report. Counts only. */
export interface DomainConnectSweepReport {
  [key: string]: number
  checked: number
  connected: number
  expired: number
  failed: number
}

/** The most sessions one tick looks at. */
const SWEEP_LIMIT = 100

/**
 * The sweep (AGL-3963): the open sessions least recently looked at, up to a
 * hundred a tick, until the tick's deadline.
 */
export async function sweepDomainConnectSessions(
  deps: DomainConnectEngineDeps,
  options: { deadlineMs: number },
): Promise<DomainConnectSweepReport> {
  const report: DomainConnectSweepReport = { checked: 0, connected: 0, expired: 0, failed: 0 }
  const open = await deps.store.listDue(deps.now(), SWEEP_LIMIT)
  for (const { id } of open) {
    if (deps.now() >= options.deadlineMs) break
    const after = await advanceDomainConnectSession(id, deps).catch(() => null)
    report.checked += 1
    if (after?.status === 'connected') report.connected += 1
    else if (after?.status === 'expired') report.expired += 1
    else if (after?.status === 'failed') report.failed += 1
  }
  return report
}

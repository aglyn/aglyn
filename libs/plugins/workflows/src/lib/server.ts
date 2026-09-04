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
  checkEntitlement,
  type HostFunction,
  type HostVariable,
  type HostWebhook,
  type HostWorkflow,
  resolveOrgEntitlements,
  runWorkflow,
} from '@aglyn/aglyn/server'
import {
  registerPluginApiRoute,
  registerPluginJob,
  type PluginApiHandler,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import { runDueFlowEnrollments } from '@aglyn/tenant-runtime'
import { timingSafeEqual } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { BUNDLE_ID as WORKFLOWS_BUNDLE_ID } from './constants/bundle-common'

/*==========================================
 * THE BEAT THAT MAKES A WAIT STEP REAL.
 *
 * A `wait` step suspends a run into a `flowEnrollments` row and returns; this
 * is the only thing that ever comes back for it. Without a registration here
 * the wait step would be a delay that never ends — the exact failure
 * `process-abandoned.ts` documents next door, where a Pro entitlement sat
 * behind an HTTP door nothing ever POSTed to.
 *
 * Module scope, like the commerce and bookings registrations: the runner
 * route reaches plugin jobs through `ensureAll(['tenantApi'])`, so a
 * registration inside `registerWorkflowsApi()` would depend on which entry
 * point happened to be loaded.
 *
 * ## Every minute, and why that is cheap
 *
 * `FLOW_WAIT_MIN_MINUTES` is one, so the beat has to be one — a fifteen-minute
 * sweep would make the shortest wait anybody can author wrong by up to
 * fourteen minutes. It costs one collection-group query per minute, which
 * returns nothing at all on a platform with no flow due, because the query
 * asks for `resumeAtMs <= now` rather than for the enrolled population.
 *
 * Bounded and idempotent, the two properties the runner requires: the scan
 * budget bounds one pass, and a transactional claim means an overlapping or
 * repeated beat cannot run the same person's step twice.
 *=========================================*/
registerPluginJob({
  pluginId: WORKFLOWS_BUNDLE_ID,
  name: 'resume-flow-waits',
  intervalMinutes: 1,
  description:
    'Continue automations whose wait step has ended, and time out those ' +
    'waiting for an event that never arrived.',
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    await runDueFlowEnrollments(gate)
  },
})

// Best-effort per-instance rate limit (mirrors forms/submit).
const recentByHook = new Map<string, number[]>()
const RATE_WINDOW_MS = 60_000
const RATE_MAX = 30

function rateLimited(key: string): boolean {
  const now = Date.now()
  const hits = (recentByHook.get(key) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  )
  hits.push(now)
  recentByHook.set(key, hits)
  return hits.length > RATE_MAX
}

function secretsMatch(expected: string, provided: string): boolean {
  if (!expected || expected.length !== provided.length) return false
  return timingSafeEqual(
    new Uint8Array(Buffer.from(expected)),
    new Uint8Array(Buffer.from(provided)),
  )
}

/**
 * Inbound webhook endpoint (AGL-149): external systems POST JSON to
 * `/api/hooks/{hostId}/{hookId}` with the hook's secret in
 * `x-aglyn-secret`; a valid call enrolls the configured workflow with the
 * payload's top-level primitives in scope. Business tier (`webhooks`
 * flag); runs bill against the workflow-runs meter like any other run —
 * `workflowRunsPerMonth` is checked before the run and
 * `hosts/{id}/counters/workflowRuns` is incremented after it (AGL-2228).
 * That sentence was here before either half of it was true.
 */
const inboundHookHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const hostId = String(req.query['hostId'] ?? '')
  const hookId = String(req.query['hookId'] ?? '')
  if (!hostId || !hookId) {
    return res.status(400).json({ error: 'Invalid webhook address' })
  }
  if (rateLimited(`${hostId}/${hookId}`)) {
    return res.status(429).json({ error: 'Too many requests' })
  }

  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const hookSnapshot = await hostRef.collection('webhooks').doc(hookId).get()
    const hook = hookSnapshot.data() as HostWebhook | undefined
    if (
      !hook ||
      hookSnapshot.get('deletedAt') ||
      hook.direction !== 'inbound' ||
      hook.enabled === false
    ) {
      return res.status(404).json({ error: 'Unknown webhook' })
    }
    const provided = String(req.headers['x-aglyn-secret'] ?? '')
    if (!secretsMatch(hook.secret ?? '', provided)) {
      return res.status(401).json({ error: 'Bad secret' })
    }

    // Plan/quota gates ride the owning org's doc (AGL-238).
    const org = (await getOrgForHost(hostId))?.org
    if (!checkEntitlement(org as any, 'webhooks')) {
      return res
        .status(403)
        .json({ error: 'Webhooks are not enabled on this site' })
    }
    /*
     * The MONTHLY RUN CAP, which this handler's own docblock claimed for
     * years — "runs bill against the workflow-runs meter like any other run"
     * — and did not have. It read neither `workflowRunsPerMonth` nor
     * `hosts/{id}/counters/workflowRuns`, and it wrote neither, so an inbound
     * hook was a workflow execution that no cap could refuse and no meter
     * could see: the customer's usage card, the usage-alerts cron and the
     * COGS rollup all read a counter this path never moved.
     *
     * The refusal is a 402 rather than the silent `return` of
     * `runEventWorkflows`: that path is fired from a visitor request whose
     * success must not depend on the workflow, where this one is an
     * integration calling us on purpose and a caller that gets a 200 for a
     * run that did not happen will keep sending. `Retry-After` is deliberately
     * absent — the month, not a delay, is what clears this.
     *
     * The plan-less/unreadable org resolves as FREE
     * (`workflowRunsPerMonth: 0`), so an org doc we cannot read refuses rather
     * than runs. `checkEntitlement(webhooks)` above already refuses free on
     * today's price list; this is not a second gate on the same fact, because
     * a staff `entitlementOverrides` can grant `webhooks` without granting
     * runs, and because the cap is what bounds a BUSINESS org's spend.
     *
     * Read-then-write, like the event path, and bounded the same way: the
     * per-hook limiter above is 30/60s, so the overshoot a race can buy is
     * bounded by concurrency rather than unbounded by design. Making it
     * atomic means a transaction around the whole run and is the same trade
     * `runEventWorkflows` declined.
     */
    const monthKey = new Date().toISOString().slice(0, 7)
    const runCounterRef = hostRef.collection('counters').doc('workflowRuns')
    const runLimit = resolveOrgEntitlements(org as any).workflowRunsPerMonth
    const runsUsed = Number((await runCounterRef.get()).get(monthKey) ?? 0)
    if (!(runsUsed + 1 <= runLimit)) {
      return res.status(402).json({
        error: `This site has used its ${runLimit} workflow runs for the month`,
      })
    }

    // Top-level primitives from the JSON body join the workflow scope.
    const body =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body ?? {})
    const scope: Record<string, string | number | boolean> = {}
    for (const [key, value] of Object.entries(body)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        scope[key.slice(0, 64)] =
          typeof value === 'string' ? value.slice(0, 2000) : value
      }
    }

    const [functionDocs, variableDocs, workflowDocs] = await Promise.all([
      hostRef.collection('functions').limit(100).get(),
      hostRef.collection('variables').limit(100).get(),
      hostRef.collection('workflows').limit(100).get(),
    ])
    const byName = <T extends { name?: string; deletedAt?: unknown }>(
      docs: FirebaseFirestore.QueryDocumentSnapshot[],
    ) => {
      const map: Record<string, T> = {}
      for (const doc of docs) {
        const data = doc.data() as T
        if (data?.name && !data.deletedAt) map[data.name] = data
      }
      return map
    }
    const workflows = byName<HostWorkflow>(workflowDocs.docs)
    const workflow = workflows[hook.workflowName?.trim() ?? '']
    if (!workflow) {
      return res.status(422).json({ error: 'No workflow bound to this hook' })
    }

    const run = runWorkflow(
      workflow,
      byName<HostFunction>(functionDocs.docs),
      byName<HostVariable>(variableDocs.docs),
      { event: `hook:${hook.name ?? hookId}`, ...scope },
      { workflows },
    )
    const failed = run.ok === false
    await hostRef
      .collection('activity')
      .add({
        actorId: null,
        actorEmail: null,
        action: failed
          ? `Inbound webhook run failed: ${run.error}`.slice(0, 300)
          : `Inbound webhook ran "${hook.workflowName}"`,
        // The run-history shape (AGL-2222) — without `result` this execution
        // is invisible to the Runs table, which reads a verdict and not prose.
        result: failed ? 'failed' : 'succeeded',
        trigger: `hook:${hook.name ?? hookId}`,
        summary: failed
          ? String(run.error).slice(0, 300)
          : `Ran ${hook.workflowName}`,
        target: { type: 'workflow', id: hookId, name: hook.name ?? '' },
        createdAt: FieldValue.serverTimestamp(),
      })
      .catch(() => undefined)

    // The run happened, so it counts — including a FAILED one, exactly as
    // `runEventWorkflows` counts its failures. A run that executed and threw
    // spent the same compute as one that returned a value; only a run that
    // never started (the cap above, a missing workflow) must not count.
    await runCounterRef
      .set({ [monthKey]: FieldValue.increment(1) }, { merge: true })
      .catch(() => undefined)

    if (failed) return res.status(422).json({ error: run.error })
    return res.status(200).json({ ok: true, value: run.value })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ error: 'Webhook failed' })
  }
}

/** Registers the workflows plugin's public API routes (AGL-396). */
export function registerWorkflowsApi(): void {
  registerPluginApiRoute('hooks/[hostId]/[hookId]', inboundHookHandler)
}

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
  evaluateExpression,
  type HostEventType,
  type HostFunction,
  type HostVariable,
  type HostWorkflow,
  resolveTenantEntitlements,
  runWorkflow,
} from '@aglyn/aglyn'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

/** Bounded fan-out per event: at most this many triggered workflows run. */
const MAX_TRIGGERED_WORKFLOWS = 10

export type HostEventPayload = Record<string, string | number | boolean>

/**
 * Event-triggered workflow runner (AGL-128): loads workflows whose
 * `trigger.event` matches, evaluates optional trigger filters over the
 * event payload, runs each through the pure `runWorkflow` evaluator, and
 * logs runs to the host activity feed. Fire-and-forget from the tenant's
 * event sites (form submit, pageview collector, membership APIs) — it
 * never throws, and a failure must not break the request that emitted the
 * event. Callers should not await it on hot paths (pageviews).
 */
export async function runEventWorkflows(
  hostId: string,
  event: HostEventType,
  payload: HostEventPayload = {},
): Promise<void> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const triggered = await hostRef
      .collection('workflows')
      .where('trigger.event', '==', event)
      .limit(MAX_TRIGGERED_WORKFLOWS)
      .get()
    const workflows = triggered.docs.filter((doc) => !doc.get('deletedAt'))
    if (!workflows.length) return
    // Full workflow map for nested function→workflow calls (AGL-129).
    const allWorkflowDocs = await hostRef
      .collection('workflows')
      .limit(100)
      .get()
    const workflowMap: Record<string, HostWorkflow> = {}
    for (const doc of allWorkflowDocs.docs) {
      const data = doc.data() as any
      if (data?.name && !data.deletedAt) workflowMap[data.name] = data
    }

    // Monthly run cap by the owning tenant's plan (AGL-165) — dark-launch
    // rule: tenants without a plan are uncapped, like every other gate.
    const monthKey = new Date().toISOString().slice(0, 7)
    const runCounterRef = hostRef.collection('counters').doc('workflowRuns')
    const hostSnapshot = await hostRef.get()
    const tenantId = hostSnapshot.get('tenantId') as string | undefined
    if (tenantId) {
      const tenantSnapshot = await firestore
        .collection('tenants')
        .doc(tenantId)
        .get()
      const tenant = tenantSnapshot.exists ? tenantSnapshot.data() : undefined
      if (tenant?.['plan']) {
        const limit = resolveTenantEntitlements(
          tenant as any,
        ).workflowRunsPerMonth
        const counterSnapshot = await runCounterRef.get()
        const used = Number(counterSnapshot.get(monthKey) ?? 0)
        if (used + workflows.length > limit) return
      }
    }

    const [functionDocs, variableDocs] = await Promise.all([
      hostRef.collection('functions').limit(100).get(),
      hostRef.collection('variables').limit(100).get(),
    ])
    const functions: Record<string, HostFunction> = {}
    for (const doc of functionDocs.docs) {
      const definition = doc.data() as any
      if (!definition.deletedAt && definition.name) {
        functions[definition.name] = definition
      }
    }
    const variables: Record<string, HostVariable> = {}
    for (const doc of variableDocs.docs) {
      const variable = doc.data() as any
      if (!variable.deletedAt && variable.name) {
        variables[variable.name] = variable
      }
    }

    let executed = 0
    for (const doc of workflows) {
      const workflow = doc.data() as HostWorkflow
      const filter = workflow.trigger?.filter?.trim()
      if (filter) {
        try {
          const scope: HostEventPayload = { event, ...payload }
          if (!evaluateExpression(filter, scope)) continue
        } catch {
          continue // A broken filter never fires.
        }
      }
      const run = runWorkflow(
        workflow,
        functions,
        variables,
        { event, ...payload },
        { workflows: workflowMap },
      )
      executed += 1
      // `=== false` (not `!run.ok`): the union fails to narrow under the
      // stricter build tsconfig otherwise (same quirk as runWorkflow).
      const action =
        run.ok === false
          ? `Workflow failed on ${event}: ${run.error}`.slice(0, 300)
          : `Workflow ran on ${event}`
      await hostRef
        .collection('activity')
        .add({
          actorId: null,
          actorEmail: null,
          action,
          target: { type: 'workflow', id: doc.id, name: workflow.name ?? '' },
          createdAt: FieldValue.serverTimestamp(),
        })
        .catch(() => undefined)
    }
    // Filtered-out workflows do not bill — only executed runs count.
    if (executed > 0) {
      await runCounterRef
        .set(
          { [monthKey]: FieldValue.increment(executed) },
          { merge: true },
        )
        .catch(() => undefined)
    }
  } catch (error) {
    console.error('runEventWorkflows failed', hostId, event, error)
  }
}

export default runEventWorkflows

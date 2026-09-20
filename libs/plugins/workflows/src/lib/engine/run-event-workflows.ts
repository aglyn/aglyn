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
  ACTION_MAX_EVENT_DEPTH,
  checkEntitlement,
  evaluateExpression,
  FLOW_TIMED_OUT_FIELD,
  type HostActionAlert,
  type HostEventType,
  type HostFunction,
  type HostVariable,
  type HostWorkflow,
  resolveOrgEntitlements,
  runWorkflow,
} from '@aglyn/aglyn/server'
import { firebaseAdmin, getOrgForHost } from '@aglyn/tenant-data-admin'
import type { HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
import { FieldValue } from 'firebase-admin/firestore'
import {
  deferFlowEnrollment,
  endFlowEnrollment,
  type FlowEnrollment,
} from './flow-enrollments'
import {
  automationRunEnv,
  executeWorkflow,
  FLOW_CLAIM_RETRY_MS,
  stopFlowEnrollment,
  type WorkflowContext,
  type WorkflowExecution,
} from './run-event-actions'
import {
  type AutomationWorkflow,
  workflowHasActionSteps,
} from './workflow-steps'

/** Bounded fan-out per event: at most this many triggered workflows run. */
const MAX_TRIGGERED_WORKFLOWS = 10

/**
 * One workflow run's row in the site's activity feed, which is the run
 * history the Workflows tab reads.
 *
 * The one place a workflow's run is written, whichever door started it.
 */
async function recordWorkflowRun(
  hostRef: FirebaseFirestore.DocumentReference,
  row: Record<string, unknown>,
): Promise<void> {
  await hostRef
    .collection('activity')
    .add({
      actorId: null,
      actorEmail: null,
      ...row,
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
}

/**
 * The history row for a run of a workflow with Actions steps, in the Actions
 * run's phrasing (AGL-2171) — what each step did, joined — so the run table
 * shows every step's outcome whichever engine the step came from. `status`
 * and `durationMs` ride along as they do on every workflow run, for the
 * dashboard feed that renders them.
 */
export function workflowRunRow(
  execution: Pick<WorkflowExecution, 'ending' | 'errors' | 'outcomes'>,
  input: {
    event: string
    workflowId: string
    workflowName: string
    durationMs: number
  },
): Record<string, unknown> {
  const failed = execution.errors.length > 0
  const action = failed
    ? `Workflow ran on ${input.event} with errors: ${execution.errors.join('; ')}`.slice(
        0,
        300,
      )
    : execution.ending === 'waiting'
      ? `Workflow is waiting, on ${input.event}`
      : `Workflow ran on ${input.event}`
  return {
    action,
    result: failed ? 'failed' : 'succeeded',
    trigger: input.event,
    summary: (execution.outcomes.length
      ? execution.outcomes.join(' · ')
      : 'Ran'
    ).slice(0, 300),
    status: failed ? 'error' : 'ok',
    durationMs: input.durationMs,
    target: {
      type: 'workflow',
      id: input.workflowId,
      name: input.workflowName,
    },
  }
}

/**
 * Event-triggered workflow runner (AGL-128): loads workflows whose
 * `trigger.event` matches, evaluates optional trigger filters over the
 * event payload, runs each, and logs runs to the host activity feed.
 * Fire-and-forget from the tenant's event sites (form submit, pageview
 * collector, membership APIs) — it never throws, and a failure must not
 * break the request that emitted the event.
 *
 * A workflow of function calls runs through the pure `runWorkflow`
 * evaluator exactly as it always has. A workflow with Actions steps runs
 * through `executeWorkflow`, which performs them with the Actions executors;
 * the site alerts its steps raise are what this resolves.
 *
 * ONE RUN, METERED ONCE: either kind counts one run on the workflow meter,
 * `workflowRunsPerMonth`, however many steps it has and whatever they are.
 * Its Actions steps take the Actions tier gates step by step, and none of
 * them counts an action run.
 *
 * `depth` is the chain guard actions run under (`ACTION_MAX_EVENT_DEPTH`):
 * an event a workflow's own step raised — a stage it set — is heard one
 * level deeper, so a workflow that sets the stage it listens for stops.
 */
export async function runEventWorkflows(
  hostId: string,
  event: HostEventType,
  payload: HostEventPayload = {},
  depth = 0,
): Promise<HostActionAlert[]> {
  const alerts: HostActionAlert[] = []
  if (depth > ACTION_MAX_EVENT_DEPTH) return alerts
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const triggered = await hostRef
      .collection('workflows')
      .where('trigger.event', '==', event)
      .limit(MAX_TRIGGERED_WORKFLOWS)
      .get()
    const workflows = triggered.docs.filter((doc) => !doc.get('deletedAt'))
    if (!workflows.length) return alerts
    // Full workflow map for nested function→workflow calls (AGL-129).
    const allWorkflowDocs = await hostRef
      .collection('workflows')
      .limit(100)
      .get()
    // Double-keyed by doc id AND name (AGL-261): id references are
    // rename-safe; legacy name references keep resolving.
    // Each carries its id, so a workflow a step names by its legacy name
    // still runs as the automation it is (see `WorkflowContext`).
    const workflowMap: WorkflowContext['workflows'] = {}
    for (const doc of allWorkflowDocs.docs) {
      const data = doc.data() as any
      if (data.deletedAt) continue
      const withId = { ...data, $id: doc.id }
      workflowMap[doc.id] = withId
      if (data?.name) workflowMap[data.name] = withId
    }

    // Monthly run cap by the owning org's plan (AGL-165) — dark-launch
    // rule: workspaces without a plan are uncapped, like every other gate.
    const monthKey = new Date().toISOString().slice(0, 7)
    const runCounterRef = hostRef.collection('counters').doc('workflowRuns')
    // Run caps ride the owning org's doc (AGL-238) — read through
    // `getOrgForHost` below. The host document itself is not consulted: the
    // cap, the counter and the workflow definitions all live elsewhere, so a
    // read of it here would be billed on every host event and used for
    // nothing.
    const owner = await getOrgForHost(hostId)
    {
      const org = owner?.org
      // Plan-less orgs resolve as free (AGL-247) — the cap always runs.
      const limit = resolveOrgEntitlements(
        org as any,
      ).workflowRunsPerMonth
      const counterSnapshot = await runCounterRef.get()
      const used = Number(counterSnapshot.get(monthKey) ?? 0)
      if (used + workflows.length > limit) return alerts
    }

    const [functionDocs, variableDocs] = await Promise.all([
      hostRef.collection('functions').limit(100).get(),
      hostRef.collection('variables').limit(100).get(),
    ])
    const functions: Record<string, HostFunction> = {}
    for (const doc of functionDocs.docs) {
      const definition = doc.data() as any
      if (definition.deletedAt) continue
      functions[doc.id] = definition
      if (definition.name) functions[definition.name] = definition
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
      const workflow = doc.data() as AutomationWorkflow
      const filter = workflow.trigger?.filter?.trim()
      if (filter) {
        try {
          const scope: HostEventPayload = { event, ...payload }
          if (!evaluateExpression(filter, scope)) continue
        } catch {
          continue // A broken filter never fires.
        }
      }
      const startedAt = Date.now()
      if (workflowHasActionSteps(workflow)) {
        /*
         * A WORKFLOW WITH ACTIONS STEPS is performed, not evaluated. The
         * maps above are this run's working set, so the executor reads them
         * rather than a second copy; the plan gates come off the org
         * document the cap already read.
         */
        const context: WorkflowContext = {
          functions,
          variables,
          workflows: workflowMap,
        }
        const env = automationRunEnv({
          hostId,
          hostRef,
          owner,
          depth,
          alerts,
          loadWorkflowContext: async () => context,
        })
        const execution = await executeWorkflow(
          env,
          { kind: 'workflow', id: doc.id, name: workflow.name ?? '' },
          workflow,
          event,
          payload,
        )
        executed += 1
        await recordWorkflowRun(
          hostRef,
          workflowRunRow(execution, {
            event,
            workflowId: doc.id,
            workflowName: workflow.name ?? '',
            durationMs: Date.now() - startedAt,
          }),
        )
        continue
      }
      const run = runWorkflow(
        workflow as HostWorkflow,
        functions,
        variables,
        { event, ...payload },
        { workflows: workflowMap },
      )
      const durationMs = Date.now() - startedAt
      executed += 1
      // `=== false` (not `!run.ok`): the union fails to narrow under the
      // stricter build tsconfig otherwise (same quirk as runWorkflow).
      const action =
        run.ok === false
          ? `Workflow failed on ${event}: ${run.error}`.slice(0, 300)
          : `Workflow ran on ${event}`
      /*
       * The run-history shape, not just `status` + `durationMs` (AGL-2222).
       *
       * `actionRunResult()` recognises a run by `result`, falling back to the
       * prose prefix `Action ran on`. This writer's prose begins
       * `Workflow ran on`, so every workflow execution was filtered out of the
       * very table AGL-2171 built — the Runs dialog on the Workflows tab read
       * "No runs yet" however many times a workflow had run. The `durationMs`
       * caption in that table could never render either, because the only rows
       * carrying a duration were the ones being dropped.
       *
       * `status` stays: the dashboard activity feed renders it, and removing
       * it would trade one silent gap for another.
       */
      await recordWorkflowRun(hostRef, {
        action,
        result: run.ok === false ? 'failed' : 'succeeded',
        trigger: event,
        summary: run.ok === false ? String(run.error).slice(0, 300) : 'Ran',
        status: run.ok === false ? 'error' : 'ok',
        durationMs,
        target: { type: 'workflow', id: doc.id, name: workflow.name ?? '' },
      })
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
  return alerts
}

/**
 * Continues a WORKFLOW's enrollment from where its wait ended — the
 * workflow twin of the action resume, and asked the same questions.
 *
 * - The kill switch is the workflow document: deleted, and the people inside
 *   it stop, exactly as they do when an action is deleted or switched off.
 * - The plan is re-asked: a wait is an Actions step, so a workspace whose
 *   plan has lost the actions builder stops the flow rather than finishing
 *   it on a plan that no longer carries it.
 * - The snapshot runs, not the workflow's current steps, and the results the
 *   function calls bound before the wait ride in its payload.
 * - Counted on the workflow meter, never refused by it: the person is already
 *   inside, and the gate belongs at enrollment.
 */
export async function resumeWorkflowEnrollment(
  enrollment: FlowEnrollment,
  ref: FirebaseFirestore.DocumentReference,
  options: { timedOut?: boolean; nowMs: number },
): Promise<'ran' | 'waiting' | 'exited' | 'deferred' | 'stopped'> {
  const { nowMs } = options
  const hostId = enrollment.hostId
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  const doc = await hostRef
    .collection('workflows')
    .doc(enrollment.actionId)
    .get()
    .catch(() => null)
  if (!doc?.exists || doc.get('deletedAt')) {
    return await stopFlowEnrollment(
      enrollment,
      ref,
      'the workflow was deleted',
    )
  }
  const workflow = doc.data() as AutomationWorkflow
  const owner = await getOrgForHost(hostId).catch(() => null)
  if (!checkEntitlement(owner?.org as any, 'actions')) {
    return await stopFlowEnrollment(
      enrollment,
      ref,
      'this site’s plan no longer includes automations',
    )
  }
  const env = automationRunEnv({ hostId, hostRef, owner, depth: 0 })
  const payload: HostEventPayload = {
    ...((enrollment.payload ?? {}) as HostEventPayload),
    // The timeout BRANCH, as on an action's resume: the step after a
    // `waitForEvent` reads it to tell the clock from the event.
    ...(options.timedOut ? { [FLOW_TIMED_OUT_FIELD]: true } : {}),
  }
  const startedAt = Date.now()
  const execution = await executeWorkflow(
    env,
    { kind: 'workflow', id: doc.id, name: workflow.name ?? '' },
    workflow,
    enrollment.event,
    payload,
    {
      startIndex: enrollment.nextStepIndex,
      steps: enrollment.steps,
      enrollmentRef: ref,
    },
  )
  if (execution.ending === 'deferred') {
    await deferFlowEnrollment(ref, nowMs + FLOW_CLAIM_RETRY_MS, nowMs)
    return execution.ending
  }
  if (execution.ending !== 'waiting') await endFlowEnrollment(ref)
  await recordWorkflowRun(
    hostRef,
    workflowRunRow(execution, {
      event: enrollment.event,
      workflowId: doc.id,
      workflowName: workflow.name ?? '',
      durationMs: Date.now() - startedAt,
    }),
  )
  const monthKey = new Date(nowMs).toISOString().slice(0, 7)
  await hostRef
    .collection('counters')
    .doc('workflowRuns')
    .set({ [monthKey]: FieldValue.increment(1) }, { merge: true })
    .catch(() => undefined)
  return execution.ending
}

export default runEventWorkflows

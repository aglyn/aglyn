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
  ACTION_MAX_STEPS,
  checkEntitlement,
  consentGroupForHost,
  planLabelGrantingFeature,
  checkQuota,
  type HostWebhook,
  WEBHOOK_URL_PATTERN,
  evaluateExpression,
  evaluateStepGuard,
  evaluateTriggerConditions,
  FLOW_TIMED_OUT_FIELD,
  flowEmailTopicId,
  hostPublicOrigin,
  isClientActionStep,
  isCrmActionStep,
  isFlowSuspendingStep,
  type HostAction,
  type HostActionAlert,
  type HostActionStep,
  type HostActionStepType,
  type HostFunction,
  type HostVariable,
  type HostWorkflow,
  type HostWorkflowStep,
  buildDatasetRecordValues,
  datasetDisplayName,
  contactCampaignFieldPath,
  datasetIntegrityFields,
  datasetIntegrityUpdate,
  describeStepOutcome,
  effectiveDatasetModel,
  normalizeTriggerConditions,
  type PluginJobHostGate,
  resolveOrgEntitlements,
  runWorkflow,
  WORKFLOW_MAX_STEPS,
} from '@aglyn/aglyn/server'
import {
  isDeferrableSendResult,
  isEmailConfigured,
  sendEmail,
  sendFailureReason,
} from '@aglyn/shared-util-email'
import {
  dataStorageRefusal,
  enrollListMember,
  firebaseAdmin,
  flowEmailRefusal,
  getOrgForHost,
  hostSendingIdentity,
  meterHostEmail,
  notifyHostManagers,
  consentGroupForSite,
  orgDataCollectionForHost,
  orgDataQueryForHost,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { announceDatasetRecordChange } from '@aglyn/tenant-data-admin/server/dataset-live-pages'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
// The leaf, not the barrel: this library's specs substitute the barrel
// wholesale, and the lookup must reach the real index logic under them.
import { findContactByEmail } from '@aglyn/tenant-data-admin/server/contact-email-index'
import { createHmac } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import {
  advanceFlowEnrollment,
  claimFlowEnrollment,
  deferFlowEnrollment,
  endFlowEnrollment,
  enrollInFlow,
  findFlowEnrollmentsAwaiting,
  type FlowEnrollment,
  type FlowSweepCursor,
  type FlowSweepResult,
  sweepDueFlowEnrollments,
} from './flow-enrollments'
import {
  logCrmEmailActivity,
  prepareCrmEmailActivity,
  runCrmActionStep,
} from './crm-action-steps'
// The runtime's leaves rather than its barrel: the engine's specs substitute
// each leaf, and a mock of the barrel would take the rest of it down too.
import type { HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
import { resolveDatasetDoc } from '@aglyn/tenant-runtime/resolve-dataset'
import {
  resumeWorkflowEnrollment,
  runEventWorkflows,
} from './run-event-workflows'
import {
  ORG_AUTOMATION_RUN_TARGET,
  type OrgAutomation,
  orgAutomationStepRefusal,
} from '../model/org-automations'
import {
  findOrgAutomationsForEvent,
  resumeOrgAutomationEnrollment,
} from './run-org-automations'
import {
  type AutomationWorkflow,
  isWorkflowActionStep,
  type WorkflowStep,
  workflowActionStepRefusal,
  workflowHasActionSteps,
  workflowStepTypeLabel,
} from './workflow-steps'

/** Bounded fan-out per event, mirroring the workflow runner. */
const MAX_TRIGGERED_ACTIONS = 10

export interface ActionRunEnv {
  hostId: string
  hostRef: FirebaseFirestore.DocumentReference
  alerts: HostActionAlert[]
  /**
   * Whether the owning org holds the actions builder (`actions`, Pro and up)
   * — the gate every Actions step takes. An action run is admitted by it
   * before its first step, so it is always true there; a workflow run is not,
   * because its function calls need no such plan, so the workflow executor
   * asks it of each Actions step it reaches.
   */
  actionsAllowed: boolean
  webhooksAllowed: boolean
  /**
   * Whether the owning org holds the CRM suite (AGL-2611) — the gate the
   * five CRM steps take, resolved once beside `webhooksAllowed` and for the
   * same reason: a step gated on the org doc it already read costs no
   * second read per step.
   */
  crmAllowed: boolean
  depth: number
  /**
   * The owning org's billing doc, already read by the entitlement gate that
   * admitted this run, and the org's id beside it.
   *
   * Carried rather than re-read: both entry points resolve `getOrgForHost`
   * before they build this, so the dataset caps below cost no extra org read.
   * Null only when the host has no resolvable org, which the gate treats as
   * the free plan.
   */
  org: unknown
  orgId: string | null
  loadWorkflowContext: () => Promise<WorkflowContext>
}

/**
 * The site's functions, variables and workflows, double-keyed by document id
 * and by name (AGL-261). A workflow value also carries its document id as
 * `$id`, so a step that names a workflow by its name can still run it as the
 * automation it is.
 */
export interface WorkflowContext {
  functions: Record<string, HostFunction>
  variables: Record<string, HostVariable>
  workflows: Record<string, HostWorkflow & { $id?: string }>
}

/**
 * The automation a run belongs to, as the step executors need it: which kind,
 * its document id, and its name for the history and the enrollment.
 */
export interface AutomationRun {
  /**
   * `orgAutomation` for an org automation (AGL-3302) — a run on the event's
   * site of an automation the organization placed there.
   */
  kind: 'action' | 'workflow' | 'orgAutomation'
  id: string
  name: string
  /** The owning organization, on an `orgAutomation` run: a wait enrolls with it. */
  orgId?: string
}

/**
 * The run environment for one automation run: the org's plan gates resolved
 * once, from the org document the caller already read.
 */
export function automationRunEnv(input: {
  hostId: string
  hostRef: FirebaseFirestore.DocumentReference
  owner: { org?: unknown; orgId?: string | null } | null | undefined
  depth: number
  alerts?: HostActionAlert[]
  loadWorkflowContext?: ActionRunEnv['loadWorkflowContext']
}): ActionRunEnv {
  const org = input.owner?.org ?? null
  return {
    hostId: input.hostId,
    hostRef: input.hostRef,
    alerts: input.alerts ?? [],
    actionsAllowed: checkEntitlement(org as any, 'actions'),
    webhooksAllowed: checkEntitlement(org as any, 'webhooks'),
    crmAllowed: checkEntitlement(org as any, 'crm'),
    depth: input.depth,
    org,
    orgId: input.owner?.orgId ?? null,
    loadWorkflowContext:
      input.loadWorkflowContext ?? makeWorkflowContextLoader(input.hostRef),
  }
}

export function makeWorkflowContextLoader(
  hostRef: FirebaseFirestore.DocumentReference,
) {
  let workflowContext: WorkflowContext | null = null
  return async (): Promise<WorkflowContext> => {
    if (workflowContext) return workflowContext
    const [functionDocs, variableDocs, workflowDocs] = await Promise.all([
      hostRef.collection('functions').limit(100).get(),
      hostRef.collection('variables').limit(100).get(),
      hostRef.collection('workflows').limit(100).get(),
    ])
    workflowContext = workflowContextFromDocs(
      functionDocs.docs,
      variableDocs.docs,
      workflowDocs.docs,
    )
    return workflowContext
  }
}

/**
 * The working set a run reads, from documents already in hand — for a door
 * that read them itself and must not pay for them twice.
 */
export function workflowContextFromDocs(
  functionDocs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  variableDocs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  workflowDocs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
): WorkflowContext {
  // Double-keyed by doc id AND name (AGL-261): id references are
  // rename-safe; legacy name references keep resolving.
  const byName = <T extends { name?: string; deletedAt?: unknown }>(
    docs: readonly FirebaseFirestore.QueryDocumentSnapshot[],
  ) => {
    const map: Record<string, T> = {}
    for (const doc of docs) {
      const data = doc.data() as T
      if (data.deletedAt) continue
      map[doc.id] = data
      if (data?.name) map[data.name] = data
    }
    return map
  }
  // A workflow is carried with its id so a step naming it by its legacy
  // name still runs it as the automation it is (see `WorkflowContext`).
  const workflows: WorkflowContext['workflows'] = {}
  for (const doc of workflowDocs) {
    const data = doc.data() as HostWorkflow
    if ((data as { deletedAt?: unknown }).deletedAt) continue
    const withId = { ...data, $id: doc.id }
    workflows[doc.id] = withId
    if (data?.name) workflows[data.name] = withId
  }
  return {
    functions: byName<HostFunction>(functionDocs),
    variables: byName<HostVariable>(variableDocs),
    workflows,
  }
}

/**
 * Whether this dataset may take ANOTHER record, on the plan of the org that
 * owns the site — the row band and the byte band, in that order. Null when
 * the append may proceed; a reason string when it may not.
 *
 * ## Why an append needs a gate at all
 *
 * Every other door onto `datasets/{id}/records` already has one: the console
 * route re-checks `recordsPerDataset` inside the creating transaction, the
 * `/v1` record route checks it below its idempotency claim, and the public
 * form-submission leg checks the rows and the bytes. A workflow step wrote
 * with no check of either — and it is the door a visitor drives hardest,
 * because an action fires per event on a published site. A cap enforced at
 * three of four doors is not a cap; it is the shape of the one that is left.
 *
 * ## What it does NOT do
 *
 * It refuses the WRITE, never the dataset. A dataset already holding more
 * rows than the plan includes keeps every row it has and keeps being read —
 * nothing here deletes, truncates, or hides anything, and nothing may be
 * added that does. What is refused is the next row, which is the same
 * boundary the other three doors draw, and the reason a plan change cannot
 * cost a customer data they already have.
 *
 * The update leg of `updateDataset` is deliberately NOT gated: merging fields
 * into a record that already exists adds no row, so refusing it would refuse
 * the state of being over rather than the raise.
 *
 * ## What it costs
 *
 * Nothing on the plans that sell the data store. The row count is read only
 * when `recordsPerDataset` is FINITE, so an uncapped plan pays nothing; and
 * `dataStorageRefusal` answers null with no read at all whenever the plan
 * carries an `extraDataGbMonthlyUsd` rate, which every metered plan does. The
 * reads are paid on the shapes that can actually refuse.
 */
/**
 * Refresh the live pages showing the dataset this step just wrote to
 * (AGL-3113).
 *
 * An automation that appends a row is the same change to a visitor as a form
 * submission or a console edit: the pages repeating over the dataset go on
 * serving the rows they were built from. Announced from the step rather than
 * from the run, so a workflow whose steps write two different datasets
 * refreshes both — the announce coalesces repeats of the SAME dataset itself,
 * which is what a run hitting one dataset several times needs.
 *
 * Silent without an org: datasets are org-scoped, so a host with no resolvable
 * org has no dataset to have written to. Best effort, and never thrown: the
 * row is already stored.
 */
async function announceDatasetStepWrite(
  env: ActionRunEnv,
  datasetId: string,
): Promise<void> {
  if (!env.orgId) return
  await announceDatasetRecordChange({
    firestore: firebaseAdmin.app().firestore(),
    orgId: env.orgId,
    datasetId,
  })
}

async function datasetAppendRefusal(
  env: ActionRunEnv,
  datasetRef: FirebaseFirestore.DocumentReference,
): Promise<string | null> {
  const limit = resolveOrgEntitlements(env.org as never).recordsPerDataset
  if (Number.isFinite(limit)) {
    const used = (
      await datasetRef.collection('records').count().get()
    ).data().count
    if (!checkQuota(env.org as never, 'recordsPerDataset', used).allowed) {
      return `dataset is full (${limit} records on this plan)`
    }
  }
  if (!env.orgId) return null
  const bytes = await dataStorageRefusal(
    env.org as never,
    firebaseAdmin.app().firestore().collection('orgs').doc(env.orgId),
  )
  if (!bytes) return null
  return `dataset storage is full (${bytes.includedMb} MB on this plan)`
}

/** How a run of an action's step list ended. */
type ActionRunEnding = 'ran' | 'waiting' | 'exited' | 'deferred'

interface ExecuteActionOptions {
  /**
   * The step to start at. Non-zero only on a resume, where it is the
   * enrollment's `nextStepIndex`.
   */
  startIndex?: number
  /**
   * The step list to run.
   *
   * A resume passes the enrollment's SNAPSHOT rather than the action's
   * current steps — see `FlowEnrollment.steps` for why a position in a list
   * is meaningless against a list that has since been edited.
   */
  steps?: readonly HostActionStep[]
  /**
   * The enrollment this run belongs to. Present only on a resume; a first run
   * mints one if it reaches a wait.
   */
  enrollmentRef?: FirebaseFirestore.DocumentReference | null
  /**
   * Present for a run of an ORG automation (AGL-3302), naming the
   * organization that owns it. The steps run on this site exactly as a site
   * action's do; what changes is that each is held to the org vocabulary as
   * it runs, a wait enrolls under the org automation's own id, and the
   * history row is filed under it.
   */
  orgAutomation?: { orgId: string }
}

/** What one step is run against: its place, the list it is in, the event. */
interface ServerStepContext {
  /** The step's index in {@link steps}. */
  index: number
  /** The list being run — the snapshot a wait enrolls with. */
  steps: readonly WorkflowStep[]
  event: string
  /** The payload the step reads its values from. */
  payload: HostEventPayload
  /** The scope a step's `when` is evaluated against. */
  scope: Record<string, unknown>
  enrollmentRef: FirebaseFirestore.DocumentReference | null
  /**
   * Set when this run is itself a step of another automation — a workflow a
   * `runWorkflow` step started. Such a run finishes inside its caller's run,
   * so it has no enrollment of its own to wait in.
   */
  nested?: boolean
}

/**
 * What one Actions step did, for the run that holds it.
 *
 * - `skipped` — its `when` was not met, or it is a step the visitor's page
 *   runs; nothing is recorded.
 * - `done` — it did its work; `detail` is the fact the history line carries.
 * - `failed` — it did not; the run records the error and continues.
 * - `exited` — an `exitFlow`: the run ends here.
 * - `waiting` — a wait enrolled the person; the rest runs from the beat.
 * - `halted` — a wait that could not enroll; the run ends with the error.
 * - `deferred` — a resumed send was refused for now; the enrollment retries.
 */
export type ServerStepVerdict =
  | { kind: 'skipped' }
  | { kind: 'done'; detail?: string }
  | { kind: 'failed'; error: string }
  | { kind: 'exited' }
  | { kind: 'waiting'; detail?: string }
  | { kind: 'halted'; error: string }
  | { kind: 'deferred' }

/** A run's tally so far: how it is ending, its errors, what its steps did. */
interface RunTally {
  ending: ActionRunEnding
  errors: string[]
  outcomes: string[]
}

/**
 * Folds one step's verdict into its run's tally, in the run-history phrasing
 * every automation shares; true when the run stops at this step.
 */
function tallyStep(
  tally: RunTally,
  type: HostActionStepType,
  verdict: ServerStepVerdict,
): boolean {
  switch (verdict.kind) {
    case 'skipped':
      return false
    case 'done':
      tally.outcomes.push(describeStepOutcome(type, verdict.detail))
      return false
    case 'failed':
      tally.errors.push(verdict.error)
      return false
    case 'exited':
      tally.ending = 'exited'
      tally.outcomes.push(describeStepOutcome(type))
      return true
    case 'waiting':
      tally.ending = 'waiting'
      tally.outcomes.push(describeStepOutcome(type, verdict.detail))
      return true
    case 'halted':
      tally.errors.push(verdict.error)
      return true
    case 'deferred':
      tally.ending = 'deferred'
      return true
  }
}

/**
 * Runs ONE Actions step on the server: the executor every automation shares.
 *
 * An action's step list runs through it one step at a time, and so does
 * every Actions step inside a workflow — so the two engines cannot disagree
 * about what `sendEmail` or `datasetAppend` does, what a step is gated on, or
 * how its outcome reads in the run history. There is no second copy of any
 * branch below.
 *
 * Client-side steps (AGL-257) are skipped — the tenant page runtime runs
 * those in the visitor's browser.
 *
 * Never throws: a step that throws is a failed step, and the run continues.
 */
async function runServerStep(
  env: ActionRunEnv,
  run: AutomationRun,
  step: HostActionStep,
  context: ServerStepContext,
): Promise<ServerStepVerdict> {
  const { hostId, hostRef, alerts, depth } = env
  const { event, payload, enrollmentRef } = context
  /**
   * The one fact worth carrying into the summary — the dataset's name,
   * the webhook's status. Set by the branch that knows it.
   */
  let detail: string | undefined
  const failed = (error: string): ServerStepVerdict => ({ kind: 'failed', error })
  try {
    /*
     * BRANCHING INSIDE A FLOW: the step's own condition, evaluated against
     * the same scope the trigger's is. An unmet guard skips this step and
     * only this step — the run continues, which is what makes "wait three
     * days, then, only if they have not ordered, send the reminder" a thing
     * an author can write without a second action.
     */
    if (!evaluateStepGuard(step.when, context.scope)) return { kind: 'skipped' }
    if (isClientActionStep(step) && step.type !== 'siteAlert') {
      return { kind: 'skipped' } // Runs in the visitor's page (AGL-257).
    }
    if (step.type === 'exitFlow') return { kind: 'exited' }
    if (isFlowSuspendingStep(step)) {
      // A run inside another automation's run finishes inside it: there is
      // no enrollment of its own for the person to wait in.
      if (context.nested) {
        return {
          kind: 'halted',
          error:
            'a workflow run as a step of another automation cannot wait — ' +
            'give it its own trigger instead',
        }
      }
      const suspended = await suspendFlow(env, run, {
        step,
        steps: context.steps,
        nextStepIndex: context.index + 1,
        event,
        payload,
        enrollmentRef,
      })
      if (suspended.error) return { kind: 'halted', error: suspended.error }
      return { kind: 'waiting', detail: suspended.detail }
    }
    if (step.type === 'siteAlert') {
      alerts.push({
        message: String(step.message ?? '').slice(0, 300),
        severity: step.severity ?? 'info',
      })
    } else if (step.type === 'runWorkflow') {
      const workflowContext = await env.loadWorkflowContext()
      const workflow =
        workflowContext.workflows[step.workflowId?.trim() ?? ''] ??
        workflowContext.workflows[step.workflowName?.trim() ?? '']
      if (!workflow) {
        return failed(`unknown workflow "${step.workflowName || step.workflowId}"`)
      }
      if (workflowHasActionSteps(workflow)) {
        /*
         * A workflow with Actions steps is PERFORMED, not evaluated: its
         * steps run here, inside this run, one level deeper under the same
         * guard a custom-event chain runs under. It is part of this run, so
         * it is not metered or recorded as a run of its own.
         */
        if (depth + 1 > ACTION_MAX_EVENT_DEPTH) {
          return failed(`workflow "${workflow.name}" is nested too deeply`)
        }
        const nested = await executeWorkflow(
          { ...env, depth: depth + 1 },
          {
            kind: 'workflow',
            id: workflow.$id ?? step.workflowId?.trim() ?? '',
            name: workflow.name ?? '',
          },
          workflow as AutomationWorkflow,
          event,
          payload,
          { nested: true },
        )
        if (nested.errors.length) {
          return failed(
            `workflow "${workflow.name}": ${nested.errors.join('; ')}`.slice(0, 300),
          )
        }
      } else {
        const evaluated = runWorkflow(
          workflow,
          workflowContext.functions,
          workflowContext.variables,
          { event, ...payload },
          { workflows: workflowContext.workflows },
        )
        if (evaluated.ok === false) return failed(evaluated.error)
      }
    } else if (step.type === 'customEvent') {
      const nested = await runEventActions(
        hostId,
        step.eventName.trim(),
        payload,
        depth + 1,
      )
      alerts.push(...nested)
    } else if (step.type === 'webhookPost') {
      if (!env.webhooksAllowed) return failed('webhooks require a Business plan')
      // Id-first lookup (AGL-261); the name query is the legacy path.
      const hookDoc = step.webhookId?.trim()
        ? await hostRef
            .collection('webhooks')
            .doc(step.webhookId.trim())
            .get()
        : (
            await hostRef
              .collection('webhooks')
              .where('name', '==', step.webhookName?.trim() ?? '')
              .limit(1)
              .get()
          ).docs[0]
      const hook = hookDoc?.exists
        ? (hookDoc.data() as HostWebhook)
        : undefined
      if (
        !hook ||
        hookDoc.get('deletedAt') ||
        hook.enabled === false ||
        hook.direction !== 'outbound' ||
        !hook.url ||
        !WEBHOOK_URL_PATTERN.test(hook.url)
      ) {
        return failed(`unknown webhook "${step.webhookName || step.webhookId}"`)
      }
      const body = JSON.stringify({
        event,
        payload,
        sentAt: new Date().toISOString(),
      })
      const signature = hook.secret
        ? createHmac('sha256', hook.secret).update(body).digest('hex')
        : ''
      // Two quick retries — serverless-friendly; longer retry queues
      // are a follow-up.
      let delivered = false
      let lastStatus: number | undefined
      for (let attempt = 0; attempt < 3 && !delivered; attempt += 1) {
        try {
          const response = await fetch(hook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(signature && { 'X-Aglyn-Signature': signature }),
            },
            body,
            signal: AbortSignal.timeout(5000),
          })
          lastStatus = response.status
          delivered = response.ok
        } catch {
          // Retry below.
        }
        if (!delivered && attempt < 2) {
          await new Promise((resolve) =>
            setTimeout(resolve, 500 * (attempt + 1)),
          )
        }
      }
      if (!delivered) {
        return failed(
          `webhook "${step.webhookName || step.webhookId}" delivery failed`,
        )
      }
      // The status the mockup prints — discarded on the line it arrived
      // until AGL-2171. A 200 and a 204 are both `ok`, and knowing which is
      // the whole reason anyone opens a run history after a webhook.
      detail = String(lastStatus ?? '')
    } else if (step.type === 'datasetAppend') {
      // Id-first lookup (AGL-261/556); the name query is the legacy path.
      const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
      const datasetDoc = await resolveDatasetDoc(datasetsRef, step, hostId)
      if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) {
        return failed(`unknown dataset "${step.datasetName || step.datasetId}"`)
      }
      // Restrict to the model's field ids (AGL-556) — covers model-only
      // datasets whose flat v1 `fields` mirror is absent.
      const appendDataset = {
        model: datasetDoc.get('model'),
        fields: Array.isArray(datasetDoc.get('fields'))
          ? datasetDoc.get('fields')
          : [],
      }
      const values = buildDatasetRecordValues(appendDataset, payload)
      // Same name precedence `findDatasetByName` resolves in.
      const appendLabel = (
        datasetDisplayName({
          displayName: datasetDoc.get('displayName'),
          name: datasetDoc.get('name'),
        }) ||
        step.datasetName ||
        ''
      ).slice(0, 60)
      // No event field matched a field of the dataset, so there is nothing
      // to write. An error rather than a quiet success: a run history that
      // says `saved to Leads` while nothing saves is how a mismatched field
      // name goes unnoticed.
      if (!Object.keys(values).length) {
        return failed(
          `no event field matches a field in dataset "${appendLabel || step.datasetId}"`,
        )
      }
      const refusal = await datasetAppendRefusal(env, datasetDoc.ref)
      if (refusal) return failed(refusal)
      await datasetDoc.ref.collection('records').add({
        values,
        // The integrity index the console's delete check queries —
        // carried by every write that sets `values`, or the index
        // describes rows this one never held.
        ...datasetIntegrityFields(
          effectiveDatasetModel(appendDataset),
          values,
        ),
        createdAt: FieldValue.serverTimestamp(),
      })
      await announceDatasetStepWrite(env, datasetDoc.id)
      // `saved to Leads` beats `saved to dataset` (AGL-2171).
      detail = appendLabel
    } else if (step.type === 'updateDataset') {
      // Update-or-append (AGL-257): matches the record whose `email`
      // field equals the payload's email; appends when nothing matches.
      const datasetsRef = await orgDataCollectionForHost(hostId, 'datasets')
      const datasetDoc = await resolveDatasetDoc(datasetsRef, step, hostId)
      if (!datasetDoc?.exists || datasetDoc.get('deletedAt')) {
        return failed(`unknown dataset "${step.datasetName || step.datasetId}"`)
      }
      const updateDataset = {
        model: datasetDoc.get('model'),
        fields: Array.isArray(datasetDoc.get('fields'))
          ? datasetDoc.get('fields')
          : [],
      }
      const updateModel = effectiveDatasetModel(updateDataset)
      const values = buildDatasetRecordValues(updateDataset, payload)
      // Nothing to merge or append — an error, for the reason the append
      // branch above gives.
      if (!Object.keys(values).length) {
        const updateLabel =
          datasetDisplayName({
            displayName: datasetDoc.get('displayName'),
            name: datasetDoc.get('name'),
          }) ||
          step.datasetName ||
          step.datasetId
        return failed(
          `no event field matches a field in dataset "${String(updateLabel ?? '').slice(0, 60)}"`,
        )
      }
      const email = String((payload as any).email ?? '').trim()
      // `records.values` is exempt from indexing, so this lookup is served
      // only by the `values.email` field override in
      // cloud/firebase-firestore.indexes.json. Without that override
      // production refuses the query and neither leg below runs.
      const existing = email
        ? await datasetDoc.ref
            .collection('records')
            .where('values.email', '==', email)
            .limit(1)
            .get()
        : null
      if (existing && !existing.empty) {
        const merged = {
          ...(existing.docs[0].get('values') ?? {}),
          ...values,
        }
        await existing.docs[0].ref.set(
          {
            values: merged,
            // The merging form: an update that clears the last reference
            // has to REMOVE the index rather than omit it, or a stale
            // array refuses a delete nothing is holding.
            ...datasetIntegrityUpdate(
              updateModel,
              merged,
              FieldValue.delete(),
            ),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
      } else {
        // The APPEND leg of update-or-append, and the only one of the two
        // that adds a row — the merge above rewrites a record that already
        // counts against the band.
        const refusal = await datasetAppendRefusal(env, datasetDoc.ref)
        if (refusal) return failed(refusal)
        await datasetDoc.ref.collection('records').add({
          values,
          ...datasetIntegrityFields(updateModel, values),
          createdAt: FieldValue.serverTimestamp(),
        })
      }
      // Both legs changed a row, so both make the same pages stale — an edited
      // record reads no differently from a new one on a page that lists them.
      await announceDatasetStepWrite(env, datasetDoc.id)
    } else if (step.type === 'notifyAdmins') {
      await notifyHostManagers(hostId, {
        type: 'system.announcement',
        title: String(step.title ?? '').slice(0, 200),
        ...(step.body ? { body: String(step.body).slice(0, 500) } : {}),
        link: `/${hostId}`,
      })
    } else if (step.type === 'sendEmail') {
      const to = String(
        (payload as any)[step.toField?.trim() || 'email'] ?? '',
      ).trim()
      if (!isEmailConfigured()) return failed('email is not configured')
      if (!to || !to.includes('@')) {
        return failed('no recipient email in the event payload')
      }
      // The site's own origin, for the unsubscribe link. Read here rather
      // than carried on the run env because most action runs send no email
      // at all, and a document read every workflow pays for is a read on
      // the hot path for a link nine runs in ten never need.
      const siteBase =
        hostPublicOrigin(
          (await hostRef.get().catch(() => null))?.data() as never,
        ) ?? ''
      /*
       * MARKETING. The subject and body are merchant-authored and the
       * recipient comes out of the event payload — which, for the collect
       * route, is a write triggered by an anonymous visitor. So this is a
       * site mailing an address on the merchant's say-so, and it owes what
       * every other such message owes: the unsubscribe header pair and a
       * visible link, both suppression lists, and a share of the ceiling on
       * how much one person receives from this site.
       *
       * Priority stays transactional. An action run is not resumable — the
       * event has already happened and there is no beat that comes back for
       * it — and the rule on `'bulk'` is that only a resumable sweep may
       * refuse in a way the recipient survives.
       *
       * A merchant who wants an internal alert that no suppression can stop
       * uses the `notifyAdmins` step beside this one: it reaches managers
       * in the console rather than the shared sending domain, which is the
       * right instrument for a notification nobody consented to receive.
       */
      /*
       * A STEP THAT RUNS AFTER A WAIT IS A CAMPAIGN, not a reply.
       *
       * The paragraph above is exactly right about an IMMEDIATE step: the
       * event has already happened, the recipient just did something, and
       * the message is the response to it. None of that survives a three-day
       * delay. Everything after a wait goes out on the merchant's schedule,
       * to somebody who did one thing once — which is `marketing-send.ts`'s
       * own definition of marketing mail, and it earns the full consent
       * split and the default stream, exactly as a campaign does.
       *
       * An immediate step is not ungated, which it used to be. `to` is read
       * out of the event payload — an anonymous visitor's write on the
       * collect route — so nothing here establishes that whoever typed the
       * address is whoever receives the mail, and a person with a RECORDED
       * REFUSAL on this site was mailed merchant-authored content because a
       * third party entered their address in a form. `'immediate'` asks the
       * narrower question that catches exactly that and cannot refuse a
       * new visitor their auto-response: see `FlowEmailScope`.
       *
       * Refused BEFORE `sendEmail` rather than inside it, because these two
       * are the merchant's own policy over their own audience, where the
       * ones the seam asks are platform controls over the shared sending
       * domain. Both refusals are permanent for this message, so the
       * enrollment moves on rather than retrying.
       */
      const scope = enrollmentRef ? 'scheduled' : 'immediate'
      /*
       * The stream this message belongs to, resolved ONCE and read twice:
       * the gate below filters on it, and it rides the `marketing` context
       * so the opt-out link the seam mints names it. Without that the
       * preference page opens on a list of every stream the site has, and
       * the recipient has to find the one they were trying to leave.
       */
      const topicId = flowEmailTopicId(step.topicId, scope)
      const gate = await flowEmailRefusal({
        hostId,
        email: to,
        topicId: step.topicId ?? null,
        org: env.org,
        scope,
      })
      if (gate) {
        return failed(
          gate !== 'consent-withheld'
            ? 'the recipient has left this email topic'
            : // Named by what was actually asked. An immediate step refuses
              // only on a stated refusal, so reporting it as a missing
              // record would send a merchant looking for a consent field to
              // fill in that would change nothing.
              enrollmentRef
              ? 'the recipient has no marketing consent record on this site'
              : 'the recipient has declined marketing from this site',
        )
      }
      const emailSubject = String(step.subject ?? '').slice(0, 200)
      const emailText = String(step.body ?? '').slice(0, 5000)
      /*
       * THE TIMELINE ENTRY (AGL-2615). A message addressed to the contact
       * the event is about is logged on that contact's timeline as an
       * email activity — the same row the console's own send logs — so an
       * automated welcome shows beside the calls a rep made, with its
       * delivery state. Prepared first because the row's id has to be on
       * the message for the webhook to find it; written only after the
       * provider accepted. Behind the suite gate like every other CRM
       * write an action makes.
       */
      const emailActivity = env.crmAllowed
        ? await prepareCrmEmailActivity(
            { hostId, org: env.org, orgId: env.orgId },
            to,
            payload,
          )
        : null
      const result = await sendEmail({
        to,
        subject: emailSubject,
        text: emailText,
        sendingIdentity: await hostSendingIdentity(hostId),
        ...(emailActivity ? { tags: emailActivity.tags } : {}),
        audience: 'tenant',
        context: enrollmentRef ? 'flow step' : 'event action',
        /*
         * A resumed step may take `'bulk'` where an immediate one may not,
         * and the reason is the same one the abandoned-checkout sweep gives:
         * only a RESUMABLE sender may be refused in a way the recipient
         * survives. The enrollment is the thing that makes it resumable —
         * a deferral below leaves the row waiting and the next beat sends
         * the same step to the same person.
         */
        ...(enrollmentRef ? { priority: 'bulk' as const } : {}),
        // `topicId` is `''` for a step that belongs to no stream, which
        // every reader of it treats as absent — see `flowEmailTopicId`.
        // The consent group comes off the org the run already holds, so the
        // gate honors an unsubscribe from any site of a declared group —
        // the sender this site mails as — at no extra read.
        marketing: {
          hostId,
          siteBase,
          topicId,
          consentHostIds: consentGroupForHost(
            (env.org as Record<string, unknown> | null) ?? null,
            hostId,
          ).hostIds,
        },
      })
      /*
       * DEFERRED IS NOT FAILED, and it is not SENT either.
       *
       * The platform's hourly ceiling and this person's own frequency window
       * are both refusals a later beat can pass. Advancing past this step
       * would turn "not this hour" into an email nobody ever receives, which
       * is the defect the campaign processor and the cart sweep each name.
       * So the enrollment is put back with the SAME `nextStepIndex` and the
       * run ends here.
       */
      if (enrollmentRef && isDeferrableSendResult(result)) {
        return { kind: 'deferred' }
      }
      // Named rather than lumped into "delivery failed": a suppression and
      // a frequency ceiling are the controls working, and a merchant
      // reading the run's alerts has a different thing to do about each.
      const refusal = sendFailureReason(result)
      const sendError = refusal
        ? refusal === 'suppressed'
          ? 'the recipient is unsubscribed or suppressed'
          : refusal === 'frequency-capped'
            ? 'the recipient has already had today’s limit of email ' +
              'from this site'
            : 'email delivery failed'
        : null
      // Cost meter (AGL-1438). A workflow notification is transactional:
      // counted, never capped. `sent` is false when Resend refused or the
      // environment is unconfigured, and an email that never left is not a
      // cost.
      if (result.sent) {
        await meterHostEmail(hostId)
        if (emailActivity) {
          await logCrmEmailActivity(
            { hostId, org: env.org, orgId: env.orgId },
            emailActivity,
            { subject: emailSubject, body: emailText, to },
            run.id,
          )
        }
      }
      if (sendError) return failed(sendError)
    } else if (step.type === 'enrollList') {
      const orgId = await resolveOrgIdForHost(hostId)
      const email = String((payload as any).email ?? '')
        .trim()
        .toLowerCase()
      if (!orgId || !email || !email.includes('@')) {
        return failed('no email to enroll')
      }
      const listsRef = firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(orgId)
        .collection('lists')
      const listDoc = step.listId?.trim()
        ? await listsRef.doc(step.listId.trim()).get()
        : (
            await listsRef
              .where('name', '==', step.listName?.trim() ?? '')
              .limit(1)
              .get()
          ).docs[0]
      if (!listDoc?.exists) {
        return failed(`unknown list "${step.listName || step.listId}"`)
      }
      // `enrollListMember` owns the document id: the commerce newsletter
      // handler enrolls into the same collection, and an id derived here
      // would be a second answer to which document describes which person.
      await enrollListMember({
        listRef: listDoc.ref,
        group: await consentGroupForSite(hostId),
        email,
        // Which automation enrolled them: `action:<id>` or `workflow:<id>`.
        source: `${run.kind}:${run.id}`,
      })
    } else if (step.type === 'assignCampaign') {
      const email = String((payload as any).email ?? '')
        .trim()
        .toLowerCase()
      if (!email || !email.includes('@')) {
        return failed('no contact email to assign')
      }
      // Scoped to this host (AGL-1039): a site must not reach a contact
      // it cannot see, even to tag it onto a campaign. Through the org's
      // address index (AGL-2633), so an address a merge folded into
      // another record still names the person who now holds it.
      const { ref: contactsRef } = await orgDataQueryForHost(hostId, 'contacts')
      const contact = await findContactByEmail(contactsRef, email, { hostId })
      if (!contact) return failed(`no contact for ${email}`)
      /*
       * THE CAMPAIGN IS RESOLVED TO A DOCUMENT, exactly as `enrollList`
       * resolves a list one branch above.
       *
       * A step may name a campaign by id or by name — the picker writes the
       * id, an imported automation may carry only the name — and what gets
       * stored is the id either way. Storing whichever of the two the step
       * happened to hold would put names and ids in one array, and every
       * reader of that array resolves ids: a name in it renders as a chip
       * nobody can click and matches no campaign the console can find.
       *
       * An unknown campaign is an ERROR rather than a stored string. The
       * reference audit already reports a step pointing at a campaign that
       * does not exist; a run that wrote the dangling name anyway would
       * make the audit's finding untrue the moment it fired.
       *
       * The containers are the ORGANIZATION's, and this run is one site's,
       * so a campaign counts only while it is live and placed on this site
       * (`visibleTo` holds `org` or `host:{hostId}`) — the same set the
       * site's picker offers. One the console deleted, or one placed only
       * on a sibling site, is refused like a missing one: filing a person
       * under it would put them in a campaign nobody at this site can open.
       * A name lookup reads a few matches rather than one, so a deleted or
       * sibling campaign sharing the name cannot shadow the live one.
       */
      const campaignLabel = step.campaignName || step.campaignId
      const campaignOrgId = env.orgId ?? (await resolveOrgIdForHost(hostId))
      if (!campaignOrgId) return failed(`unknown campaign "${campaignLabel}"`)
      const campaignsRef = firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(campaignOrgId)
        .collection('emailCampaigns')
      const usable = (doc: FirebaseFirestore.DocumentSnapshot | undefined) =>
        Boolean(
          doc?.exists &&
            !doc.get('deletedAt') &&
            visibleToHost(doc.get('visibleTo') as string[] | undefined, hostId),
        )
      const namedId = step.campaignId?.trim() ?? ''
      const campaignDoc = namedId
        ? await campaignsRef.doc(namedId).get()
        : (
            await campaignsRef
              .where('name', '==', step.campaignName?.trim() ?? '')
              .limit(10)
              .get()
          ).docs.find(usable)
      if (!campaignDoc?.exists) {
        return failed(`unknown campaign "${campaignLabel}"`)
      }
      if (campaignDoc.get('deletedAt')) {
        return failed(`campaign "${campaignLabel}" was deleted`)
      }
      if (!usable(campaignDoc)) {
        return failed(`campaign "${campaignLabel}" is not placed on this site`)
      }
      /*
       * INSIDE THIS SITE'S FACET, not at the top of the document.
       *
       * A contact is one row shared by every site in the org, and which
       * campaigns a merchant has filed somebody under is that merchant's
       * business record on the same footing as their notes and their tags.
       * Written at the top it would be readable by every other site in an
       * agency's account.
       *
       * `update` with a dotted path, never `set({merge:true})`: a `set`
       * treats the string as a literal field NAME and would mint a
       * top-level key with dots in it. The document was just read, so the
       * update cannot fail for absence.
       */
      const group = await consentGroupForSite(hostId)
      await contact.ref.update({
        [contactCampaignFieldPath(group.groupId)]: FieldValue.arrayUnion(
          campaignDoc.id,
        ),
        updatedAt: FieldValue.serverTimestamp(),
      })
    } else if (isCrmActionStep(step)) {
      // The plan gate, the way `webhookPost` takes the `webhooks` one:
      // refused into the run history with the tier that carries it, so
      // a Free workspace whose flow names a CRM step reads why the step
      // did nothing rather than a log that says it ran.
      if (!env.crmAllowed) {
        return failed(
          `CRM steps require the ${planLabelGrantingFeature('crm')} plan`,
        )
      }
      // The five CRM steps (AGL-2605) share a resolver and a scope, so
      // they share a module; see `crm-action-steps.ts`.
      const outcome = await runCrmActionStep(
        { hostId, org: env.org, orgId: env.orgId },
        run.id,
        step,
        payload,
      )
      if (outcome.error) return failed(outcome.error)
      detail = outcome.detail
      /*
       * A stage set by an automation IS a stage change, and whatever
       * listens for one must hear it — fanned out here, under the same
       * depth guard a `customEvent` chain runs under, rather than through
       * `emitHostEvent`, which starts every chain at depth zero and would
       * let an automation that sets the stage it listens for run forever.
       * Workflows take the guard too, now that a workflow can set a stage.
       */
      if (outcome.emit) {
        const [fromWorkflows, fromActions] = await Promise.all([
          runEventWorkflows(
            hostId,
            outcome.emit.event,
            outcome.emit.payload,
            depth + 1,
          ),
          runEventActions(
            hostId,
            outcome.emit.event,
            outcome.emit.payload,
            depth + 1,
          ),
        ])
        alerts.push(...fromActions, ...fromWorkflows)
      }
    }
  } catch (error) {
    return failed((error as Error).message)
  }
  return { kind: 'done', detail }
}

/**
 * Executes one action's SERVER steps in order, collecting per-step errors
 * into the activity summary. Each step runs through {@link runServerStep}.
 *
 * An org automation's run comes through here too (AGL-3302): on the site the
 * event happened on, against that site's run environment, so its email goes
 * from that site and its CRM writes land in that site's facet.
 *
 * A `wait` step ENDS this call and hands the rest of the list to the job
 * beat: everything after the wait belongs to a run that has not happened yet,
 * so nothing below the wait may execute in this request.
 */
export async function executeAction(
  env: ActionRunEnv,
  actionId: string,
  action: Pick<HostAction, 'name' | 'steps'>,
  event: string,
  payload: HostEventPayload,
  options: ExecuteActionOptions = {},
): Promise<ActionRunEnding> {
  const { hostRef } = env
  const orgRun = options.orgAutomation ?? null
  const run: AutomationRun = orgRun
    ? {
        kind: 'orgAutomation',
        id: actionId,
        name: action.name ?? '',
        orgId: orgRun.orgId,
      }
    : {
        kind: 'action',
        id: actionId,
        name: action.name ?? '',
      }
  const enrollmentRef = options.enrollmentRef ?? null
  const steps = (options.steps ?? action.steps ?? []).slice(0, ACTION_MAX_STEPS)
  const startIndex = Math.max(0, options.startIndex ?? 0)
  /**
   * What each step actually DID (AGL-2171). Only failures were recorded,
   * so a run that sent an email, wrote a row and posted a webhook logged
   * the same eight words as a run that did nothing — and
   * `/product/workflows` advertises a `What happened` column reading
   * `Sent email · saved to Leads · webhook 200`.
   */
  const tally: RunTally = { ending: 'ran', errors: [], outcomes: [] }
  const scope = { event, ...payload }
  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index] as HostActionStep
    /*
     * An org automation runs its own vocabulary and nothing else. The save
     * route refuses the rest, so this answers only a document written around
     * it — and answers it before the step can reach this site's workflows or
     * webhooks, which are not the organization's to call.
     */
    const refusal = orgRun ? orgAutomationStepRefusal(step) : null
    if (refusal) {
      tally.errors.push(refusal)
      continue
    }
    const verdict = await runServerStep(env, run, step, {
      index,
      steps,
      event,
      payload,
      scope,
      enrollmentRef,
    })
    if (tallyStep(tally, step.type, verdict)) break
  }
  const { ending, errors: stepErrors, outcomes } = tally
  /*
   * A DEFERRED run writes no history line and leaves the enrollment where it
   * was. Nothing happened that a merchant should read as a run: the step is
   * still ahead of this person, and a row per refused beat would bury the
   * runs that did something under a log of the ceiling working.
   */
  if (ending === 'deferred') return ending
  const noun = orgRun ? 'Org automation' : 'Action'
  const summary = stepErrors.length
    ? `${noun} ran on ${event} with errors: ${stepErrors.join('; ')}`.slice(
        0,
        300,
      )
    : ending === 'waiting'
      ? `${noun} is waiting, on ${event}`
      : `${noun} ran on ${event}`
  await hostRef
    .collection('activity')
    .add({
      actorId: null,
      actorEmail: null,
      // The prose line stays exactly as it was: `activityPrimaryText` and
      // three other renderers read it, and the run table is not the only
      // thing this collection feeds.
      action: summary,
      // The structured half (AGL-2171) — the two columns the advertised
      // run-history table could not otherwise fill.
      result: stepErrors.length ? 'failed' : 'succeeded',
      trigger: event,
      summary: (outcomes.length ? outcomes.join(' · ') : 'Ran').slice(0, 300),
      target: {
        // An org automation's run is filed under its own type, so the site's
        // run history can tell it from a site action sharing the feed.
        type: orgRun ? ORG_AUTOMATION_RUN_TARGET : 'workflow',
        id: actionId,
        name: action.name ?? '',
      },
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
  return ending
}

/** How a workflow run went, for whoever records or answers for it. */
export interface WorkflowExecution {
  ending: ActionRunEnding
  /**
   * Every error, in step order. An Actions step's error is recorded and the
   * run goes on, as it does in an action; a function call's error ENDS the
   * run, as it always has, because the steps after it read its result.
   */
  errors: string[]
  /** What each step that ran did, in the Actions run-history phrasing. */
  outcomes: string[]
  /** The workflow's return value, as the pure evaluator reports it. */
  value: number | string | boolean
  /** Every result the function calls bound, by name. */
  results: Record<string, number | string | boolean>
}

interface ExecuteWorkflowOptions {
  /** The step to start at: a resume's `nextStepIndex`. */
  startIndex?: number
  /** The list to run: a resume's snapshot. */
  steps?: readonly WorkflowStep[]
  /** The enrollment a resume belongs to. */
  enrollmentRef?: FirebaseFirestore.DocumentReference | null
  /** A run started by another automation's `runWorkflow` step. */
  nested?: boolean
}

/**
 * Runs a workflow whose steps include Actions steps: function calls and
 * Actions steps, in order, in one scope.
 *
 * - A FUNCTION CALL is evaluated by the platform's pure evaluator,
 *   `runWorkflow`, one call at a time, so its expressions see the event, the
 *   site's variables and every result bound before it — exactly the scope a
 *   function-only workflow gives it. A call that fails ends the run.
 * - An ACTIONS STEP runs through {@link runServerStep}, the executor actions
 *   use, and reads the event payload together with every result bound so
 *   far: a workflow can compute a score and write it to a dataset. Each one
 *   takes the Actions tier gate (`actions`, Pro and up) on top of its own —
 *   `webhookPost` on Business, the CRM steps on the CRM suite — and a step
 *   only the visitor's browser can run is refused.
 * - `wait` and `waitForEvent` enroll the person and end this call; the rest
 *   of the list, results included, continues from the beat. `exitFlow` ends
 *   the run.
 *
 * Records nothing and meters nothing: the caller that admitted the run does
 * both, once.
 */
export async function executeWorkflow(
  env: ActionRunEnv,
  run: AutomationRun,
  workflow: AutomationWorkflow,
  event: string,
  payload: HostEventPayload,
  options: ExecuteWorkflowOptions = {},
): Promise<WorkflowExecution> {
  const steps = options.steps ?? workflow.steps ?? []
  const tally: RunTally = { ending: 'ran', errors: [], outcomes: [] }
  const results: Record<string, number | string | boolean> = {}
  if (steps.length > WORKFLOW_MAX_STEPS) {
    return {
      ...tally,
      errors: [`Workflows are capped at ${WORKFLOW_MAX_STEPS} steps`],
      value: '',
      results,
    }
  }
  const context = await env.loadWorkflowContext()
  const enrollmentRef = options.enrollmentRef ?? null
  const startIndex = Math.max(0, options.startIndex ?? 0)
  /** The payload an Actions step reads: the event's, then every result. */
  const stepPayload = (): HostEventPayload => ({ ...payload, ...results })
  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index]
    if (!isWorkflowActionStep(step)) {
      const call = step as HostWorkflowStep
      const resultName = call.resultName?.trim() || `step${index + 1}`
      const evaluated = runWorkflow(
        { name: workflow.name, steps: [{ ...call, resultName }] },
        context.functions,
        context.variables,
        { event, ...stepPayload() },
        { workflows: context.workflows },
      )
      if (evaluated.ok === false) {
        // The evaluator numbers the one step it was handed; the author
        // numbers it by its place in the workflow.
        tally.errors.push(
          evaluated.error.replace(/^Step 1\b/, `Step ${index + 1}`),
        )
        break
      }
      results[resultName] = evaluated.results[resultName]
      tally.outcomes.push(
        `ran ${String(call.functionName || call.functionId || 'a function').trim()}`,
      )
      continue
    }
    const refusal = workflowActionStepRefusal(step)
    if (refusal) {
      tally.errors.push(refusal)
      continue
    }
    if (!env.actionsAllowed) {
      tally.errors.push(
        `“${workflowStepTypeLabel(step.type)}” needs the ` +
          `${planLabelGrantingFeature('actions')} plan`,
      )
      continue
    }
    const verdict = await runServerStep(env, run, step, {
      index,
      steps,
      event,
      payload: stepPayload(),
      scope: { event, ...stepPayload() },
      enrollmentRef,
      nested: options.nested,
    })
    if (tallyStep(tally, step.type, verdict)) break
  }
  /*
   * The return value the pure evaluator would give: the named scope entry —
   * a result, a payload field or a variable — when the workflow names one,
   * and the last result otherwise. Asked of the evaluator itself, with no
   * steps, so a variable resolves by the evaluator's own rules.
   */
  const returnName = workflow.returnValue?.trim()
  const value = returnName
    ? (() => {
        const named = runWorkflow(
          { name: workflow.name, steps: [], returnValue: returnName },
          context.functions,
          context.variables,
          { event, ...stepPayload() },
        )
        return named.ok === false ? '' : named.value
      })()
    : (Object.values(results).at(-1) ?? '')
  return { ...tally, value, results }
}

/**
 * Suspends the run at a `wait` or `waitForEvent` step.
 *
 * One function for both the first suspension and every later one, because the
 * two differ only in whether a row already exists — and writing "create here,
 * update there" twice is how the two drift into disagreeing about which
 * fields a waiting enrollment carries.
 */
async function suspendFlow(
  env: ActionRunEnv,
  run: AutomationRun,
  request: {
    step: HostActionStep
    steps: readonly WorkflowStep[]
    nextStepIndex: number
    event: string
    payload: HostEventPayload
    enrollmentRef: FirebaseFirestore.DocumentReference | null
  },
): Promise<{ error?: string; detail?: string }> {
  const { step } = request
  const minutes =
    step.type === 'wait'
      ? Number(step.delayMinutes)
      : step.type === 'waitForEvent'
        ? Number(step.timeoutMinutes)
        : 0
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { error: 'the wait has no duration' }
  }
  const nowMs = Date.now()
  const resumeAtMs = nowMs + minutes * 60_000
  const awaitingEvent =
    step.type === 'waitForEvent' ? step.eventName.trim() : null
  const detail =
    step.type === 'waitForEvent'
      ? `${awaitingEvent} (up to ${minutes}m)`
      : `${minutes}m`

  if (request.enrollmentRef) {
    await advanceFlowEnrollment(
      request.enrollmentRef,
      {
        nextStepIndex: request.nextStepIndex,
        resumeAtMs,
        awaitingEvent,
        payload: request.payload as Record<string, unknown>,
      },
      nowMs,
    )
    return { detail }
  }

  const enrolled = await enrollInFlow({
    hostId: env.hostId,
    actionId: run.id,
    // Absent for an action, which is every enrollment written before a
    // workflow could wait — the resume reads absent as `action`.
    ...(run.kind === 'workflow' ? { automation: 'workflow' as const } : {}),
    // An org automation waits on the site it ran on, under its own id prefix,
    // and names the organization whose document the resume re-reads.
    ...(run.kind === 'orgAutomation'
      ? { automation: 'org' as const, orgId: run.orgId ?? env.orgId ?? '' }
      : {}),
    // The SNAPSHOT is the list this run is executing, which on a first run is
    // the automation's own — so one edited later cannot move this person's
    // remaining steps out from under them.
    action: { name: run.name, steps: [...request.steps] },
    email: String((request.payload as any)?.['email'] ?? ''),
    event: request.event,
    payload: (request.payload ?? {}) as Record<string, unknown>,
    nextStepIndex: request.nextStepIndex,
    resumeAtMs,
    awaitingEvent,
    nowMs,
  })
  if (enrolled.enrolled === true) return { detail }
  /*
   * Both refusals are stated rather than swallowed, because both are things
   * an author can act on: a flow that waits needs an address in its trigger
   * payload, and a person already inside this flow is not put through it
   * twice concurrently.
   */
  return {
    error:
      enrolled.reason === 'no-person'
        ? 'a flow that waits needs the person’s email in the event payload'
        : 'this person is already waiting inside this flow',
  }
}

/**
 * Events too frequent to log a skip for.
 *
 * `runEventActions` fires on EVERY page view of every published site. A
 * Firestore write per visitor per non-matching action is not a run
 * history, it is an outage — and a page-view condition is one an author
 * tunes by watching the site, not by reading a log. The events people
 * actually debug are the server-emitted ones (a form submission, a
 * booking, a sign-up), and those are low-volume by construction.
 */
const SKIP_LOG_EXCLUDED_EVENTS = new Set(['pageView'])

/**
 * Writes the `Skipped` row (AGL-2171): which condition stopped the run,
 * so the answer to "why didn't it fire?" is in the same place as every
 * run that did.
 *
 * Never counts against `actionRunsPerMonth` — nothing executed, and
 * charging for a condition that said no would be its own bug.
 */
async function recordSkippedRun(
  hostRef: FirebaseFirestore.DocumentReference,
  actionId: string,
  action: Pick<HostAction, 'name' | 'trigger'>,
  event: string,
  kind: 'action' | 'orgAutomation' = 'action',
): Promise<void> {
  if (SKIP_LOG_EXCLUDED_EVENTS.has(event)) return
  // `normalizeTriggerConditions`, not `trigger.conditions` — a pre-AGL-565
  // action carries a single `condition` and reading only the array would
  // give every one of them the nameless fallback.
  const named = normalizeTriggerConditions(action.trigger)
    .map((condition) => String(condition?.field ?? '').trim())
    .filter(Boolean)
  const reason = named.length
    ? `Condition on ${named.slice(0, 3).join(', ')} not met`
    : 'Trigger condition not met'
  await hostRef
    .collection('activity')
    .add({
      actorId: null,
      actorEmail: null,
      action: `${kind === 'orgAutomation' ? 'Org automation' : 'Action'} skipped on ${event}`,
      result: 'skipped',
      trigger: event,
      summary: reason.slice(0, 300),
      target: {
        type: kind === 'orgAutomation' ? ORG_AUTOMATION_RUN_TARGET : 'workflow',
        id: actionId,
        name: action.name ?? '',
      },
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
}

/**
 * Event-triggered action runner (AGL-148): loads enabled actions whose
 * `trigger.event` matches (built-in, site event, or custom), evaluates
 * optional filters over the payload, and executes each step list in
 * order. Never throws into the emitting request. Paid feature: the
 * `actions` flag gates and `actionRunsPerMonth` meters runs.
 *
 * The organization's automations placed on this site run here too
 * (AGL-3302), after the site's own, on the same run environment — they run
 * AS this site — and on the same meter.
 */
export async function runEventActions(
  hostId: string,
  event: string,
  payload: HostEventPayload = {},
  depth = 0,
): Promise<HostActionAlert[]> {
  const alerts: HostActionAlert[] = []
  if (depth > ACTION_MAX_EVENT_DEPTH) return alerts
  /*
   * A flow waiting for THIS event, for THIS person, resumes here.
   *
   * Above the action lookup and outside its try, because the two are
   * unrelated: an event that matches no action can still be the one a flow
   * has been waiting a week for, and a site with no actions at all can hold
   * enrollments from an action that has since been rewritten.
   */
  await wakeFlowsAwaitingEvent(hostId, event, payload).catch(() => undefined)
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const triggered = await hostRef
      .collection('actions')
      .where('trigger.event', '==', event)
      .limit(MAX_TRIGGERED_ACTIONS)
      .get()
    const actions = triggered.docs.filter(
      (doc) => !doc.get('deletedAt') && doc.get('enabled') !== false,
    )
    /*
     * THE ORGANIZATION'S AUTOMATIONS placed on this site and not paused here.
     *
     * Asked only for an org trigger — a server event a person is the subject
     * of — so a page view, a custom event and every on-page site event cost
     * nothing more than they did. Never throws: an org lookup that fails runs
     * this site's own actions exactly as before.
     */
    const placed = await findOrgAutomationsForEvent(hostId, event)
    if (!actions.length && !placed) return alerts

    const monthKey = new Date().toISOString().slice(0, 7)
    const runCounterRef = hostRef.collection('counters').doc('actionRuns')
    // Webhook steps take the higher `webhooks` gate (AGL-149); plan gates
    // ride the owning org's doc (AGL-238).
    let webhooksAllowed = true
    let crmAllowed = true
    /*
     * Whether each half fits under the month's allowance — all or nothing per
     * half, as the site's own actions always were.
     *
     * The site's actions are asked first and on exactly the question they
     * were always asked, so an organization placing automations on a site can
     * never be what stops that site's own actions running. The org half is
     * asked second, against what is left after the site's half, and both
     * count on this site's one meter: an org automation's run is this site's
     * run, and the usage card, the usage alerts and the COGS rollup read it
     * there.
     */
    let runSite = false
    let runOrg = false
    // Plan-less orgs resolve as free (AGL-247) — gates always run. Held for
    // the rest of the run so the dataset caps below cost no second read.
    const owner = await getOrgForHost(hostId)
    {
      const org = owner?.org
      if (!checkEntitlement(org as any, 'actions')) return alerts
      webhooksAllowed = checkEntitlement(org as any, 'webhooks')
      crmAllowed = checkEntitlement(org as any, 'crm')
      const limit = resolveOrgEntitlements(
        org as any,
      ).actionRunsPerMonth
      const counterSnapshot = await runCounterRef.get()
      const used = Number(counterSnapshot.get(monthKey) ?? 0)
      // Asked as "would it go over", the question this gate has always
      // asked — so a counter that reads as no number refuses nothing, as
      // before, rather than refusing everything.
      runSite = actions.length > 0 && !(used + actions.length > limit)
      /*
       * Only for the organization the site belongs to NOW: the automations
       * were found through the site's org, and a site that changed hands
       * between the two reads runs none of its old organization's.
       */
      runOrg =
        Boolean(placed) &&
        placed?.orgId === owner?.orgId &&
        !(
          used + (runSite ? actions.length : 0) + (placed?.docs.length ?? 0) >
          limit
        )
      if (!runSite && !runOrg) return alerts
    }

    const env: ActionRunEnv = {
      hostId,
      hostRef,
      alerts,
      // Admitted by the `actions` gate above.
      actionsAllowed: true,
      webhooksAllowed,
      crmAllowed,
      depth,
      org: owner?.org ?? null,
      orgId: owner?.orgId ?? null,
      loadWorkflowContext: makeWorkflowContextLoader(hostRef),
    }

    let executed = 0
    for (const doc of runSite ? actions : []) {
      const action = doc.data() as HostAction
      const filter = action.trigger?.filter?.trim()
      if (filter) {
        try {
          if (!evaluateExpression(filter, { event, ...payload })) continue
        } catch {
          continue // A broken filter never fires.
        }
      }
      // Structured payload conditions (AGL-557; AND/OR chaining AGL-565):
      // same scope as the filter; unmet conditions skip the action and
      // never count as a run against the quota.
      if (!evaluateTriggerConditions(action.trigger, { event, ...payload })) {
        // …but they are RECORDED now (AGL-2171). This was a bare
        // `continue`, so "why didn't my automation fire?" — the most
        // common support question about automations — had no answer
        // anywhere in the product, while `/product/workflows` advertises
        // an amber `Skipped` row that answers it.
        await recordSkippedRun(hostRef, doc.id, action, event)
        continue
      }
      executed += 1
      await executeAction(env, doc.id, action, event, payload)
    }
    /*
     * The org automations, judged by the same filter and conditions a site
     * action is, skipped and recorded the same way, and run on this site.
     */
    for (const doc of runOrg && placed ? placed.docs : []) {
      const automation = doc.data() as OrgAutomation
      const filter = automation.trigger?.filter?.trim()
      if (filter) {
        try {
          if (!evaluateExpression(filter, { event, ...payload })) continue
        } catch {
          continue // A broken filter never fires.
        }
      }
      if (
        !evaluateTriggerConditions(automation.trigger, { event, ...payload })
      ) {
        await recordSkippedRun(hostRef, doc.id, automation, event, 'orgAutomation')
        continue
      }
      executed += 1
      await executeAction(env, doc.id, automation, event, payload, {
        orgAutomation: { orgId: placed?.orgId ?? '' },
      })
    }
    if (executed > 0) {
      await runCounterRef
        .set({ [monthKey]: FieldValue.increment(executed) }, { merge: true })
        .catch(() => undefined)
    }
  } catch (error) {
    console.error('runEventActions failed', hostId, event, error)
  }
  return alerts
}

/**
 * Runs ONE action's server steps (AGL-256): the tenant page runtime
 * evaluates site-event trigger conditions (scroll thresholds, selectors)
 * client-side and dispatches the specific action here — re-matching by
 * event name would wrongly fire sibling actions with different
 * thresholds. Same gates and metering as the event runner.
 */
export async function runSingleAction(
  hostId: string,
  actionId: string,
  event: string,
  payload: HostEventPayload = {},
): Promise<HostActionAlert[]> {
  const alerts: HostActionAlert[] = []
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const doc = await hostRef.collection('actions').doc(actionId).get()
    if (!doc.exists || doc.get('deletedAt') || doc.get('enabled') === false) {
      return alerts
    }
    const action = doc.data() as HostAction
    // Only site-event actions may be dispatched externally — server
    // events flow through their own emitters.
    if (String(action.trigger?.event ?? '') !== String(event)) return alerts
    // Structured payload conditions (AGL-557; AND/OR chaining AGL-565):
    // the single-action dispatch path honors them too, so
    // client-evaluated triggers can't bypass them.
    if (!evaluateTriggerConditions(action.trigger, { event, ...payload })) {
      return alerts
    }

    const monthKey = new Date().toISOString().slice(0, 7)
    const runCounterRef = hostRef.collection('counters').doc('actionRuns')
    let webhooksAllowed = true
    let crmAllowed = true
    // Held for the rest of the run, as in `runEventActions` above.
    const owner = await getOrgForHost(hostId)
    {
      const org = owner?.org
      if (!checkEntitlement(org as any, 'actions')) return alerts
      webhooksAllowed = checkEntitlement(org as any, 'webhooks')
      crmAllowed = checkEntitlement(org as any, 'crm')
      const limit = resolveOrgEntitlements(
        org as any,
      ).actionRunsPerMonth
      const counterSnapshot = await runCounterRef.get()
      const used = Number(counterSnapshot.get(monthKey) ?? 0)
      if (used + 1 > limit) return alerts
    }

    const env: ActionRunEnv = {
      hostId,
      hostRef,
      alerts,
      // Admitted by the `actions` gate above.
      actionsAllowed: true,
      webhooksAllowed,
      crmAllowed,
      depth: 0,
      org: owner?.org ?? null,
      orgId: owner?.orgId ?? null,
      loadWorkflowContext: makeWorkflowContextLoader(hostRef),
    }
    await executeAction(env, doc.id, action, event, payload)
    await runCounterRef
      .set({ [monthKey]: FieldValue.increment(1) }, { merge: true })
      .catch(() => undefined)
  } catch (error) {
    console.error('runSingleAction failed', hostId, actionId, error)
  }
  return alerts
}

/**
 * Ends an enrollment its automation may no longer run, and says why in the
 * run history — the automation was deleted or switched off, or the plan that
 * carried it lapsed. Shared by every kind of enrollment, so "stopped mid-wait"
 * reads the same for an action, a workflow and an org automation.
 */
export async function stopFlowEnrollment(
  enrollment: FlowEnrollment,
  ref: FirebaseFirestore.DocumentReference,
  reason: string,
): Promise<'stopped'> {
  const hostRef = firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(enrollment.hostId)
  await endFlowEnrollment(ref)
  await hostRef
    .collection('activity')
    .add({
      actorId: null,
      actorEmail: null,
      action: `Flow stopped mid-wait: ${reason}`.slice(0, 300),
      result: 'skipped',
      trigger: enrollment.event,
      summary: reason.slice(0, 300),
      target: {
        type:
          enrollment.automation === 'org'
            ? ORG_AUTOMATION_RUN_TARGET
            : 'workflow',
        id: enrollment.actionId,
        name: enrollment.actionName ?? '',
      },
      createdAt: FieldValue.serverTimestamp(),
    })
    .catch(() => undefined)
  return 'stopped'
}

/**
 * Continues one enrollment from where its wait ended.
 *
 * The enrollment carries everything the run needs except the gates: the step
 * list it entered with, the position inside it, the payload the trigger
 * produced, and who it is about. What it deliberately does NOT carry is
 * permission — the `actions` entitlement, the site's lockdown and the
 * action's own enabled flag are all re-asked here, because a flow that waits
 * three days is a flow that can outlive the plan, the site and the merchant's
 * decision to run it.
 */
export async function resumeFlowEnrollment(
  enrollment: FlowEnrollment,
  ref: FirebaseFirestore.DocumentReference,
  options?: { timedOut?: boolean; nowMs?: number },
): Promise<'ran' | 'waiting' | 'exited' | 'deferred' | 'stopped'> {
  const nowMs = options?.nowMs ?? Date.now()
  // A workflow's enrollment continues the workflow, against the workflow's
  // own kill switch and meter; every enrollment without the field is an
  // action's, which is every one written before a workflow could wait.
  if (enrollment.automation === 'workflow') {
    return await resumeWorkflowEnrollment(enrollment, ref, {
      ...options,
      nowMs,
    })
  }
  // An org automation's continues against the ORGANIZATION's document, which
  // is its kill switch — deleted, switched off, taken off this site or paused
  // here all stop it (AGL-3302).
  if (enrollment.automation === 'org') {
    return await resumeOrgAutomationEnrollment(enrollment, ref, {
      ...options,
      nowMs,
    })
  }
  const hostId = enrollment.hostId
  const firestore = firebaseAdmin.app().firestore()
  const hostRef = firestore.collection('hosts').doc(hostId)

  const stop = (reason: string) => stopFlowEnrollment(enrollment, ref, reason)

  const doc = await hostRef
    .collection('actions')
    .doc(enrollment.actionId)
    .get()
    .catch(() => null)
  /*
   * A KILL SWITCH HAS TO KILL, including for the people already inside.
   *
   * Editing a flow leaves an enrollment alone — it runs the snapshot it
   * entered with. DELETING or DISABLING one does not: "off" that keeps mailing
   * the queue for the next three days is not off, and it is the control a
   * merchant reaches for when a flow is doing something wrong. So the two
   * cases are deliberately different, and this is the one that stops.
   */
  if (!doc?.exists || doc.get('deletedAt') || doc.get('enabled') === false) {
    return await stop('the automation was turned off or deleted')
  }
  const action = doc.data() as HostAction
  const owner = await getOrgForHost(hostId).catch(() => null)
  if (!checkEntitlement(owner?.org as any, 'actions')) {
    return await stop('this site’s plan no longer includes automations')
  }

  const env: ActionRunEnv = {
    hostId,
    hostRef,
    alerts: [],
    // Admitted by the `actions` gate above.
    actionsAllowed: true,
    webhooksAllowed: checkEntitlement(owner?.org as any, 'webhooks'),
    crmAllowed: checkEntitlement(owner?.org as any, 'crm'),
    depth: 0,
    org: owner?.org ?? null,
    orgId: owner?.orgId ?? null,
    loadWorkflowContext: makeWorkflowContextLoader(hostRef),
  }

  const payload: HostEventPayload = {
    ...(enrollment.payload ?? {}),
    // The timeout BRANCH. A `waitForEvent` resumes either way, and this is
    // the one field that says which — so the step after it carries a `when`
    // naming it, and the author gets a timeout path with no nested step list.
    ...(options?.timedOut ? { [FLOW_TIMED_OUT_FIELD]: true } : {}),
  }

  const ending = await executeAction(
    env,
    enrollment.actionId,
    action,
    enrollment.event,
    payload,
    {
      startIndex: enrollment.nextStepIndex,
      // An action's enrollment holds only Actions steps: its snapshot is the
      // action's own list.
      steps: enrollment.steps as HostActionStep[],
      enrollmentRef: ref,
    },
  )

  if (ending === 'deferred') {
    /*
     * Pushed a beat down the queue rather than retried immediately: the two
     * refusals that reach here are an hour-long platform ceiling and a
     * day-long per-person window, so retrying in sixty seconds would spend a
     * read to be told the same thing sixty more times.
     */
    await deferFlowEnrollment(ref, nowMs + FLOW_CLAIM_RETRY_MS, nowMs)
    return ending
  }
  if (ending !== 'waiting') await endFlowEnrollment(ref)

  /*
   * COUNTED, NEVER REFUSED.
   *
   * A resume is real work and belongs on the run meter, so the usage card and
   * the COGS rollup see it. It is not GATED on `actionRunsPerMonth` the way a
   * new run is, because the person is already inside the flow: refusing here
   * would abandon somebody half-way through a sequence, which is a capacity
   * limit enforced against a person rather than against the decision that
   * added them. The gate belongs at enrollment, and that is where it is.
   */
  const monthKey = new Date(nowMs).toISOString().slice(0, 7)
  await hostRef
    .collection('counters')
    .doc('actionRuns')
    .set({ [monthKey]: FieldValue.increment(1) }, { merge: true })
    .catch(() => undefined)
  return ending
}

/** How long a deferred enrollment waits before the next attempt. */
export const FLOW_CLAIM_RETRY_MS = 15 * 60_000

/**
 * The job beat's entry point: resume every flow whose wait has ended.
 *
 * Thin on purpose. The scheduling contract — due-ness, the transactional
 * claim, the scan budget, the lockdown skip — is `sweepDueFlowEnrollments`,
 * and the work is `resumeFlowEnrollment`; this is the wire between them, so
 * neither has to import the other's dependencies to be tested.
 */
export async function runDueFlowEnrollments(
  gate: PluginJobHostGate,
  options?: {
    nowMs?: number
    scanBudget?: number
    cursor?: FlowSweepCursor | null
  },
): Promise<FlowSweepResult> {
  return await sweepDueFlowEnrollments(gate, {
    ...(options?.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
    ...(options?.scanBudget !== undefined
      ? { scanBudget: options.scanBudget }
      : {}),
    ...(options?.cursor ? { cursor: options.cursor } : {}),
    resume: async (enrollment, ref) => {
      await resumeFlowEnrollment(enrollment, ref, {
        // Reaching the sweep IS the timeout for a `waitForEvent`: the event
        // it was watching for never arrived before `resumeAtMs`. A plain
        // `wait` has no timeout to report, so the flag rides the presence of
        // an awaited event rather than the fact of being swept.
        timedOut: Boolean(enrollment.awaitingEvent),
        ...(options?.nowMs !== undefined ? { nowMs: options.nowMs } : {}),
      })
    },
  })
}

/**
 * Wakes the flows this person's event was being waited for.
 *
 * NOT A POLL. Nothing here scans the enrolled population asking whose turn it
 * is — the event arrives already naming a person, and the lookup is three
 * equality filters against that person's key. A site with ten thousand people
 * waiting costs the same as one with ten.
 *
 * The COST GUARD is the caller's, and it is why this takes an email rather
 * than reading one: `runEventActions` fires on every page view of every
 * published site, so it asks only for events that name a person. A page view
 * does not, and pays nothing.
 */
async function wakeFlowsAwaitingEvent(
  hostId: string,
  event: string,
  payload: HostEventPayload,
): Promise<void> {
  const email = String((payload as any)?.['email'] ?? '').trim()
  if (!email || !email.includes('@')) return
  const waiting = await findFlowEnrollmentsAwaiting({ hostId, event, email })
  for (const doc of waiting) {
    const claimed = await claimFlowEnrollment(doc.ref).catch(() => null)
    if (!claimed) continue
    try {
      /*
       * The awaited event ARRIVED, so this is not the timeout branch — and
       * the arriving payload joins the carried one, so a step after the wait
       * can read the order total the flow was waiting for.
       */
      await resumeFlowEnrollment(
        {
          ...claimed,
          payload: { ...(claimed.payload ?? {}), ...(payload ?? {}) },
        },
        doc.ref,
        { timedOut: false },
      )
    } catch (error) {
      console.error('[flow] event wake failed', doc.ref.path, error)
      await deferFlowEnrollment(doc.ref, Date.now() + FLOW_CLAIM_RETRY_MS)
    }
  }
}

export default runEventActions

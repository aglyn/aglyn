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
  ACTION_MAX_STEPS,
  ACTIONS_MAX_PER_HOST,
  checkEntitlement,
  consentGroupForHost,
  planLabelGrantingFeature,
  evaluateExpression,
  evaluateStepGuard,
  evaluateTriggerConditions,
  flowSubscriptionTopicId,
  hostPublicOrigin,
  isClientActionStep,
  type HostEventType,
  type HostFunction,
  type HostVariable,
  normalizeTriggerConditions,
  type PluginJobHostGate,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/server'
import {
  isDeferrableSendResult,
  isEmailConfigured,
  sendEmail,
  sendFailureReason,
} from '@aglyn/shared-util-email'
import {
  enrollListMember,
  filterSendableForHost,
  firebaseAdmin,
  flowEmailRefusal,
  getOrgForHost,
  hostDisplayName,
  hostSendingIdentity,
  meterHostEmail,
  notifyHostManagers,
  consentGroupForSite,
  resolveOrgIdForHost,
} from '@aglyn/tenant-data-admin'
import { activitySearchTokens } from '@aglyn/aglyn/app-utils/activity-search'
import { visibleToHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import { triggerFilterProblem } from '@aglyn/aglyn/app-utils/site-interactions'
// The person behind an address, and their filing under a campaign, through
// the plugin that keeps people (AGL-3080): the engine opens none of its
// collections.
import {
  filePluginPersonUnder,
  findPluginPerson,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import {
  findOrgContainersByName,
  readOrgContainers,
  type OrgContainerRecord,
} from '@aglyn/tenant-data-admin/server/org-containers'
// The leaf again, for the phishing screen's hold (AGL-3356): the control
// that stops a send must be the real one under a spec that mocks the barrel.
import { screenOutboundSend } from '@aglyn/tenant-data-admin/server/outbound-send-review'
import { renderSiteTextEmail } from '@aglyn/tenant-data-admin/server/host-email-tokens'
import { createHmac } from 'crypto'
import { FieldValue } from 'firebase-admin/firestore'
import { runSummaryFields } from '../model/run-history'
import {
  ACTION_MAX_EVENT_DEPTH,
  type HostWorkflow,
  type HostWorkflowStep,
  runWorkflow,
  WORKFLOW_MAX_STEPS,
} from '../model/workflows'
import { describeStepOutcome } from '../model/step-outcomes'
import type { HostWebhook } from '../model/webhooks'
import { eventRunSuspension } from './site-suspension'
import { triggeredDocsForEvent } from './triggered-docs'
import { resolveStepEmailMerge, stepEmailMergeContext } from './email-merge'
import {
  recordRuns,
  type RunMeterScope,
  runMonthKey,
  runsUsedThisMonth,
} from './run-meter'
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
// The runtime's leaves rather than its barrel: the engine's specs substitute
// each leaf, and a mock of the barrel would take the rest of it down too.
import type { HostEventPayload } from '@aglyn/tenant-runtime/host-event-listeners'
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
import { runTriggeredByFields } from './run-trigger-actor'
// By path, not the barrel: only a server run asks.
import { pluginServerStepExecutor } from '@aglyn/aglyn/plugin-manager/plugin-server-steps'
import { preparePluginRecordEmail } from '@aglyn/aglyn/plugin-manager/plugin-record-timeline'
import {
  FLOW_TIMED_OUT_FIELD,
  type HostAction,
  type HostActionAlert,
  type HostActionStep,
  type HostActionStepType,
  isFlowSuspendingStep,
  sendEmailIsTransactionalReply,
} from '../model/host-actions'

/**
 * Every live, switched-on action a site holds for an event runs, in
 * document-id order (AGL-3458) — up to the most live actions a site may hold
 * at all, so no matching action is ever left out. See `triggered-docs.ts`.
 */
const MAX_TRIGGERED_ACTIONS = ACTIONS_MAX_PER_HOST

/** The live, switched-on actions a site holds for `event`, in document-id order. */
export function liveActionsForEvent(
  hostRef: FirebaseFirestore.DocumentReference,
  event: string,
): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  return triggeredDocsForEvent(hostRef.collection('actions'), event, {
    keep: (doc) => !doc.get('deletedAt') && doc.get('enabled') !== false,
    max: MAX_TRIGGERED_ACTIONS,
    maxReads: MAX_TRIGGERED_ACTIONS * 4,
  })
}

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
  depth: number
  /**
   * The owning org's billing doc, already read by the entitlement gate that
   * admitted this run, and the org's id beside it.
   *
   * Carried rather than re-read: both entry points resolve `getOrgForHost`
   * before they build this, so a step that gates on the plan — another
   * plugin's step, handed both — costs no extra org read.
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
 * Raises an event a step's write earned — a stage an automation set IS a
 * stage change, and whatever listens for one must hear it.
 *
 * Fanned out here, one level deeper under the same depth guard a
 * `customEvent` chain runs under, rather than through `emitHostEvent`, which
 * starts every chain at depth zero and would let an automation that causes
 * the event it listens for run forever. Workflows take the guard too.
 */
async function raiseEarnedEvent(
  env: ActionRunEnv,
  emit: { event: string; payload: Record<string, unknown> },
): Promise<void> {
  const payload = emit.payload as HostEventPayload
  const [fromWorkflows, fromActions] = await Promise.all([
    // A step names any event a listener may hear: a declared one or a custom one.
    runEventWorkflows(env.hostId, emit.event as HostEventType, payload, env.depth + 1),
    runEventActions(env.hostId, emit.event, payload, env.depth + 1),
  ])
  env.alerts.push(...fromActions, ...fromWorkflows)
}

/**
 * Runs ONE Actions step on the server: the executor every automation shares.
 *
 * An action's step list runs through it one step at a time, and so does
 * every Actions step inside a workflow — so the two engines cannot disagree
 * about what `sendEmail` or `webhookPost` does, what a step is gated on, or
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
   * The one fact worth carrying into the summary — the webhook's status, or
   * whatever a plugin's step answers. Set by the branch that knows it.
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
        !hook.url
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
      //
      // The hook's URL is tenant-typed and the step runs on any visitor's
      // form submission, so it goes out through the configured-URL fetch
      // (AGL-3363), never a bare `fetch`: https only, the name resolved to
      // PUBLIC addresses with the socket pinned to the one checked, and no
      // redirect followed — a 3xx is a failed delivery. That is what refuses
      // `[::1]`, `[::ffff:127.0.0.1]`, a decimal `2130706433`, a name that
      // resolves inward, and a public host answering `302` to the metadata
      // endpoint, none of which a pattern over the URL text can see.
      //
      // Loaded here, not at the top: see `webhook-delivery.ts`.
      const { describeConfiguredUrlRefusal, fetchConfiguredPublicUrl } =
        await import('./webhook-delivery')
      let delivered = false
      let lastStatus: number | undefined
      for (let attempt = 0; attempt < 3 && !delivered; attempt += 1) {
        try {
          const result = await fetchConfiguredPublicUrl(hook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(signature && { 'X-Aglyn-Signature': signature }),
            },
            body,
            signal: AbortSignal.timeout(5000),
          })
          if ('refusal' in result) {
            // A refusal is the URL's, not the network's: retrying it would
            // only re-resolve the same answer.
            return failed(
              `webhook "${step.webhookName || step.webhookId}" refused: ${describeConfiguredUrlRefusal(result.refusal)}`,
            )
          }
          lastStatus = result.status
          delivered = result.status >= 200 && result.status < 300
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
      const hostData =
        ((await hostRef.get().catch(() => null))?.data() as
          | Record<string, unknown>
          | undefined) ?? null
      const siteBase = hostPublicOrigin(hostData as never) ?? ''
      /*
       * MARKETING, unless it is a transactional reply (below). The subject
       * and body are merchant-authored and the recipient comes out of the
       * event payload — which, for the collect route, is a write triggered
       * by an anonymous visitor. So a step that is not a reply is a site
       * mailing an address on the merchant's say-so, and it owes what every
       * other such message owes: the unsubscribe header pair and a visible
       * link, both suppression lists, and a share of the ceiling on how much
       * one person receives from this site.
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
       * A TRANSACTIONAL REPLY (AGL-3458) — the answer to what the recipient
       * just did: the run started on their own form submission, booking or
       * sign-up, this step runs at once, names no topic, and goes to the
       * address the event carries. Such a message is not a mailing, so it
       * leaves with no unsubscribe header and no unsubscribe link, and asks
       * no marketing-consent question — the reply the Inbox sends to a
       * submission is the same kind of message, and CAN-SPAM exempts both.
       * What it keeps is the suppression check below: a hard bounce, a spam
       * complaint or a person who asked this site to stop is not mailed by
       * anything. The author can switch a qualifying step back to a mailing
       * (`transactional: false`); a step that does not qualify is a mailing
       * whatever it says.
       */
      const transactional = sendEmailIsTransactionalReply(step, {
        event,
        afterWait: Boolean(enrollmentRef),
      })
      /*
       * The stream this message belongs to, resolved ONCE and read twice:
       * the gate below filters on it, and it rides the `marketing` context
       * so the opt-out link the seam mints names it. Without that the
       * preference page opens on a list of every stream the site has, and
       * the recipient has to find the one they were trying to leave.
       */
      const topicId = flowSubscriptionTopicId(step.topicId, scope)
      const consentGroup = consentGroupForHost(
        (env.org as Record<string, unknown> | null) ?? null,
        hostId,
      )
      if (transactional) {
        // Both suppression lists — the platform's bounces and complaints, and
        // this site's (and its consent group's) opt-outs — fail CLOSED.
        const sendable = await filterSendableForHost(hostId, [to], undefined, consentGroup)
        if (!sendable.length) return failed('the recipient is unsubscribed or suppressed')
      } else {
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
      }
      /*
       * THE WORDS AS AUTHORED, and as sent (AGL-3458). The merge tags — the
       * campaign's `{{firstName|there}}` and the CRM's `{{contact.firstName}}`
       * — are filled from the contact or the lead the run is about, else from
       * the name and address the event carried. The phishing screen below
       * reads the AUTHORED words: it judges what the business wrote, once per
       * automation, not one copy per recipient.
       */
      const authoredSubject = String(step.subject ?? '').slice(0, 200)
      const authoredText = String(step.body ?? '').slice(0, 5000)
      const mergeContext = await stepEmailMergeContext({
        hostId,
        email: String(payload['email'] ?? '').trim() || to,
        contactGroupId: consentGroup.groupId,
        siteName: hostDisplayName(hostData ?? undefined, hostId),
      })
      const mergePerson = {
        email: to,
        name: String(payload['name'] ?? payload['fullName'] ?? '').trim(),
      }
      const emailSubject = resolveStepEmailMerge(authoredSubject, mergeContext, mergePerson)
        .text.replace(/[\r\n]+/g, ' ')
        .slice(0, 200)
      const emailText = resolveStepEmailMerge(authoredText, mergeContext, mergePerson).text.slice(
        0,
        5000,
      )
      /*
       * THE PHISHING SCREEN, for a workspace in its first fortnight
       * (AGL-3356). The incident's second message was exactly this step: a
       * `contactCreated` workflow mailing "Poshmark Order … has finally
       * sold" with a link to a Poshmark lookalike, once per imported contact.
       *
       * A hold files one review row per (automation, content) in the abuse
       * queue and stops the message. After a wait the step DEFERS, so the
       * enrollment sends the same step once staff release it; an immediate
       * step has no later beat to come back on, so this run records the hold
       * as its failure and the automation sends again from its next event
       * once released. See `outbound-send-review.ts`.
       */
      const screened = await screenOutboundSend({
        kind: run.kind,
        path:
          run.kind === 'orgAutomation'
            ? `orgs/${run.orgId ?? env.orgId ?? ''}/automations/${run.id}`
            : `hosts/${hostId}/${run.kind === 'workflow' ? 'workflows' : 'actions'}/${run.id}`,
        hostId,
        orgId: env.orgId,
        org: (env.org as Record<string, unknown> | null) ?? null,
        host: hostData,
        subject: authoredSubject,
        bodies: [authoredText],
      })
      if (screened.outcome === 'rejected') {
        return failed(
          `this email was rejected by staff review (${screened.reference})`,
        )
      }
      if (screened.outcome === 'held') {
        if (enrollmentRef) return { kind: 'deferred' }
        return failed(
          'this email is held for staff review because it may impersonate ' +
            `another business (${screened.reference})`,
        )
      }
      /*
       * THE TIMELINE ENTRY (AGL-2615). A message addressed to the person the
       * event is about is filed on that person's timeline — the same entry a
       * member's own send files — so an automated welcome shows beside the
       * calls a rep made, with its delivery state. Whether the message earns
       * an entry, and where, is the record system's to say: it is offered
       * the message first, because the entry's tags have to ride the message
       * for the delivery webhook to find it, and files it only after the
       * provider accepted. No record system, or a message that earns no
       * entry, sends untagged.
       */
      const recordEmail = env.orgId
        ? await preparePluginRecordEmail({
            orgId: env.orgId,
            hostId,
            to,
            link: {
              ...(String(payload['contactId'] ?? '').trim()
                ? { contactId: String(payload['contactId']).trim() }
                : {}),
              ...(String(payload['email'] ?? '').trim()
                ? { email: String(payload['email']).trim() }
                : {}),
            },
            org: env.org,
          })
        : null
      // In the site's header and footer (AGL-3370): a workflow's email is the
      // site writing to its contact, in words the site owner typed.
      const framed = await renderSiteTextEmail(
        firebaseAdmin.app().firestore(),
        hostId,
        'workflow-email',
        { subject: emailSubject, text: emailText },
      ).catch(() => null)
      const result = await sendEmail({
        to,
        subject: emailSubject,
        text: framed?.text || emailText,
        ...(framed?.html ? { html: framed.html } : {}),
        sendingIdentity: await hostSendingIdentity(hostId),
        ...(recordEmail ? { tags: [...recordEmail.tags] } : {}),
        audience: 'tenant',
        context: enrollmentRef ? 'flow step' : 'event action',
        // A step staff released above carries its release to the send
        // seam's screen, which would otherwise hold the same signals again.
        releasedReviewId:
          screened.outcome === 'send' ? (screened.releasedReviewId ?? null) : null,
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
        // every reader of it treats as absent — see `flowSubscriptionTopicId`.
        // The consent group comes off the org the run already holds, so the
        // gate honors an unsubscribe from any site of a declared group —
        // the sender this site mails as — and the org's confirmation switch,
        // at no extra read. A transactional reply is not marketing and
        // carries none of it: no `List-Unsubscribe`, no opt-out line.
        ...(transactional
          ? {}
          : {
              marketing: {
                hostId,
                siteBase,
                topicId,
                consentHostIds: consentGroup.hostIds,
                consentAwaitsConfirmation: consentGroup.awaitsConfirmation,
              },
            }),
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
            : refusal === 'held-for-review'
              ? 'this email is held for staff review because it may ' +
                'impersonate another business'
              : 'email delivery failed'
        : null
      // Cost meter (AGL-1438). A workflow notification is transactional:
      // counted, never capped. `sent` is false when Resend refused or the
      // environment is unconfigured, and an email that never left is not a
      // cost.
      if (result.sent) {
        await meterHostEmail(hostId)
        await recordEmail?.file({
          subject: emailSubject,
          body: emailText,
          to,
          sourceRef: run.id,
        })
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
      // it cannot see, even to tag it onto a campaign. Asked of the plugin
      // that keeps people (AGL-3080), whose lookup answers an address a
      // merge folded into another record (AGL-2633) with the person who now
      // holds it.
      const contact = await findPluginPerson({ hostId, email, onlyVisibleToSite: true })
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
      // The org's containers of the `campaign` kind, read where the kind's
      // declaration says they are stored.
      const containerStore = firebaseAdmin.app().firestore()
      const usable = (container: OrgContainerRecord | undefined) =>
        Boolean(container?.live && visibleToHost(container.visibleTo, hostId))
      const namedId = step.campaignId?.trim() ?? ''
      const campaign = namedId
        ? (await readOrgContainers(containerStore, 'campaign', campaignOrgId, [namedId]))[0]
        : (
            await findOrgContainersByName(
              containerStore,
              'campaign',
              campaignOrgId,
              step.campaignName?.trim() ?? '',
              10,
            )
          ).find(usable)
      if (!campaign?.exists) {
        return failed(`unknown campaign "${campaignLabel}"`)
      }
      if (!campaign.live) {
        return failed(`campaign "${campaignLabel}" was deleted`)
      }
      if (!usable(campaign)) {
        return failed(`campaign "${campaignLabel}" is not placed on this site`)
      }
      /*
       * Filed by the plugin that keeps people, as THIS SITE holds them
       * (AGL-3080): which campaigns a merchant has filed somebody under is
       * that merchant's business record, on the same footing as their notes
       * and their tags, and where it lives on the person is the owner's to
       * know. A person the owner no longer finds for the site is not filed.
       */
      const filed = await filePluginPersonUnder({
        hostId,
        orgId: campaignOrgId,
        record: { kind: contact.kind, id: contact.id },
        containerKind: 'campaign',
        ids: [campaign.id],
      })
      if (!filed?.filed) return failed(`no contact for ${email}`)
    } else {
      /*
       * A STEP ANOTHER PLUGIN RUNS: one that writes that plugin's records,
       * handed to the executor it registered (`plugin-server-steps`). The
       * guard, the order, the history and the nesting cap stay here; the
       * write is the owner's. A declared step whose executor is missing
       * throws, and is this step's failure. A type nobody runs answers
       * `null` and reads as done, as an unknown type always has.
       */
      const executor = await pluginServerStepExecutor(step.type)
      if (executor) {
        const answer = await executor.run({
          hostId,
          org: env.org,
          orgId: env.orgId,
          run: { kind: run.kind, id: run.id, name: run.name },
          event,
          payload: payload as Record<string, unknown>,
          step: step as { type: string; [field: string]: unknown },
        })
        if (answer.error) return failed(answer.error)
        detail = answer.detail
        if (answer.emit) await raiseEarnedEvent(env, answer.emit)
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
      // Who set this run off (AGL-3376).
      ...runTriggeredByFields(),
      // The prose line stays exactly as it was: `activityPrimaryText` and
      // three other renderers read it, and the run table is not the only
      // thing this collection feeds.
      action: summary,
      // The structured half (AGL-2171) — the two columns the advertised
      // run-history table could not otherwise fill.
      result: stepErrors.length ? 'failed' : 'succeeded',
      trigger: event,
      // The summary and its search tokens, written together (AGL-3321).
      ...runSummaryFields(
        (outcomes.length ? outcomes.join(' · ') : 'Ran').slice(0, 300),
      ),
      target: {
        // An org automation's run is filed under its own type, so the site's
        // run history can tell it from a site action sharing the feed.
        type: orgRun ? ORG_AUTOMATION_RUN_TARGET : 'workflow',
        id: actionId,
        name: action.name ?? '',
      },
      // The site log's search finds a run by its action's name (AGL-3321).
      searchTokens: activitySearchTokens({ target: { name: action.name } }),
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
export const SKIP_LOG_EXCLUDED_EVENTS: ReadonlySet<string> = new Set(['pageView'])

/**
 * Whether an action's unmet conditions only say it is ANOTHER FORM'S
 * (AGL-3458) — the case that is noise rather than an answer.
 *
 * A site with one auto-reply per form keyed on `formId equals …` would write
 * a `Skipped` row for every other form's reply on every submission: eight
 * rows a fill on a nine-form site, burying the one row that explains a real
 * miss. A form picked by id cannot be mistyped, so its mismatch against a
 * submission that names a DIFFERENT form says only "not this form", and it
 * is not recorded. Every other unmet condition still is: a hand-typed
 * `formName`, a field condition, a submission that names no form at all.
 *
 * With `and`, one such clause is the whole answer; with `or`, only when every
 * clause is about which form it was — `formId` or `formName` equals — since
 * any other clause could have been the one that was meant to match.
 */
export function conditionsNameAnotherForm(
  trigger: HostAction['trigger'] | null | undefined,
  payload: HostEventPayload,
): boolean {
  const submitted = String(payload['formId'] ?? '').trim()
  if (!submitted) return false
  const clauses = normalizeTriggerConditions(trigger)
  const another = (clause: { field?: string; op?: string; value?: string }) =>
    clause.field?.trim() === 'formId' &&
    clause.op === 'equals' &&
    Boolean(clause.value?.trim()) &&
    clause.value?.trim() !== submitted
  if (trigger?.combinator === 'or') {
    return (
      clauses.some(another) &&
      clauses.every(
        (clause) =>
          clause.op === 'equals' && ['formId', 'formName'].includes(clause.field?.trim() ?? ''),
      )
    )
  }
  return clauses.some(another)
}

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
  /** What stopped it, when it was not an unmet condition. */
  because?: string,
): Promise<void> {
  if (SKIP_LOG_EXCLUDED_EVENTS.has(event)) return
  // `normalizeTriggerConditions`, not `trigger.conditions` — a pre-AGL-565
  // action carries a single `condition` and reading only the array would
  // give every one of them the nameless fallback.
  const named = normalizeTriggerConditions(action.trigger)
    .map((condition) => String(condition?.field ?? '').trim())
    .filter(Boolean)
  const reason =
    because ??
    (named.length
      ? `Condition on ${named.slice(0, 3).join(', ')} not met`
      : 'Trigger condition not met')
  await hostRef
    .collection('activity')
    .add({
      actorId: null,
      actorEmail: null,
      // Who set this run off (AGL-3376).
      ...runTriggeredByFields(),
      action: `${kind === 'orgAutomation' ? 'Org automation' : 'Action'} skipped on ${event}`,
      result: 'skipped',
      trigger: event,
      ...runSummaryFields(reason.slice(0, 300)),
      target: {
        type: kind === 'orgAutomation' ? ORG_AUTOMATION_RUN_TARGET : 'workflow',
        id: actionId,
        name: action.name ?? '',
      },
      searchTokens: activitySearchTokens({ target: { name: action.name } }),
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
    const actions = await liveActionsForEvent(hostRef, event)
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

    // Webhook steps take the higher `webhooks` gate (AGL-149); plan gates
    // ride the owning org's doc (AGL-238).
    let webhooksAllowed = true
    /*
     * Whether each half fits under the month's allowance — all or nothing per
     * half, as the site's own actions always were.
     *
     * The site's actions are asked first and on exactly the question they
     * were always asked, so an organization placing automations on a site can
     * never be what stops that site's own actions running. The org half is
     * asked second, against what is left after the site's half, and both
     * count on this site's meter: an org automation's run is this site's
     * run, and the usage card, the usage alerts and the COGS rollup read it
     * there.
     */
    let runSite = false
    let runOrg = false
    // Plan-less orgs resolve as free (AGL-247) — gates always run. Held for
    // the rest of the run so a step's own plan check costs no second read.
    const owner = await getOrgForHost(hostId)
    // The band is the WORKSPACE's (AGL-3472): every site's runs count
    // against it, read off the org's counter — see `run-meter.ts`.
    const meter: RunMeterScope = {
      firestore,
      hostRef,
      orgId: owner?.orgId,
      counter: 'actionRuns',
      month: runMonthKey(),
    }
    // A suspended site runs nothing (AGL-3356): see `eventRunSuspension`.
    if (await eventRunSuspension(hostRef, owner?.org)) return alerts
    {
      const org = owner?.org
      if (!checkEntitlement(org as any, 'actions')) return alerts
      webhooksAllowed = checkEntitlement(org as any, 'webhooks')
      const limit = resolveOrgEntitlements(
        org as any,
      ).actionRunsPerMonth
      const used = await runsUsedThisMonth(meter)
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
        const unrunnable = triggerFilterProblem(filter)
        if (unrunnable) {
          await recordSkippedRun(hostRef, doc.id, action, event, 'action', unrunnable)
          continue
        }
        try {
          if (!evaluateExpression(filter, { event, ...payload })) continue
        } catch {
          continue // A field the filter names is not on this event.
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
        if (!conditionsNameAnotherForm(action.trigger, payload)) {
          await recordSkippedRun(hostRef, doc.id, action, event)
        }
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
        const unrunnable = triggerFilterProblem(filter)
        if (unrunnable) {
          await recordSkippedRun(hostRef, doc.id, automation, event, 'orgAutomation', unrunnable)
          continue
        }
        try {
          if (!evaluateExpression(filter, { event, ...payload })) continue
        } catch {
          continue // A field the filter names is not on this event.
        }
      }
      if (
        !evaluateTriggerConditions(automation.trigger, { event, ...payload })
      ) {
        if (!conditionsNameAnotherForm(automation.trigger, payload)) {
          await recordSkippedRun(hostRef, doc.id, automation, event, 'orgAutomation')
        }
        continue
      }
      executed += 1
      await executeAction(env, doc.id, automation, event, payload, {
        orgAutomation: { orgId: placed?.orgId ?? '' },
      })
    }
    await recordRuns({ ...meter, count: executed })
  } catch (error) {
    console.error('runEventActions failed', hostId, event, error)
  }
  return alerts
}

/**
 * Why a dispatched action ran nothing (AGL-3309).
 *
 * A page's dispatch has nobody to tell: a visitor's scroll is not answered
 * with "the plan lapsed", so for it every refusal is the same empty list of
 * alerts. The console's test run does have somebody to tell, and a test that
 * ran nothing must not read as one that ran.
 */
export type SingleActionSkip =
  // No such action, or it was deleted.
  | 'missing'
  // Switched off.
  | 'disabled'
  // The dispatch named an event other than the action's trigger.
  | 'event'
  // The trigger's conditions are not met by the payload.
  | 'conditions'
  // The site's plan does not carry the `actions` feature.
  | 'plan'
  // The month's action runs are spent.
  | 'allowance'
  // A read before the first step threw; it was logged. Steps never throw
  // (`runServerStep` records a throw as a failed step), so nothing ran.
  | 'failed'

/** What one dispatched action did, for a caller that has to say so. */
export interface SingleActionOutcome {
  /** Its steps ran, and the run counted on the site's and workspace's meters. */
  ran: boolean
  /** Why nothing ran; `null` when it ran. */
  skipped: SingleActionSkip | null
  /** The site alerts its steps produced. */
  alerts: HostActionAlert[]
  /** The month's allowance, when the allowance is what refused. */
  limit?: number
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
  return (await runSingleActionOutcome(hostId, actionId, event, payload)).alerts
}

/**
 * {@link runSingleAction}, answering what it did as well as the alerts: whether
 * the steps ran and, when they did not, which gate stopped them.
 *
 * One body for both, so the console's test run meets exactly the gates a
 * page's dispatch meets — the switch, the event, the conditions, the plan and
 * the month's allowance — and is metered and recorded the same way.
 */
export async function runSingleActionOutcome(
  hostId: string,
  actionId: string,
  event: string,
  payload: HostEventPayload = {},
): Promise<SingleActionOutcome> {
  const alerts: HostActionAlert[] = []
  const skipped = (
    reason: SingleActionSkip,
    limit?: number,
  ): SingleActionOutcome => ({
    ran: false,
    skipped: reason,
    alerts,
    ...(limit === undefined ? {} : { limit }),
  })
  try {
    const firestore = firebaseAdmin.app().firestore()
    const hostRef = firestore.collection('hosts').doc(hostId)
    const doc = await hostRef.collection('actions').doc(actionId).get()
    if (!doc.exists || doc.get('deletedAt')) return skipped('missing')
    if (doc.get('enabled') === false) return skipped('disabled')
    const action = doc.data() as HostAction
    // Only site-event actions may be dispatched externally — server
    // events flow through their own emitters.
    if (String(action.trigger?.event ?? '') !== String(event)) {
      return skipped('event')
    }
    // Structured payload conditions (AGL-557; AND/OR chaining AGL-565):
    // the single-action dispatch path honors them too, so
    // client-evaluated triggers can't bypass them.
    if (!evaluateTriggerConditions(action.trigger, { event, ...payload })) {
      return skipped('conditions')
    }

    let webhooksAllowed = true
    // Held for the rest of the run, as in `runEventActions` above.
    const owner = await getOrgForHost(hostId)
    // The workspace's band, as in `runEventActions` above (AGL-3472).
    const meter: RunMeterScope = {
      firestore,
      hostRef,
      orgId: owner?.orgId,
      counter: 'actionRuns',
      month: runMonthKey(),
    }
    {
      const org = owner?.org
      if (!checkEntitlement(org as any, 'actions')) return skipped('plan')
      webhooksAllowed = checkEntitlement(org as any, 'webhooks')
      const limit = resolveOrgEntitlements(
        org as any,
      ).actionRunsPerMonth
      const used = await runsUsedThisMonth(meter)
      if (used + 1 > limit) return skipped('allowance', limit)
    }

    const env: ActionRunEnv = {
      hostId,
      hostRef,
      alerts,
      // Admitted by the `actions` gate above.
      actionsAllowed: true,
      webhooksAllowed,
      depth: 0,
      org: owner?.org ?? null,
      orgId: owner?.orgId ?? null,
      loadWorkflowContext: makeWorkflowContextLoader(hostRef),
    }
    await executeAction(env, doc.id, action, event, payload)
    await recordRuns({ ...meter, count: 1 })
    return { ran: true, skipped: null, alerts }
  } catch (error) {
    console.error('runSingleAction failed', hostId, actionId, error)
    return skipped('failed')
  }
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
      // Who set this run off (AGL-3376).
      ...runTriggeredByFields(),
      action: `Flow stopped mid-wait: ${reason}`.slice(0, 300),
      result: 'skipped',
      trigger: enrollment.event,
      ...runSummaryFields(reason.slice(0, 300)),
      target: {
        type:
          enrollment.automation === 'org'
            ? ORG_AUTOMATION_RUN_TARGET
            : 'workflow',
        id: enrollment.actionId,
        name: enrollment.actionName ?? '',
      },
      searchTokens: activitySearchTokens({ target: { name: enrollment.actionName } }),
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
  await recordRuns({
    firestore,
    hostRef,
    orgId: owner?.orgId,
    counter: 'actionRuns',
    month: runMonthKey(nowMs),
    count: 1,
  })
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

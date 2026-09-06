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
  evaluateHostFunction,
  type HostFunction,
} from './functions'
import type { HostVariable } from './variables'

/**
 * Workflows (Workflow Builder, AGL-101): named pipelines of host-function
 * calls. Each step evaluates its argument expressions over host variables
 * and previous step results, runs the function through the safe evaluator,
 * and stores the result under its name for later steps. Pure and bounded —
 * no I/O, no loops. Site-event triggers arrive in v2.
 */

/**
 * Host events a workflow can trigger on (AGL-128). The tenant emits these
 * server-side: form submit API, analytics collector, membership APIs.
 *
 * SERVER DOORS ONLY. An event exists because a request handler that already
 * performed the write called `emitHostEvent` beside it; nothing watches the
 * database. So a contact created by a console user's client-direct Firestore
 * write fires nothing, and a CRM event (AGL-2605) is only as complete as the
 * set of server paths that emit it — the capture doors for `contactCreated`,
 * the `crm/contact-stage` route for `contactStageChanged`.
 */
export const HOST_EVENT_TYPES = [
  'formSubmission',
  'pageView',
  'memberSignUp',
  'memberSignIn',
  'memberSignOut',
  'lead',
  'booking',
  // A CRM task was marked done (AGL-2599). Emitted by the console's
  // `crm/task-complete` route rather than by a Firestore trigger, so the
  // payload names who completed it and what it hung off.
  'taskCompleted',
  'contactCreated',
  'contactStageChanged',
  'dealStageChanged',
  'dealWon',
  'dealLost',
] as const

export type HostEventType = (typeof HOST_EVENT_TYPES)[number]

/**
 * How a built-in event reads in a trigger picker and a run history row.
 *
 * `Partial`, deliberately. The event list grows a line at a time from
 * several hands, and an exhaustive record would make every addition a
 * compile error until its label landed in the same change — which is the
 * right pressure on a stage picker and the wrong one here, where two
 * branches adding events beside each other must merge cleanly. An unlabeled
 * event falls back to its identifier through {@link hostEventLabel}, which
 * is what every picker rendered for every event until AGL-2605.
 */
export const HOST_EVENT_LABELS: Partial<Record<HostEventType, string>> = {
  formSubmission: 'Form submitted',
  pageView: 'Page viewed',
  memberSignUp: 'Member signed up',
  memberSignIn: 'Member signed in',
  memberSignOut: 'Member signed out',
  lead: 'New lead',
  booking: 'New booking',
  contactCreated: 'Contact created',
  contactStageChanged: 'Contact changed stage',
  taskCompleted: 'CRM task completed',
  dealStageChanged: 'Deal moved',
  dealWon: 'Deal won',
  dealLost: 'Deal lost',
}

/**
 * `formSubmission` → `Form submitted`; a custom event keeps its own name,
 * because the author chose it and it is already the word they think in.
 */
export function hostEventLabel(event: string | undefined | null): string {
  const key = String(event ?? '').trim()
  if (!key) return 'Event'
  return HOST_EVENT_LABELS[key as HostEventType] ?? key
}

/**
 * The payload keys each built-in event puts in scope, for the filter
 * expression and the step conditions — the thing an author has to know to
 * write `lifecycleStage == "customer"` and had nowhere to read.
 *
 * Documented from the emitters, not from a schema, because the payload is
 * whatever the emitting door passed: `formSubmission` carries every
 * submitted field under its own name on top of the two fixed keys, which
 * no fixed list can enumerate. `Partial` for the same reason as the labels.
 */
export const HOST_EVENT_PAYLOAD_KEYS: Partial<
  Record<HostEventType, readonly string[]>
> = {
  formSubmission: ['formName', 'path', 'and every submitted field by name'],
  pageView: ['path'],
  memberSignUp: ['email'],
  memberSignIn: ['email'],
  lead: ['email', 'source', 'leadId'],
  booking: ['serviceName', 'email', 'startsAtMs'],
  contactCreated: [
    'contactId',
    'email',
    'name',
    'source',
    'hostId',
    'lifecycleStage',
    'campaignIds',
    // Present only when the capture came through a form (AGL-2626), so
    // `formId` equals a form's id is the condition that picks that
    // form's people out of every other door's.
    'formId',
  ],
  contactStageChanged: ['contactId', 'email', 'lifecycleStage', 'previousStage'],
  taskCompleted: [
    'taskId',
    'title',
    'kind',
    'priority',
    'dueAtMs',
    'completedAtMs',
    'completedByUid',
    'assigneeUid',
    'createdByUid',
    'contactId',
    'companyId',
    'dealId',
    'taskHostId',
  ],
  dealStageChanged: [
    'dealId',
    'title',
    'amountCents',
    'currency',
    'stageId',
    'previousStageId',
    'ownerUid',
    'contactId',
    'companyId',
  ],
  dealWon: [
    'dealId',
    'title',
    'amountCents',
    'currency',
    'stageId',
    'previousStageId',
    'ownerUid',
    'contactId',
    'companyId',
  ],
  dealLost: [
    'dealId',
    'title',
    'amountCents',
    'currency',
    'stageId',
    'previousStageId',
    'ownerUid',
    'contactId',
    'companyId',
    'lostReason',
  ],
}

/**
 * One sentence naming what a trigger's filter and conditions can read, or
 * `null` for an event whose payload is not documented — a custom event, or
 * a built-in one nobody has written down yet.
 */
export function hostEventPayloadHint(
  event: string | undefined | null,
): string | null {
  const keys = HOST_EVENT_PAYLOAD_KEYS[String(event ?? '') as HostEventType]
  if (!keys?.length) return null
  return `In scope: ${keys.join(', ')}.`
}

export interface HostWorkflowTrigger {
  event: HostEventType
  /**
   * Optional expression over the event payload (plus variables); the
   * workflow only runs when it evaluates truthy (e.g. `path == "/pricing"`).
   */
  filter?: string
}

export interface HostWorkflowStep {
  /**
   * Host function to run — by doc id (AGL-261), rename-safe. Steps saved
   * before AGL-261 carry only `functionName`; executors resolve id first.
   */
  functionId?: string
  /** Legacy name reference, kept as the display hint; `functionId` wins. */
  functionName: string
  /**
   * One expression per function parameter, evaluated over variables and
   * previous step results (e.g. `price * qty`, `step1 + 10`).
   */
  args: string[]
  /** Scope name the step's result binds to; defaults to `step<N>`. */
  resultName?: string
}

/** `hosts/{hostId}/workflows/{id}` doc. */
export interface HostWorkflow {
  name: string
  steps: HostWorkflowStep[]
  /** Scope name whose final value the workflow returns. */
  returnValue?: string
  /** Event trigger (AGL-128); absent means manual/embedded use only. */
  trigger?: HostWorkflowTrigger | null
}

export const WORKFLOW_MAX_STEPS = 25
/** Max nesting across workflow→function→workflow cross-calls (AGL-129). */
export const CROSS_MAX_DEPTH = 3

export type WorkflowRunResult =
  | {
      ok: true
      value: number | string | boolean
      results: Record<string, number | string | boolean>
    }
  | { ok: false; error: string; step?: number }

/** Variable values as a typed expression scope (mirrors resolveBindings). */
function variableScope(
  variables: Record<string, HostVariable>,
): Record<string, number | string | boolean> {
  const scope: Record<string, number | string | boolean> = {}
  for (const [name, variable] of Object.entries(variables)) {
    if (variable.type === 'number') scope[name] = Number(variable.value ?? 0)
    else if (variable.type === 'boolean') scope[name] = variable.value === 'true'
    else scope[name] = variable.value ?? ''
  }
  return scope
}

export interface WorkflowRunContext {
  /** All host workflows by name, enabling function→workflow calls. */
  workflows?: Record<string, HostWorkflow>
  /** Cross-call nesting depth; internal — callers omit it. */
  depth?: number
}

export function runWorkflow(
  workflow: HostWorkflow,
  functions: Record<string, HostFunction>,
  variables: Record<string, HostVariable> = {},
  /**
   * Extra scope entries seeded ahead of the steps — event payloads (path,
   * formName, field values) land here (AGL-128). Wins over variables.
   */
  extraScope: Record<string, number | string | boolean> = {},
  context: WorkflowRunContext = {},
): WorkflowRunResult {
  const steps = workflow.steps ?? []
  if (steps.length > WORKFLOW_MAX_STEPS) {
    return { ok: false, error: `Workflows are capped at ${WORKFLOW_MAX_STEPS} steps` }
  }
  const depth = context.depth ?? 0
  if (depth > CROSS_MAX_DEPTH) {
    return { ok: false, error: 'Workflow nesting is too deep' }
  }
  // Function steps may call other workflows (AGL-129); every hop shares
  // this depth guard so mutual recursion terminates.
  const invokeWorkflow = (
    name: string,
    callScope: Record<string, number | string | boolean>,
  ): number | string | boolean => {
    const nested = context.workflows?.[name?.trim()]
    if (!nested) throw new Error(`Unknown workflow "${name}"`)
    const run = runWorkflow(nested, functions, variables, callScope, {
      ...context,
      depth: depth + 1,
    })
    if (run.ok === false) throw new Error(run.error)
    return run.value
  }
  const scope = { ...variableScope(variables), ...extraScope }
  const results: Record<string, number | string | boolean> = {}

  for (const [index, step] of steps.entries()) {
    // Id-first resolution (AGL-261): maps are double-keyed by id and name.
    const definition =
      functions[step.functionId?.trim() ?? ''] ??
      functions[step.functionName?.trim() ?? '']
    if (!definition) {
      return {
        ok: false,
        error: `Unknown function "${step.functionName || step.functionId}"`,
        step: index + 1,
      }
    }
    const args: Record<string, unknown> = {}
    try {
      definition.parameters?.forEach((parameter, parameterIndex) => {
        const expression = step.args?.[parameterIndex]
        if (expression != null && String(expression).trim() !== '') {
          args[parameter.name] = evaluateExpression(String(expression), scope)
        }
      })
    } catch (error) {
      return {
        ok: false,
        error: `Step ${index + 1}: ${(error as Error).message}`,
        step: index + 1,
      }
    }
    const run = evaluateHostFunction(
      definition,
      args,
      context.workflows ? { invokeWorkflow } : undefined,
    )
    // `=== false` (not `!run.ok`): the union fails to narrow under the
    // stricter lib build tsconfig otherwise (same quirk as publish.ts).
    if (run.ok === false) {
      return {
        ok: false,
        error: `Step ${index + 1} (${definition.name}): ${run.error}`,
        step: index + 1,
      }
    }
    const resultName = step.resultName?.trim() || `step${index + 1}`
    scope[resultName] = run.value
    results[resultName] = run.value
  }

  const returnName = workflow.returnValue?.trim()
  const value =
    returnName && returnName in scope
      ? scope[returnName]
      : (Object.values(results).at(-1) ?? '')
  return { ok: true, value, results }
}

/**
 * Computed variables (AGL-129): a variable with `workflowName` takes the
 * named workflow's result as its value at compose time; failures keep the
 * stored fallback value. Each computed variable evaluates once, bounded
 * by the shared depth guard.
 */
export function resolveComputedVariables(
  variables: Record<string, HostVariable>,
  functions: Record<string, HostFunction>,
  workflows: Record<string, HostWorkflow>,
): Record<string, HostVariable> {
  const resolved: Record<string, HostVariable> = {}
  // Lookup maps are double-keyed by id and name (AGL-185), so the same doc
  // can appear under two keys — evaluate each workflow once per doc.
  const memo = new Map<HostVariable, HostVariable>()
  for (const [name, variable] of Object.entries(variables)) {
    const workflowId = (variable as any).workflowId?.trim?.() ?? ''
    const workflowName = variable.workflowName?.trim()
    const workflow =
      (workflowId ? workflows[workflowId] : undefined) ??
      (workflowName ? workflows[workflowName] : undefined)
    if (!workflow) {
      resolved[name] = variable
      continue
    }
    const cached = memo.get(variable)
    if (cached) {
      resolved[name] = cached
      continue
    }
    const run = runWorkflow(workflow, functions, variables, {}, { workflows })
    const next =
      run.ok === false
        ? variable
        : { ...variable, value: String(run.value) }
    memo.set(variable, next)
    resolved[name] = next
  }
  return resolved
}

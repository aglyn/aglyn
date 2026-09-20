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
  HOST_ACTION_STEP_LABELS,
  type HostActionStep,
  type HostActionStepType,
  isClientActionStep,
  validateHostAction,
} from '@aglyn/aglyn/app-utils/actions'
import {
  type HostWorkflow,
  type HostWorkflowStep,
  WORKFLOW_MAX_STEPS,
} from '@aglyn/aglyn/app-utils/workflows'

/**
 * ONE STEP MODEL FOR BOTH ENGINES.
 *
 * A workflow step is one of two things:
 *
 *  - a FUNCTION CALL — `{ functionId, functionName, args, resultName }`, the
 *    shape every workflow has stored since the builder shipped, and still the
 *    default. It evaluates its argument expressions and binds the result for
 *    the steps after it;
 *  - an ACTIONS STEP — `{ type, …fields, when? }`, exactly as the Actions
 *    editor stores it: write a dataset record, send an email, update a CRM
 *    contact, post a webhook, wait. It runs through the Actions executors,
 *    with their validation, their tier gates and their run-history phrases.
 *
 * The two are told apart by `type`. An Actions step always carries one of the
 * Actions step types and a function call never has one, so a stored workflow
 * is read as it was written and nothing is migrated. A step whose `type` the
 * Actions vocabulary does not know is read as a function call, which is how
 * every workflow read it before — it fails as a call to no function.
 *
 * Pure and client-safe: the console's editor and the server's engine read the
 * same definitions from here.
 */

/** A workflow step that runs one of the Actions steps, stored in the Actions shape. */
export type WorkflowActionStep = HostActionStep

/** Any step a stored workflow holds. */
export type WorkflowStep = HostWorkflowStep | WorkflowActionStep

/** A stored workflow, read with the unified step model. */
export interface AutomationWorkflow extends Omit<HostWorkflow, 'steps'> {
  steps: WorkflowStep[]
}

/** Whether a stored step is an Actions step rather than a function call. */
export function isWorkflowActionStep(step: unknown): step is WorkflowActionStep {
  const type = (step as { type?: unknown } | null | undefined)?.type
  return (
    typeof type === 'string' &&
    Object.prototype.hasOwnProperty.call(HOST_ACTION_STEP_LABELS, type)
  )
}

/** Whether a stored step is a function call. */
export function isWorkflowFunctionStep(step: unknown): step is HostWorkflowStep {
  return Boolean(step) && typeof step === 'object' && !isWorkflowActionStep(step)
}

/** Whether any step of a workflow is an Actions step. */
export function workflowHasActionSteps(
  workflow: { steps?: readonly unknown[] | null } | null | undefined,
): boolean {
  return (workflow?.steps ?? []).some(isWorkflowActionStep)
}

/**
 * The Actions steps a workflow may hold: every step the SERVER runs.
 *
 * The executor's own rule, stated once. It runs every step that is not a
 * client step, and `siteAlert`, whose alert it hands back to the request that
 * raised the event. What is left out is what only a visitor's browser can do —
 * class toggles, drawers, menus, overlays, scrolling, custom HTML and
 * JavaScript, analytics events, redirects — and a workflow runs on a server
 * event, where there is no page to do it on.
 */
export const WORKFLOW_ACTION_STEP_TYPES: readonly HostActionStepType[] = (
  Object.keys(HOST_ACTION_STEP_LABELS) as HostActionStepType[]
).filter(
  (type) =>
    type === 'siteAlert' || !isClientActionStep({ type } as HostActionStep),
)

const WORKFLOW_ACTION_STEP_TYPE_SET: ReadonlySet<string> = new Set(
  WORKFLOW_ACTION_STEP_TYPES,
)

/** Whether a workflow may run an Actions step of this type. */
export function isWorkflowActionStepType(type: unknown): boolean {
  return typeof type === 'string' && WORKFLOW_ACTION_STEP_TYPE_SET.has(type)
}

/** How a step type reads in a sentence: its picker label, or its raw type. */
export function workflowStepTypeLabel(type: string): string {
  return HOST_ACTION_STEP_LABELS[type as HostActionStepType] ?? type
}

/**
 * Why a workflow cannot hold this Actions step, or null when it can.
 *
 * Shared by the editor, which refuses to save the step, and by the engine,
 * which refuses to run one a writer stored anyway — an import, the API, an
 * older client.
 */
export function workflowActionStepRefusal(step: WorkflowActionStep): string | null {
  if (isWorkflowActionStepType(step.type)) return null
  if (HOST_ACTION_STEP_LABELS[step.type as HostActionStepType]) {
    return (
      `“${workflowStepTypeLabel(step.type)}” runs in the visitor’s browser, ` +
      'so a workflow cannot run it — build it as an interaction in Actions'
    )
  }
  return `“${String(step.type)}” is not a step a workflow can run`
}

/**
 * A workflow's steps checked the way the editors check them; null when they
 * pass, or the first problem, numbered by the step's place in the workflow.
 *
 * An Actions step is held to the Actions editor's own validator,
 * `validateHostAction`, one step at a time — the rules are that validator's,
 * never a second copy of them. The list is capped at `WORKFLOW_MAX_STEPS`,
 * the workflow's own ceiling rather than the ten an action is capped at.
 *
 * A FUNCTION CALL is not checked, deliberately. A workflow has always been
 * savable with a blank step — it is how the builder opens, and how an author
 * leaves a pipeline half-built and comes back to it — and a call naming no
 * function fails at run time with the evaluator's own words. Checking it here
 * would refuse a save that has been allowed since the builder shipped.
 */
export function validateWorkflowSteps(
  steps: readonly unknown[] | null | undefined,
): string | null {
  const list = Array.isArray(steps) ? steps : []
  if (list.length > WORKFLOW_MAX_STEPS) {
    return `Workflows are capped at ${WORKFLOW_MAX_STEPS} steps`
  }
  for (const [index, step] of list.entries()) {
    const label = `Step ${index + 1}`
    if (!isWorkflowActionStep(step)) continue
    const refusal = workflowActionStepRefusal(step)
    if (refusal) return `${label}: ${refusal}`
    const problem = validateHostAction({
      name: 'workflow step',
      trigger: { event: 'formSubmission' },
      steps: [step],
    })
    if (problem) return problem.replace(/^Step 1\b/, label)
  }
  return null
}

/**
 * The function calls of a workflow, as a workflow of their own, for the pure
 * evaluator — the console's test run, and anything else that evaluates a
 * workflow without performing it.
 *
 * Each call keeps the result name it would have had in place: an unnamed step
 * binds `step<N>` by its position, and the position is the one it holds among
 * ALL the steps, so a call after an Actions step keeps the name the steps
 * after it refer to.
 */
export function workflowFunctionCalls(
  workflow: AutomationWorkflow | HostWorkflow,
): HostWorkflow {
  const steps: HostWorkflowStep[] = []
  ;(workflow.steps ?? []).forEach((step, index) => {
    if (!isWorkflowFunctionStep(step)) return
    steps.push({
      ...step,
      resultName: step.resultName?.trim() || `step${index + 1}`,
    })
  })
  return { ...workflow, steps } as HostWorkflow
}

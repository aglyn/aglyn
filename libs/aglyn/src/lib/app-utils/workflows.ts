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
 */
export const HOST_EVENT_TYPES = [
  'formSubmission',
  'pageView',
  'memberSignUp',
  'memberSignIn',
  'memberSignOut',
  'lead',
] as const

export type HostEventType = (typeof HOST_EVENT_TYPES)[number]

export interface HostWorkflowTrigger {
  event: HostEventType
  /**
   * Optional expression over the event payload (plus variables); the
   * workflow only runs when it evaluates truthy (e.g. `path == "/pricing"`).
   */
  filter?: string
}

export interface HostWorkflowStep {
  /** Host function to run (by name). */
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

export function runWorkflow(
  workflow: HostWorkflow,
  functions: Record<string, HostFunction>,
  variables: Record<string, HostVariable> = {},
  /**
   * Extra scope entries seeded ahead of the steps — event payloads (path,
   * formName, field values) land here (AGL-128). Wins over variables.
   */
  extraScope: Record<string, number | string | boolean> = {},
): WorkflowRunResult {
  const steps = workflow.steps ?? []
  if (steps.length > WORKFLOW_MAX_STEPS) {
    return { ok: false, error: `Workflows are capped at ${WORKFLOW_MAX_STEPS} steps` }
  }
  const scope = { ...variableScope(variables), ...extraScope }
  const results: Record<string, number | string | boolean> = {}

  for (const [index, step] of steps.entries()) {
    const definition = functions[step.functionName?.trim()]
    if (!definition) {
      return {
        ok: false,
        error: `Unknown function "${step.functionName}"`,
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
    const run = evaluateHostFunction(definition, args)
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

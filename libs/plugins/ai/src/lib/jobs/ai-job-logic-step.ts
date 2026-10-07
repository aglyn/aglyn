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

import { FUNCTION_BUILTIN_NAMES, type HostFunction } from '@aglyn/aglyn/app-utils/functions'
import { isHostPluginEnabled } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { filterEnabledPluginsByReleaseFlags } from '@aglyn/tenant-data-admin/server/release-flags'
import { resolveOrgIdForHost } from '@aglyn/tenant-data-admin/server/organizations'
import { aiWorkflowExplanationText } from '../model/ai-automation-outline'
import type { AiJobOutput, AiJobOutputResource } from '../model/ai-jobs.types'
import {
  AI_LOGIC_GONE_COPY,
  AI_LOGIC_MAX_OPERATIONS,
  AI_LOGIC_MAX_PARAMETERS,
  AI_LOGIC_NO_EXPLANATION_COPY,
  AI_LOGIC_NO_FUNCTION_COPY,
  AI_LOGIC_NO_SITE_COPY,
  AI_LOGIC_NO_VARIABLE_COPY,
  AI_LOGIC_RESOURCE,
  AI_LOGIC_UNAVAILABLE_COPY,
  checkAiLogicFunction,
  checkAiLogicVariable,
  parseAiLogicJobInputs,
  type AiLogicContext,
  type AiLogicProposal,
  type AiLogicSiteVariable,
} from '../model/ai-logic-job'
import { AI_STEP_TIERS } from '../providers/catalog'
import { AI_ROUTING_TABLE, aiModelForStep } from '../providers/routing'
import { runValidatedGeneration, type AiCustomGenerationInput } from '../runtime/ai-doctrine'
import type { AiSystemBlock } from '../runtime/ai-runtime'
import { aiLogicFunctionTool, aiLogicVariableTool, AI_LOGIC_FUNCTION_TOOL_NAME, AI_LOGIC_VARIABLE_TOOL_NAME } from '../tools/ai-logic-tool'
import {
  AI_WORKFLOW_EXPLANATION_TOOL_NAME,
  aiWorkflowExplanationTool,
  readAiWorkflowExplanation,
  type AiWorkflowExplanation,
} from '../tools/ai-workflow-tool'
import { registerAiJobAdmission, type AiJobAdmission, type AiJobAdmissionRefusal } from './ai-job-admission'
import { aiJobStepBudget } from './ai-job-budget'
import { aiGenerationSpent, aiUnspentOutcome } from './ai-job-generation'
import { AI_JOB_BRIEF_MAX_CHARS, type AiJobStepOutcome, type AiJobStepRunner } from './ai-job-text-step'
import { registerAiJobStep } from './ai-jobs'
import { readAiLogicFunction, readAiLogicRecords } from './ai-logic-records'

/**
 * The `logic` step (AGL-3603): a function or a variable proposed from a
 * description, a saved function changed or fixed, or one explained.
 *
 * The model is shown the expression grammar the evaluator runs — operators,
 * built-ins, how a dictionary's member is read — and, in the user turn, the
 * site's variables by name, type and value, and its function names. A saved
 * function is shown as an outline of its own definition. It answers through
 * `submit_function`, `submit_variable` or `submit_explanation`; a function
 * is held to the grammar, to the names it may read and to a first run before
 * it is kept (`checkAiLogicFunction`), and a re-ask names what failed.
 *
 * Nothing is written. A proposal rides on a `logic` output, and the logic
 * editor opens it for a person to save.
 */

/** The longest the step may take reading the site first. */
export const AI_LOGIC_RECORDS_READ_MS = 2_000

/** The step's time: its answer and its re-ask at the `job.logic` ceiling, with its own reads. */
export const AI_JOB_LOGIC_STEP_BUDGET = aiJobStepBudget({
  tier: AI_STEP_TIERS['job.logic'],
  maxTokens: AI_ROUTING_TABLE['job.logic'].maxTokens,
  lookups: 0,
  ownReadsMs: AI_LOGIC_RECORDS_READ_MS,
})

export const AI_JOB_LOGIC_STEP_MINIMUM_MS = AI_JOB_LOGIC_STEP_BUDGET.minimumMs

export function aiJobLogicModel(): string {
  return aiModelForStep('job.logic')
}

/** How many site variables the user turn lists, and how much of each value. */
export const AI_LOGIC_VARIABLES_LISTED = 60
export const AI_LOGIC_VALUE_LISTED_CHARS = 120

/**
 * The instructions, byte-identical on every request so they cache: one block
 * for a function, a variable and an explanation alike, because a block of
 * either half alone is under the balanced tier's cacheable minimum, and the
 * two halves together clear it on every tool.
 */
export const AI_JOB_LOGIC_INSTRUCTIONS: readonly AiSystemBlock[] = [
  {
    text: [
      `You work on the Functions & Variables page of a website builder, for the person who owns the site. Asked for a function, call ${AI_LOGIC_FUNCTION_TOOL_NAME}; asked for a variable, call ${AI_LOGIC_VARIABLE_TOOL_NAME}; asked what a function does, call ${AI_WORKFLOW_EXPLANATION_TOOL_NAME}. Call exactly one, once. A reply in prose cannot be used.`,
      '',
      'A function has parameters (what it is given), locals (working values), operations run in order, and returnValue, the parameter or local whose final value it returns. Each operation is: if (left comparator right) then assign each of its then list, otherwise each of its otherwise list. A condition that should always hold is written 1 == 1.',
      '',
      'Expressions:',
      '- Numbers, "quoted text", true and false; + - * / and parentheses; + also joins text.',
      `- Built-in functions only: ${FUNCTION_BUILTIN_NAMES.map((name) => `${name}()`).join(', ')}.`,
      '- Names: the function’s own parameters and locals, and the site variables the request lists, by name; a dictionary variable’s member as name.member.',
      '- An assignment sets only a parameter or a local, never a site variable.',
      '',
      'Writing a function or a variable:',
      `- At most ${AI_LOGIC_MAX_PARAMETERS} parameters and ${AI_LOGIC_MAX_OPERATIONS} operations. Names start with a letter or _, then letters, digits or _.`,
      '- Types are number, text or boolean. A parameter a visitor fills in gets a short label; defaultValue is what the input starts with, or empty.',
      '- Use only the names and built-ins listed. Where the description needs a value the site does not hold, make it a parameter rather than inventing a number.',
      '- When the request shows a saved function to change, answer with the whole function after the change, keeping what the change does not touch.',
      '- A variable’s value is written as stored: digits; true or false; YYYY-MM-DD; HH:MM; a JSON object for a dictionary; a JSON list for a collection.',
      '',
      'Explaining a function, in plain words for someone who does not write code:',
      '- summary: in one or two sentences, what the function computes from what it is given.',
      '- points: what it does, operation by operation, in order. One sentence each.',
      '- suggestions: what is worth checking — a condition that can never hold, a value it returns that nothing sets, a name it reads that the site does not have. Empty when there is nothing to suggest.',
      '- Explain only what you are shown, and never say you changed anything: you change nothing. Write plain text, with no markdown and no HTML.',
    ].join('\n'),
    cacheBreakpoint: true,
  },
]

// ── The user turns ────────────────────────────────────────────────────────

function variableLine(variable: AiLogicSiteVariable): string {
  const value = String(variable.value ?? '').replace(/\s+/g, ' ')
  return `- ${variable.name} (${variable.type}) = ${value.length > AI_LOGIC_VALUE_LISTED_CHARS ? `${value.slice(0, AI_LOGIC_VALUE_LISTED_CHARS)}…` : value || '(empty)'}`
}

/** A saved function as lines a model reads: its own definition, in the editor's terms. */
export function aiLogicFunctionOutline(definition: HostFunction): string {
  const lines = [`Function: ${definition.name}`]
  lines.push(
    'Parameters:',
    ...(definition.parameters.length
      ? definition.parameters.map(
          (parameter) =>
            `- ${parameter.name} (${parameter.type}${parameter.required ? ', required' : ''})${parameter.label ? ` labeled "${parameter.label}"` : ''}${parameter.defaultValue ? `, starts as ${parameter.defaultValue}` : ''}`,
        )
      : ['- none']),
    'Locals:',
    ...(definition.variables.length
      ? definition.variables.map((local) => `- ${local.name} (${local.type})`)
      : ['- none']),
    'Operations, in order:',
  )
  definition.operations.forEach((operation, index) => {
    const sets = (list: HostFunction['operations'][number]['then']) =>
      list.length ? list.map((set) => `${set.set} = ${set.workflow ? `the workflow "${set.workflow}"` : set.expression}`).join('; ') : 'nothing'
    lines.push(
      `${index + 1}. If ${operation.if?.left} ${operation.if?.comparator} ${operation.if?.right}: ${sets(operation.then ?? [])}. Otherwise: ${sets(operation.otherwise ?? [])}.`,
    )
  })
  lines.push(`Returns: ${definition.returnValue || '(nothing named)'}`)
  return lines.join('\n')
}

/** What a function or a variable is asked from. */
export function aiJobLogicPrompt(input: {
  brief: string
  mode: 'function' | 'variable' | 'explain'
  context: AiLogicContext
  saved: HostFunction | null
}): string {
  const variables = input.context.variables.slice(0, AI_LOGIC_VARIABLES_LISTED)
  return [
    input.mode === 'variable'
      ? 'Asked: one site variable.'
      : input.mode === 'explain'
        ? 'Asked: what this function does.'
        : input.saved
          ? 'Asked: the saved function below, changed as the request says.'
          : 'Asked: one new function.',
    'Site variables (name (type) = value):',
    ...(variables.length ? variables.map(variableLine) : ['- none']),
    `Function names already on the site: ${input.context.functions.join(', ') || 'none'}`,
    ...(input.saved ? ['The saved function:', aiLogicFunctionOutline(input.saved)] : []),
    `Request: ${input.brief.slice(0, AI_JOB_BRIEF_MAX_CHARS)}`,
  ].join('\n')
}

function routedEffort(): Pick<AiCustomGenerationInput<unknown>, 'thinking' | 'effort'> {
  const row = AI_ROUTING_TABLE['job.logic']
  return {
    ...(row.thinking ? { thinking: row.thinking } : {}),
    ...(row.effort ? { effort: row.effort } : {}),
  }
}

/** The function generation as the doctrine's loop runs it. */
export function aiJobLogicFunctionGeneration(request: {
  brief: string
  context: AiLogicContext
  saved: HostFunction | null
  model: string
  signal?: AbortSignal
}): AiCustomGenerationInput<HostFunction> {
  return {
    step: 'job.logic',
    model: request.model,
    instructions: AI_JOB_LOGIC_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiJobLogicPrompt({ ...request, mode: 'function' }) }],
    tool: aiLogicFunctionTool(),
    maxTokens: AI_JOB_LOGIC_STEP_BUDGET.maxTokens(request.model),
    ...routedEffort(),
    ...(request.signal ? { signal: request.signal } : {}),
    check: (answer) => checkAiLogicFunction(answer, request.context),
  }
}

/** The variable generation. */
export function aiJobLogicVariableGeneration(request: {
  brief: string
  context: AiLogicContext
  model: string
  signal?: AbortSignal
}): AiCustomGenerationInput<AiLogicSiteVariable> {
  return {
    step: 'job.logic',
    model: request.model,
    instructions: AI_JOB_LOGIC_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiJobLogicPrompt({ ...request, mode: 'variable', saved: null }) }],
    tool: aiLogicVariableTool(),
    maxTokens: AI_JOB_LOGIC_STEP_BUDGET.maxTokens(request.model),
    ...routedEffort(),
    ...(request.signal ? { signal: request.signal } : {}),
    check: (answer) => checkAiLogicVariable(answer, request.context),
  }
}

/** The explanation generation. */
export function aiJobLogicExplainGeneration(request: {
  brief: string
  context: AiLogicContext
  saved: HostFunction
  model: string
  signal?: AbortSignal
}): AiCustomGenerationInput<AiWorkflowExplanation> {
  return {
    step: 'job.logic',
    model: request.model,
    instructions: AI_JOB_LOGIC_INSTRUCTIONS,
    messages: [{ role: 'user', content: aiJobLogicPrompt({ ...request, mode: 'explain' }) }],
    tool: aiWorkflowExplanationTool(),
    maxTokens: AI_JOB_LOGIC_STEP_BUDGET.maxTokens(request.model),
    ...routedEffort(),
    ...(request.signal ? { signal: request.signal } : {}),
    check: readAiWorkflowExplanation,
  }
}

// ── The runner ────────────────────────────────────────────────────────────

export interface AiJobLogicStepDeps {
  readRecords?: typeof readAiLogicRecords
  readFunction?: typeof readAiLogicFunction
}

function proposalOutput(
  place: { hostId: string; hostSubdomain: string | null },
  id: string,
  label: string,
  proposal: AiLogicProposal,
  note: string,
): AiJobOutput {
  return {
    resource: AI_LOGIC_RESOURCE as AiJobOutputResource,
    id,
    hostId: place.hostId,
    hostSubdomain: place.hostSubdomain,
    label,
    proposal: proposal as unknown as Record<string, unknown>,
    note,
  }
}

export function createAiJobLogicStep(deps: AiJobLogicStepDeps = {}): AiJobStepRunner {
  const readRecords = deps.readRecords ?? readAiLogicRecords
  const readFunction = deps.readFunction ?? readAiLogicFunction
  return async ({ job, signal, firestore, modelFor }): Promise<AiJobStepOutcome> => {
    const model = modelFor?.('job.logic') ?? aiJobLogicModel()
    const unspent = (failure: string): AiJobStepOutcome => ({ ...aiUnspentOutcome(model), failure })
    const inputs = parseAiLogicJobInputs(job.inputs)
    if (typeof inputs === 'string') return unspent(inputs)
    const hostId = job.hostId
    if (!hostId) return unspent(AI_LOGIC_NO_SITE_COPY)
    const host = await firestore.collection('hosts').doc(hostId).get()
    if (!host.exists || host.get('orgId') !== job.orgId) return unspent(AI_LOGIC_NO_SITE_COPY)
    const subdomain = host.get('subdomain')
    const place = { hostId, hostSubdomain: typeof subdomain === 'string' && subdomain ? subdomain : null }

    const functionId = inputs.mode === 'variable' ? null : inputs.functionId
    const saved = functionId ? await readFunction(firestore, { hostId, id: functionId }) : null
    if (functionId && !saved) return unspent(AI_LOGIC_GONE_COPY)
    const records = await readRecords(firestore, hostId)
    const context: AiLogicContext = { ...records, editing: saved?.name ?? null }
    const signalled = signal ? { signal } : {}

    if (inputs.mode === 'explain' && saved) {
      const generation = await runValidatedGeneration(
        'logic',
        aiJobLogicExplainGeneration({ brief: job.brief, context, saved, model, ...signalled }),
      )
      const spent = { ...aiGenerationSpent(generation), ...(generation.effort ? { effort: generation.effort } : {}) }
      if (generation.status === 'refused') return { ...spent, refused: true }
      if (generation.status === 'needs_input') return { ...spent, failure: AI_LOGIC_NO_EXPLANATION_COPY }
      return {
        ...spent,
        outputs: [
          {
            resource: 'text',
            id: 'explanation',
            hostId,
            hostSubdomain: place.hostSubdomain,
            label: `How ${saved.name} works`,
            text: aiWorkflowExplanationText(generation.value, 'explain'),
          },
        ],
      }
    }

    if (inputs.mode === 'variable') {
      const generation = await runValidatedGeneration(
        'logic',
        aiJobLogicVariableGeneration({ brief: job.brief, context, model, ...signalled }),
      )
      const spent = { ...aiGenerationSpent(generation), ...(generation.effort ? { effort: generation.effort } : {}) }
      if (generation.status === 'refused') return { ...spent, refused: true }
      if (generation.status === 'needs_input') return { ...spent, failure: AI_LOGIC_NO_VARIABLE_COPY }
      const variable = generation.value
      return {
        ...spent,
        outputs: [
          proposalOutput(place, 'variable', variable.name, { kind: 'variable', variable }, 'Open it in Variables to review and save it.'),
        ],
      }
    }

    const generation = await runValidatedGeneration(
      'logic',
      aiJobLogicFunctionGeneration({ brief: job.brief, context, saved, model, ...signalled }),
    )
    const spent = { ...aiGenerationSpent(generation), ...(generation.effort ? { effort: generation.effort } : {}) }
    if (generation.status === 'refused') return { ...spent, refused: true }
    if (generation.status === 'needs_input') return { ...spent, failure: AI_LOGIC_NO_FUNCTION_COPY }
    const definition = generation.value
    return {
      ...spent,
      outputs: [
        proposalOutput(
          place,
          functionId ?? 'function',
          definition.name,
          { kind: 'function', functionId, definition },
          saved
            ? `A changed ${saved.name}, checked against the expression grammar and run once. Nothing is saved until you save it in the editor.`
            : 'Checked against the expression grammar and run once. Nothing is saved until you save it in the editor.',
        ),
      ],
    }
  }
}

export const runAiJobLogicStep = createAiJobLogicStep()

// ── Admission ─────────────────────────────────────────────────────────────

/** The plugin that keeps Functions & Variables. */
export const AI_LOGIC_PLUGIN_ID = 'logic'

export interface AiLogicJobAdmissionDeps {
  readFunction?: typeof readAiLogicFunction
}

/**
 * A logic job is admitted for a site of its org with Logic on for it and past
 * its release flag; a change or an explanation also needs the function it
 * names to exist.
 */
export function createAiLogicJobAdmission(deps: AiLogicJobAdmissionDeps = {}): AiJobAdmission {
  const readFunction = deps.readFunction ?? readAiLogicFunction
  return async (context): Promise<AiJobAdmissionRefusal | null> => {
    const inputs = parseAiLogicJobInputs(context.inputs)
    if (typeof inputs === 'string') return { status: 400, error: inputs }
    const hostId = context.hostId
    if (!hostId) return { status: 400, error: 'Open the site the logic is for before starting the job' }
    const owner = await resolveOrgIdForHost(hostId)
    if (!owner || owner !== context.orgId) return { status: 404, error: 'Unknown site' }
    const host = (await context.firestore.collection('hosts').doc(hostId).get()).data() ?? null
    const org = context.org as { enabledPlugins?: string[] } | null
    const released = await filterEnabledPluginsByReleaseFlags([AI_LOGIC_PLUGIN_ID], {
      orgId: context.orgId,
      authorization: null,
    })
    if (!released.includes(AI_LOGIC_PLUGIN_ID) || !isHostPluginEnabled(org, host, AI_LOGIC_PLUGIN_ID)) {
      return { status: 403, error: AI_LOGIC_UNAVAILABLE_COPY }
    }
    const functionId = inputs.mode === 'variable' ? null : inputs.functionId
    if (functionId && !(await readFunction(context.firestore, { hostId, id: functionId }))) {
      return { status: 404, error: AI_LOGIC_GONE_COPY }
    }
    return null
  }
}

export const aiLogicJobAdmission = createAiLogicJobAdmission()

/** Registers the logic step and the check a logic job passes before it is created or resumed. */
export function registerAiLogicJob(): void {
  registerAiJobStep('logic', runAiJobLogicStep, { minimumMs: AI_JOB_LOGIC_STEP_MINIMUM_MS })
  registerAiJobAdmission('logic', aiLogicJobAdmission)
}

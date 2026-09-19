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
  CLIENT_ACTION_STEP_TYPES,
  HOST_ACTION_STEP_LABELS,
  type HostAction,
  type HostActionStep,
  type HostActionStepType,
  type HostActionTriggerCondition,
  normalizeTriggerConditions,
} from '@aglyn/aglyn/app-utils/actions'
import { automationPlaceholderIn } from '@aglyn/aglyn/app-utils/automation-placeholders'
import { CONTACT_LIFECYCLE_STAGE_LABELS, type ContactLifecycleStage } from '@aglyn/aglyn/app-utils/crm'
import type { HostWorkflow } from '@aglyn/aglyn/app-utils/workflows'
import { aiAutomationTriggerLabel } from './ai-workflow-job'
import type { AiAutomationNamedRecord, AiAutomationRecords } from './ai-automation-draft'
import type { AiWorkflowExplanation } from '../tools/ai-workflow-tool'

/**
 * What an explanation is asked from (AGL-2919): a saved automation, and one of
 * its failed runs, as plain lines a model reads — never the stored documents.
 *
 * WHAT IS LEFT OUT. An email address anywhere — a condition's value, an
 * email's text, a run's error naming the contact it could not find — becomes
 * `[email address]`. A teammate named by account id or address is "a named
 * teammate". A selector, a script or HTML an on-page step holds is not shown
 * at all; the step is named by its label. A run's event payload, which holds
 * what a visitor submitted, is never read. What is shown is how the automation
 * is set up, and what the run history recorded about the run.
 *
 * WHAT IS ADDED. Whether each list, campaign, workflow, webhook or dataset a
 * step names still exists on the site, looked up in code, because "that list
 * was deleted" is the answer to the most common failure and a model cannot
 * find it out.
 */

/** An email address, wherever it appears in a line. */
const EMAIL_ADDRESS = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[A-Za-z]{2,}/g

/** How much of an email's text an outline quotes. */
export const AI_OUTLINE_BODY_MAX_CHARS = 300
/** How much of any other value an outline quotes. */
export const AI_OUTLINE_VALUE_MAX_CHARS = 120
/** The most errors of one run an outline lists. */
export const AI_OUTLINE_RUN_ERRORS_MAX = 10

/** A line with every email address replaced by what it is. */
export function aiRedactPersonal(text: string): string {
  return text.replace(EMAIL_ADDRESS, '[email address]')
}

function quoted(value: unknown, max = AI_OUTLINE_VALUE_MAX_CHARS): string {
  const text = aiRedactPersonal(String(value ?? '').replace(/\s+/g, ' ').trim())
  return `"${text.length > max ? `${text.slice(0, max)}…` : text}"`
}

function conditionLine(condition: HostActionTriggerCondition): string {
  const field = String(condition.field ?? '')
  if (condition.op === 'notEmpty') return `${field} is not empty`
  const value = String(condition.value ?? '')
  const stage = CONTACT_LIFECYCLE_STAGE_LABELS[value as ContactLifecycleStage]
  const placeholder = automationPlaceholderIn(value) ? ' (a placeholder nobody has filled in)' : ''
  return `${field} ${condition.op} ${stage ? `"${stage}"` : quoted(value)}${placeholder}`
}

/** The kind of site record each step that names one names. */
export const AI_OUTLINE_RECORD_KINDS: Readonly<
  Partial<Record<HostActionStepType, 'lists' | 'campaigns' | 'workflows' | 'webhooks' | 'datasets'>>
> = {
  enrollList: 'lists',
  assignCampaign: 'campaigns',
  runWorkflow: 'workflows',
  webhookPost: 'webhooks',
  datasetAppend: 'datasets',
  updateDataset: 'datasets',
}

/** The kinds of site record an action's steps name, each once. */
export function aiActionRecordKinds(action: Pick<HostAction, 'steps'>): Array<keyof AiAutomationRecords> {
  const kinds = (action.steps ?? []).map((step) => AI_OUTLINE_RECORD_KINDS[step?.type as HostActionStepType])
  return [...new Set(kinds.filter((kind): kind is NonNullable<typeof kind> => Boolean(kind)))]
}

/** Whether the site holds a record by the id or the name a step stores. */
function standing(
  id: unknown,
  name: unknown,
  records: readonly AiAutomationNamedRecord[] | null,
): string {
  if (automationPlaceholderIn(name) && !String(id ?? '').trim()) {
    return ' — a placeholder nobody has filled in'
  }
  if (!records) return ''
  const found = records.some(
    (record) =>
      (typeof id === 'string' && id && record.id === id) ||
      (typeof name === 'string' && name && record.name.trim() === name.trim()),
  )
  return found ? ' — the site has it' : ' — the site has none by that name'
}

function stepLine(
  step: HostActionStep,
  records: AiAutomationRecords | null,
): string {
  const label = HOST_ACTION_STEP_LABELS[step.type as HostActionStepType] ?? step.type
  const detail = (() => {
    switch (step.type) {
      case 'sendEmail':
        return `subject ${quoted(step.subject)}, text ${quoted(step.body, AI_OUTLINE_BODY_MAX_CHARS)}, to the event's ${step.toField || 'email'} field`
      case 'notifyAdmins':
        return quoted(step.title)
      case 'enrollList':
        return `${quoted(step.listName || step.listId)}${standing(step.listId, step.listName, records?.lists ?? null)}`
      case 'assignCampaign':
        return `${quoted(step.campaignName || step.campaignId)}${standing(step.campaignId, step.campaignName, records?.campaigns ?? null)}`
      case 'runWorkflow':
        return `${quoted(step.workflowName || step.workflowId)}${standing(step.workflowId, step.workflowName, records?.workflows ?? null)}`
      case 'webhookPost':
        return `${quoted(step.webhookName || step.webhookId)}${standing(step.webhookId, step.webhookName, records?.webhooks ?? null)}`
      case 'datasetAppend':
      case 'updateDataset':
        return `${quoted(step.datasetName || step.datasetId)}${standing(step.datasetId, step.datasetName, records?.datasets ?? null)}`
      case 'siteAlert':
        return quoted(step.message)
      case 'wait':
        return durationOf(step.delayMinutes)
      case 'waitForEvent':
        return `${aiAutomationTriggerLabel(step.eventName)}, giving up after ${durationOf(step.timeoutMinutes)}`
      case 'exitFlow':
        return ''
      case 'setContactStage':
        return `"${CONTACT_LIFECYCLE_STAGE_LABELS[step.lifecycleStage] ?? step.lifecycleStage}"`
      case 'addContactTag':
        return quoted(step.tag)
      case 'assignContactOwner':
        return step.roundRobin ? 'by round robin' : 'a named teammate'
      case 'createCrmTask':
        return `${quoted(step.title)}, a ${step.kind}, due in ${step.dueInDays} ${step.dueInDays === 1 ? 'day' : 'days'}${
          step.assigneeUid || step.assigneeEmail ? ', for a named teammate' : ''
        }`
      case 'logCrmActivity':
        return `a ${step.kind}: ${quoted(step.body)}`
      case 'customEvent':
        return quoted(step.eventName)
      default:
        return CLIENT_ACTION_STEP_TYPES.has(step.type) ? 'runs in the visitor’s browser on the page' : ''
    }
  })()
  const guard = (step.when?.conditions ?? []).filter(Boolean)
  const only = guard.length
    ? ` Only if ${guard.map(conditionLine).join(step.when?.combinator === 'or' ? ' or ' : ' and ')}.`
    : ''
  return `${label}${detail ? `: ${detail}` : ''}.${only}`
}

/** Minutes as a person says them. */
function durationOf(minutes: unknown): string {
  const value = Number(minutes)
  if (!Number.isFinite(value) || value <= 0) return 'no time'
  const units: Array<[number, string]> = [
    [60 * 24 * 7, 'week'],
    [60 * 24, 'day'],
    [60, 'hour'],
    [1, 'minute'],
  ]
  for (const [size, unit] of units) {
    if (value % size === 0) {
      const count = value / size
      return `${count} ${unit}${count === 1 ? '' : 's'}`
    }
  }
  return `${value} minutes`
}

/** A saved action as an outline. */
export function aiActionOutline(
  action: HostAction,
  records: AiAutomationRecords | null,
): string {
  const lines = [
    `Automation: ${quoted(action.name)} — an action, switched ${action.enabled === false ? 'off' : 'on'}.`,
    `Starts when: ${aiAutomationTriggerLabel(String(action.trigger?.event ?? ''))}.`,
  ]
  const conditions = normalizeTriggerConditions(action.trigger)
  if (conditions.length) {
    lines.push(
      `Only when ${action.trigger?.combinator === 'or' ? 'any' : 'all'} of these hold: ${conditions
        .map(conditionLine)
        .join('; ')}.`,
    )
  }
  if (action.trigger?.filter?.trim()) {
    lines.push(`And only when this expression is true: ${quoted(action.trigger.filter)}.`)
  }
  lines.push('Steps, in order:')
  ;(action.steps ?? []).forEach((step, index) => {
    lines.push(`${index + 1}. ${stepLine(step, records)}`)
  })
  if (!(action.steps ?? []).length) lines.push('(none)')
  return lines.join('\n')
}

/** A saved workflow — a pipeline of function calls — as an outline. */
export function aiWorkflowOutline(
  workflow: HostWorkflow,
  functions: readonly AiAutomationNamedRecord[] | null,
): string {
  const lines = [`Workflow: ${quoted(workflow.name)} — a workflow, a list of function calls.`]
  if (workflow.trigger?.event) {
    const filter = workflow.trigger.filter?.trim()
    lines.push(
      `Starts when: ${aiAutomationTriggerLabel(workflow.trigger.event)}${
        filter ? `, only when this expression is true: ${quoted(filter)}` : ''
      }.`,
    )
  } else {
    lines.push('Starts when: it is called — by an automation, an inbound webhook or a computed variable.')
  }
  lines.push('Steps, in order:')
  ;(workflow.steps ?? []).forEach((step, index) => {
    const name = step.functionName || step.functionId || ''
    const exists = standing(step.functionId, step.functionName, functions)
    const args = (step.args ?? []).filter((arg) => String(arg ?? '').trim())
    lines.push(
      `${index + 1}. Runs the function ${quoted(name)}${exists}${
        args.length ? `, given ${args.map((arg) => quoted(arg)).join(', ')}` : ''
      }; its result is kept as ${quoted(step.resultName || `step${index + 1}`)}.`,
    )
  })
  if (!(workflow.steps ?? []).length) lines.push('(none)')
  if (workflow.returnValue?.trim()) lines.push(`Returns: ${quoted(workflow.returnValue)}.`)
  return lines.join('\n')
}

/** What the run history recorded about one run, as far as an outline reads it. */
export interface AiRunRecord {
  result?: unknown
  trigger?: unknown
  summary?: unknown
  action?: unknown
  createdAt?: unknown
}

function whenOf(value: unknown): string | null {
  const toDate = (value as { toDate?: () => Date } | null)?.toDate
  const date =
    typeof toDate === 'function'
      ? toDate.call(value)
      : value instanceof Date
        ? value
        : null
  return date && Number.isFinite(date.getTime()) ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC` : null
}

/** The errors a run recorded: the prose after "with errors:", or a workflow's failure. */
export function aiRunErrors(run: AiRunRecord): string[] {
  const action = String(run.action ?? '')
  const listed = action.match(/with errors:\s*(.+)$/)?.[1]
  if (listed) {
    return listed
      .split(/;\s+/)
      .map((error) => error.trim())
      .filter(Boolean)
      .slice(0, AI_OUTLINE_RUN_ERRORS_MAX)
  }
  const failed = action.match(/failed on [^:]+:\s*(.+)$/)?.[1] ?? (run.result === 'failed' ? String(run.summary ?? '') : '')
  return failed.trim() ? [failed.trim()] : []
}

/** A failed run as an outline: when, on what, what it did, and what went wrong. */
export function aiRunOutline(run: AiRunRecord): string {
  const when = whenOf(run.createdAt)
  const lines = [
    `The run that failed: on ${aiAutomationTriggerLabel(String(run.trigger ?? ''))}${when ? `, ${when}` : ''}.`,
  ]
  const summary = String(run.summary ?? '').trim()
  const errors = aiRunErrors(run)
  if (summary && !errors.includes(summary)) lines.push(`What it did: ${aiRedactPersonal(summary)}.`)
  lines.push('What went wrong:')
  lines.push(...(errors.length ? errors.map((error) => `- ${aiRedactPersonal(error)}`) : ['- (the run recorded no error)']))
  return lines.join('\n')
}

/** An explanation as the text a person reads. */
export function aiWorkflowExplanationText(
  explanation: AiWorkflowExplanation,
  mode: 'explain' | 'diagnose',
): string {
  const parts = [explanation.summary]
  if (explanation.points.length) {
    parts.push(
      [
        mode === 'diagnose' ? 'What happened:' : 'What it does:',
        ...explanation.points.map((point, index) => `${index + 1}. ${point}`),
      ].join('\n'),
    )
  }
  if (explanation.suggestions.length) {
    parts.push(
      [
        mode === 'diagnose' ? 'How to fix it:' : 'Worth checking:',
        ...explanation.suggestions.map((suggestion) => `- ${suggestion}`),
      ].join('\n'),
    )
  }
  return parts.join('\n\n')
}

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
  type HostAction,
  type HostActionStep,
  type HostActionStepType,
  normalizeTriggerConditions,
} from './actions'

/**
 * PLACEHOLDERS IN AN AUTOMATION (AGL-2919).
 *
 * A placeholder is a value a person still has to supply, written in square
 * brackets where the value belongs: `[newsletter]` where a list is named,
 * `[your phone number]` in an email's body. An automation drafted for somebody
 * to review carries one wherever the draft could not name a real record or
 * did not know a fact.
 *
 * Square brackets because they are inert everywhere an automation reads a
 * value. A bracketed list, campaign or workflow name matches no record by
 * name, so the step reports the unknown name in the run history rather than
 * acting on the wrong record; a bracketed condition value equals no field an
 * event carries, so a trigger never fires on a guess; and the Reference health
 * audit already reports a name that resolves to nothing.
 *
 * Only the fields a person types words into are read. Selectors, class names,
 * HTML and scripts use brackets as syntax and never hold a placeholder.
 */

/**
 * A bracketed placeholder inside a value. Not one followed by `(`, which is a
 * written link (`[our menu](https://…)`) rather than a gap, and never across a
 * line or longer than a phrase.
 */
export const AUTOMATION_PLACEHOLDER_PATTERN = /\[([^[\]\n]{1,120})\](?!\()/

/** The longest words a placeholder keeps. */
export const AUTOMATION_PLACEHOLDER_MAX_CHARS = 100

/** The words inside the first placeholder in a value, or `null` when it holds none. */
export function automationPlaceholderIn(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = AUTOMATION_PLACEHOLDER_PATTERN.exec(value)
  const words = match?.[1]?.trim()
  return words ? words : null
}

/**
 * `words` as a placeholder: on one line, without brackets of their own, cut
 * to a phrase. Empty words still make a placeholder, so a value that must be
 * supplied is never written as an empty string a validator would refuse.
 */
export function automationPlaceholder(words: string): string {
  const clean = words
    .replace(/[[\]\n\r]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, AUTOMATION_PLACEHOLDER_MAX_CHARS)
    .trim()
  return `[${clean || 'to fill in'}]`
}

/** What a placeholder stands in for, in the words the editor labels that field with. */
export type AutomationPlaceholderField =
  | 'condition'
  | 'list'
  | 'campaign'
  | 'workflow'
  | 'webhook'
  | 'dataset'
  | 'overlay'
  | 'subject'
  | 'body'
  | 'title'
  | 'message'
  | 'tag'

export interface AutomationPlaceholder {
  /** The 1-based step holding it; `null` for the trigger's own conditions. */
  step: number | null
  field: AutomationPlaceholderField
  /** The words inside the brackets. */
  text: string
}

/**
 * Each typed field a step type holds, and the placeholder field it reports
 * as. A step type absent here holds no field a person writes words into.
 */
export const AUTOMATION_PLACEHOLDER_FIELDS: Readonly<
  Partial<Record<HostActionStepType, ReadonlyArray<readonly [string, AutomationPlaceholderField]>>>
> = {
  enrollList: [['listName', 'list']],
  assignCampaign: [['campaignName', 'campaign']],
  runWorkflow: [['workflowName', 'workflow']],
  webhookPost: [['webhookName', 'webhook']],
  datasetAppend: [['datasetName', 'dataset']],
  updateDataset: [['datasetName', 'dataset']],
  showOverlay: [['overlayName', 'overlay']],
  sendEmail: [
    ['subject', 'subject'],
    ['body', 'body'],
  ],
  notifyAdmins: [
    ['title', 'title'],
    ['body', 'body'],
  ],
  siteAlert: [['message', 'message']],
  createCrmTask: [['title', 'title']],
  logCrmActivity: [['body', 'body']],
  addContactTag: [['tag', 'tag']],
}

/** The placeholders one step holds, in its fields' order. */
export function automationStepPlaceholders(
  step: HostActionStep,
  index: number,
): AutomationPlaceholder[] {
  const found: AutomationPlaceholder[] = []
  const number = index + 1
  for (const clause of step.when?.conditions ?? []) {
    const text = automationPlaceholderIn(clause?.value)
    if (text) found.push({ step: number, field: 'condition', text })
  }
  for (const [key, field] of AUTOMATION_PLACEHOLDER_FIELDS[step.type] ?? []) {
    const text = automationPlaceholderIn((step as unknown as Record<string, unknown>)[key])
    if (text) found.push({ step: number, field, text })
  }
  return found
}

/** Every placeholder an automation holds: its trigger's conditions first, then each step's. */
export function automationPlaceholders(
  action: Pick<HostAction, 'trigger' | 'steps'> | null | undefined,
): AutomationPlaceholder[] {
  if (!action) return []
  const found: AutomationPlaceholder[] = []
  for (const condition of normalizeTriggerConditions(action.trigger)) {
    const text = automationPlaceholderIn(condition?.value)
    if (text) found.push({ step: null, field: 'condition', text })
  }
  ;(action.steps ?? []).forEach((step, index) => {
    if (step) found.push(...automationStepPlaceholders(step, index))
  })
  return found
}

/** One placeholder as a person reads it: where it is, and what it stands in for. */
export function describeAutomationPlaceholder(placeholder: AutomationPlaceholder): string {
  const where = placeholder.step === null ? 'The trigger' : `Step ${placeholder.step}`
  const what: Record<AutomationPlaceholderField, string> = {
    condition: 'a condition value',
    list: 'the list',
    campaign: 'the campaign',
    workflow: 'the workflow',
    webhook: 'the webhook',
    dataset: 'the dataset',
    overlay: 'the popup or bar',
    subject: 'the subject',
    body: 'the text',
    title: 'the title',
    message: 'the message',
    tag: 'the tag',
  }
  return `${where}: ${what[placeholder.field]} (“${placeholder.text}”)`
}

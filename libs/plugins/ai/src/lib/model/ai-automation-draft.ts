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

import type {
  HostAction,
  HostActionStep,
  HostActionStepGuard,
  HostActionTriggerCondition,
} from '@aglyn/aglyn/app-utils/actions'
import {
  automationPlaceholder,
  automationPlaceholders,
  describeAutomationPlaceholder,
  type AutomationPlaceholder,
} from '@aglyn/aglyn/app-utils/automation-placeholders'
import type {
  AiAutomationAnswer,
  AiAutomationAnswerStep,
  AiAutomationCondition,
} from '../tools/ai-workflow-tool'

/**
 * An answer made into the automation the workflows plugin stores (AGL-2919).
 *
 * The answer names each record in WORDS. Here, in code and after the answer,
 * each is looked up among the site's own records: a list, a campaign, a
 * workflow, a webhook, a dataset, a form or a deal stage the words name
 * without doubt becomes that record's id; words that name none, or name more
 * than one, become a placeholder — the words in square brackets where the
 * record belongs — for the person to pick in the Actions editor. Nothing is
 * guessed, and the model never saw the records it was matched against beyond
 * what the site inventory already sends.
 */

/** One record a description may name. */
export interface AiAutomationNamedRecord {
  id: string
  name: string
}

/** A form, with the fields its submissions carry. */
export interface AiAutomationForm extends AiAutomationNamedRecord {
  fields: string[]
}

/** The site's records an automation's words are looked up among. */
export interface AiAutomationRecords {
  forms: AiAutomationForm[]
  datasets: AiAutomationNamedRecord[]
  lists: AiAutomationNamedRecord[]
  campaigns: AiAutomationNamedRecord[]
  workflows: AiAutomationNamedRecord[]
  webhooks: AiAutomationNamedRecord[]
  /** Every stage of every pipeline the site may see. */
  stages: AiAutomationNamedRecord[]
}

export function emptyAiAutomationRecords(): AiAutomationRecords {
  return { forms: [], datasets: [], lists: [], campaigns: [], workflows: [], webhooks: [], stages: [] }
}

/** Words that say nothing about which record is meant. */
const FILLER = new Set(['the', 'a', 'an', 'our', 'my', 'your', 'this', 'that', 'new', 'called', 'named'])

function tokens(value: string, noun: string): string[] {
  const nouns = new Set([noun, `${noun}s`])
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .filter((word) => !FILLER.has(word) && !nouns.has(word))
    .map((word) => (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
}

/**
 * The one record `words` name, or `null`: its id written whole; else the one
 * record whose name is the same words; else the one record whose name holds
 * every word, or whose every word the words hold. Two records that fit
 * equally well name neither — a placeholder is better than a coin toss.
 */
export function aiMatchNamedRecord<T extends AiAutomationNamedRecord>(
  words: string,
  records: readonly T[],
  noun: string,
): T | null {
  const wanted = words.trim()
  if (!wanted) return null
  const byId = records.filter((record) => record.id === wanted)
  if (byId.length === 1) return byId[0]
  const asked = tokens(wanted, noun)
  if (!asked.length) return null
  const same = (record: T) => {
    const name = tokens(record.name, noun)
    return name.length === asked.length && asked.every((word) => name.includes(word))
  }
  const exact = records.filter(same)
  if (exact.length) return exact.length === 1 ? exact[0] : null
  const within = records.filter((record) => {
    const name = tokens(record.name, noun)
    if (!name.length) return false
    const [small, large] = name.length <= asked.length ? [name, asked] : [asked, name]
    return small.every((word) => large.includes(word))
  })
  return within.length === 1 ? within[0] : null
}

/** A form by its id or its name, for a condition that names one. */
function formOf(value: string, forms: readonly AiAutomationForm[]): AiAutomationForm | null {
  return aiMatchNamedRecord(value, forms, 'form')
}

function conditionOf(
  condition: AiAutomationCondition,
  records: AiAutomationRecords,
): HostActionTriggerCondition {
  const { field, op, value } = condition
  if (op === 'notEmpty' || value === null) return { field, op }
  if (field === 'formId') {
    const form = formOf(value, records.forms)
    return { field, op, value: form ? form.id : automationPlaceholder(value) }
  }
  if (field === 'formName') {
    const form = formOf(value, records.forms)
    return { field, op, value: form ? form.name : automationPlaceholder(value) }
  }
  if (field === 'stageId' || field === 'previousStageId') {
    const stage = aiMatchNamedRecord(value, records.stages, 'stage')
    return { field, op, value: stage ? stage.id : automationPlaceholder(value) }
  }
  return { field, op, value }
}

function guardOf(
  when: AiAutomationCondition | null,
  records: AiAutomationRecords,
): { when?: HostActionStepGuard } {
  return when ? { when: { conditions: [conditionOf(when, records)] } } : {}
}

/** A named record as a step stores it: the id and the name, or a placeholder name and no id. */
function referenceOf(
  words: string | null,
  records: readonly AiAutomationNamedRecord[],
  noun: string,
): { id: string | null; name: string } {
  const record = aiMatchNamedRecord(words ?? '', records, noun)
  return record ? { id: record.id, name: record.name } : { id: null, name: automationPlaceholder(words ?? '') }
}

function stepOf(step: AiAutomationAnswerStep, records: AiAutomationRecords): HostActionStep {
  const guard = guardOf(step.when, records)
  switch (step.type) {
    case 'sendEmail':
      return {
        type: 'sendEmail',
        subject: step.subject ?? '',
        body: step.body ?? '',
        ...(step.toField ? { toField: step.toField } : {}),
        ...guard,
      }
    case 'notifyAdmins':
      return { type: 'notifyAdmins', title: step.title ?? '', ...guard }
    case 'enrollList': {
      const { id, name } = referenceOf(step.list, records.lists, 'list')
      return { type: 'enrollList', ...(id ? { listId: id } : {}), listName: name, ...guard }
    }
    case 'assignCampaign': {
      const { id, name } = referenceOf(step.campaign, records.campaigns, 'campaign')
      return { type: 'assignCampaign', ...(id ? { campaignId: id } : {}), campaignName: name, ...guard }
    }
    case 'runWorkflow': {
      const { id, name } = referenceOf(step.workflow, records.workflows, 'workflow')
      return { type: 'runWorkflow', ...(id ? { workflowId: id } : {}), workflowName: name, ...guard }
    }
    case 'webhookPost': {
      const { id, name } = referenceOf(step.webhook, records.webhooks, 'webhook')
      return { type: 'webhookPost', ...(id ? { webhookId: id } : {}), webhookName: name, ...guard }
    }
    case 'datasetAppend':
    case 'updateDataset': {
      const { id, name } = referenceOf(step.dataset, records.datasets, 'dataset')
      return { type: step.type, ...(id ? { datasetId: id } : {}), datasetName: name, ...guard }
    }
    case 'siteAlert':
      return { type: 'siteAlert', message: step.message ?? '', severity: step.severity ?? 'info', ...guard }
    case 'wait':
      return { type: 'wait', delayMinutes: step.minutes ?? 0, ...guard }
    case 'waitForEvent':
      return {
        type: 'waitForEvent',
        eventName: step.event ?? '',
        timeoutMinutes: step.minutes ?? 0,
        ...guard,
      }
    case 'exitFlow':
      return { type: 'exitFlow', ...guard }
    case 'setContactStage':
      return { type: 'setContactStage', lifecycleStage: step.stage ?? 'lead', ...guard }
    case 'addContactTag':
      return { type: 'addContactTag', tag: step.tag ?? '', ...guard }
    case 'assignContactOwner':
      return step.owner === 'round robin'
        ? { type: 'assignContactOwner', roundRobin: true, ...guard }
        : { type: 'assignContactOwner', ownerEmail: step.owner ?? '', ...guard }
    case 'createCrmTask':
      return {
        type: 'createCrmTask',
        title: step.title ?? '',
        kind: step.taskKind ?? 'todo',
        dueInDays: step.dueInDays ?? 0,
        ...guard,
      }
    case 'logCrmActivity':
      return { type: 'logCrmActivity', kind: step.activityKind ?? 'note', body: step.body ?? '', ...guard }
  }
}

/** The name an automation is drafted under when the answer gave none. */
export const AI_AUTOMATION_DEFAULT_NAME = 'New automation'

export interface AiAutomationDraft {
  /** The automation as the workflows plugin stores it: OFF. */
  action: HostAction
  /** What a person still has to supply before switching it on. */
  placeholders: AutomationPlaceholder[]
}

/** An answer as the automation to store, with every record it names looked up. */
export function aiAutomationDraft(
  answer: AiAutomationAnswer,
  records: AiAutomationRecords,
): AiAutomationDraft {
  const conditions = answer.trigger.conditions.map((condition) => conditionOf(condition, records))
  const action: HostAction = {
    name: answer.name || AI_AUTOMATION_DEFAULT_NAME,
    trigger: {
      event: answer.trigger.event,
      ...(conditions.length ? { conditions, combinator: answer.trigger.combinator } : {}),
    },
    steps: answer.steps.map((step) => stepOf(step, records)),
    enabled: false,
  }
  return { action, placeholders: automationPlaceholders(action) }
}

/**
 * What a drafted automation's output tells a person: that it is off, what to
 * fill in before switching it on, and what the answer said needs deciding.
 */
export function aiAutomationDraftNote(draft: AiAutomationDraft, notes: readonly string[]): string {
  const parts = ['It is off until you switch it on.']
  if (draft.placeholders.length) {
    parts.push(
      `Fill in ${draft.placeholders.length === 1 ? 'its placeholder' : `its ${draft.placeholders.length} placeholders`} first — ${draft.placeholders
        .map(describeAutomationPlaceholder)
        .join('; ')}.`,
    )
  } else {
    parts.push('Review its steps in the Actions editor, then switch it on from the list.')
  }
  parts.push(...notes)
  return parts.join(' ')
}

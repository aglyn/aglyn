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

import { validateHostAction } from '@aglyn/aglyn/app-utils/actions'
import { AI_AUTOMATION_STEP_TYPES } from './ai-workflow-job'
import {
  AI_AUTOMATION_DEFAULT_NAME,
  aiAutomationDraft,
  aiAutomationDraftNote,
  aiMatchNamedRecord,
  emptyAiAutomationRecords,
  type AiAutomationRecords,
} from './ai-automation-draft'
import type { AiAutomationAnswer, AiAutomationAnswerStep } from '../tools/ai-workflow-tool'

/**
 * An answer's words become the site's records here, in code (AGL-2919): the
 * one record the words name, or a placeholder where a person picks one.
 * Nothing is guessed, and what is stored is what the Actions editor saves.
 */

const NULL_STEP: Omit<AiAutomationAnswerStep, 'type'> = {
  when: null,
  list: null,
  campaign: null,
  workflow: null,
  webhook: null,
  dataset: null,
  subject: null,
  body: null,
  toField: null,
  title: null,
  message: null,
  severity: null,
  minutes: null,
  event: null,
  stage: null,
  tag: null,
  owner: null,
  taskKind: null,
  dueInDays: null,
  activityKind: null,
}

const step = (
  type: AiAutomationAnswerStep['type'],
  fields: Partial<AiAutomationAnswerStep> = {},
): AiAutomationAnswerStep => ({ type, ...NULL_STEP, ...fields })

function answer(patch: Partial<AiAutomationAnswer> = {}): AiAutomationAnswer {
  return {
    name: 'Welcome new sign-ups',
    trigger: { event: 'formSubmission', conditions: [], combinator: 'and' },
    steps: [],
    notes: [],
    unsupported: null,
    ...patch,
  }
}

const RECORDS: AiAutomationRecords = {
  forms: [
    { id: 'form-news', name: 'Newsletter sign-up', fields: ['email'] },
    { id: 'form-quote', name: 'Quote request', fields: ['email', 'budget'] },
  ],
  datasets: [{ id: 'ds-leads', name: 'Leads' }],
  lists: [
    { id: 'list-news', name: 'Newsletter' },
    { id: 'list-vip', name: 'VIP customers' },
    { id: 'list-lapsed', name: 'Lapsed customers' },
  ],
  campaigns: [{ id: 'cmp-spring', name: 'Spring sale' }],
  workflows: [{ id: 'wf-quote', name: 'Quote calculator' }],
  webhooks: [{ id: 'hook-zap', name: 'Zapier' }],
  stages: [
    { id: 'stage-new', name: 'New' },
    { id: 'stage-proposal', name: 'Proposal sent' },
  ],
}

describe('aiMatchNamedRecord', () => {
  const lists = RECORDS.lists

  it('finds a record by its id written whole', () => {
    expect(aiMatchNamedRecord(' list-vip ', lists, 'list')?.name).toBe('VIP customers')
  })

  it('finds the record whose name is the same words, whatever the case, punctuation, plural or filler', () => {
    expect(aiMatchNamedRecord('the newsletter list', lists, 'list')?.id).toBe('list-news')
    expect(aiMatchNamedRecord('Our NEWSLETTERS', lists, 'list')?.id).toBe('list-news')
    expect(aiMatchNamedRecord('vip-customers', lists, 'list')?.id).toBe('list-vip')
  })

  it('finds the one record whose name holds every word, or whose every word the words hold', () => {
    expect(aiMatchNamedRecord('VIP', lists, 'list')?.id).toBe('list-vip')
    expect(aiMatchNamedRecord('spring sale 2026', RECORDS.campaigns, 'campaign')?.id).toBe('cmp-spring')
  })

  it('names nothing when two records fit, or none does, or the words say nothing', () => {
    expect(aiMatchNamedRecord('customers', lists, 'list')).toBeNull()
    expect(aiMatchNamedRecord('winter sale', RECORDS.campaigns, 'campaign')).toBeNull()
    expect(aiMatchNamedRecord('the list', lists, 'list')).toBeNull()
    expect(aiMatchNamedRecord('  ', lists, 'list')).toBeNull()
    // An exact name wins over one that merely holds the words.
    expect(
      aiMatchNamedRecord('customers', [...lists, { id: 'list-customers', name: 'Customers' }], 'list')?.id,
    ).toBe('list-customers')
  })
})

describe('aiAutomationDraft', () => {
  it('stores every step the tool offers the way the Actions editor saves it, and the editor’s validator accepts it', () => {
    const steps: AiAutomationAnswerStep[] = [
      step('sendEmail', { subject: 'Welcome', body: 'Thanks for signing up.', toField: 'workEmail' }),
      step('notifyAdmins', { title: 'A new lead' }),
      step('enrollList', { list: 'newsletter' }),
      step('assignCampaign', { campaign: 'spring sale' }),
      step('runWorkflow', { workflow: 'quote calculator' }),
      step('datasetAppend', { dataset: 'leads' }),
      step('updateDataset', { dataset: 'leads' }),
      step('webhookPost', { webhook: 'zapier' }),
      step('siteAlert', { message: 'Thanks!', severity: 'success' }),
      step('wait', { minutes: 60 }),
    ]
    const more: AiAutomationAnswerStep[] = [
      step('waitForEvent', { event: 'booking', minutes: 1440 }),
      step('exitFlow', { when: { field: '_waitTimedOut', op: 'notEmpty', value: null } }),
      step('setContactStage', { stage: 'lead' }),
      step('addContactTag', { tag: 'newsletter' }),
      step('assignContactOwner', { owner: 'round robin' }),
      step('assignContactOwner', { owner: 'sam@example.test' }),
      step('createCrmTask', { title: 'Call them', taskKind: 'call', dueInDays: 2 }),
      step('logCrmActivity', { activityKind: 'note', body: 'Signed up for the newsletter' }),
    ]
    const first = aiAutomationDraft(answer({ steps }), RECORDS)
    const second = aiAutomationDraft(answer({ trigger: { event: 'lead', conditions: [], combinator: 'and' }, steps: more }), RECORDS)
    expect(first.action.steps).toEqual([
      { type: 'sendEmail', subject: 'Welcome', body: 'Thanks for signing up.', toField: 'workEmail' },
      { type: 'notifyAdmins', title: 'A new lead' },
      { type: 'enrollList', listId: 'list-news', listName: 'Newsletter' },
      { type: 'assignCampaign', campaignId: 'cmp-spring', campaignName: 'Spring sale' },
      { type: 'runWorkflow', workflowId: 'wf-quote', workflowName: 'Quote calculator' },
      { type: 'datasetAppend', datasetId: 'ds-leads', datasetName: 'Leads' },
      { type: 'updateDataset', datasetId: 'ds-leads', datasetName: 'Leads' },
      { type: 'webhookPost', webhookId: 'hook-zap', webhookName: 'Zapier' },
      { type: 'siteAlert', message: 'Thanks!', severity: 'success' },
      { type: 'wait', delayMinutes: 60 },
    ])
    expect(second.action.steps).toEqual([
      { type: 'waitForEvent', eventName: 'booking', timeoutMinutes: 1440 },
      { type: 'exitFlow', when: { conditions: [{ field: '_waitTimedOut', op: 'notEmpty' }] } },
      { type: 'setContactStage', lifecycleStage: 'lead' },
      { type: 'addContactTag', tag: 'newsletter' },
      { type: 'assignContactOwner', roundRobin: true },
      { type: 'assignContactOwner', ownerEmail: 'sam@example.test' },
      { type: 'createCrmTask', title: 'Call them', kind: 'call', dueInDays: 2 },
      { type: 'logCrmActivity', kind: 'note', body: 'Signed up for the newsletter' },
    ])
    const covered = new Set([...first.action.steps, ...second.action.steps].map((one) => one.type))
    expect([...covered].sort()).toEqual([...AI_AUTOMATION_STEP_TYPES].sort())
    expect([validateHostAction(first.action), validateHostAction(second.action)]).toEqual([null, null])
    expect([first.placeholders, second.placeholders]).toEqual([[], []])
  })

  it('keeps words that name no record, or more than one, as placeholders the editor still saves', () => {
    const draft = aiAutomationDraft(
      answer({
        trigger: {
          event: 'formSubmission',
          conditions: [{ field: 'formName', op: 'equals', value: 'booking request' }],
          combinator: 'and',
        },
        steps: [
          step('enrollList', { list: 'customers' }),
          step('assignCampaign', { campaign: 'winter [sale]' }),
          step('sendEmail', { subject: 'Welcome', body: 'Call [your phone number].', when: { field: 'plan', op: 'equals', value: 'pro' } }),
        ],
      }),
      RECORDS,
    )
    expect(draft.action.trigger.conditions).toEqual([{ field: 'formName', op: 'equals', value: '[booking request]' }])
    expect(draft.action.steps).toEqual([
      { type: 'enrollList', listName: '[customers]' },
      { type: 'assignCampaign', campaignName: '[winter sale]' },
      {
        type: 'sendEmail',
        subject: 'Welcome',
        body: 'Call [your phone number].',
        when: { conditions: [{ field: 'plan', op: 'equals', value: 'pro' }] },
      },
    ])
    expect(validateHostAction(draft.action)).toBeNull()
    expect(draft.placeholders).toEqual([
      { step: null, field: 'condition', text: 'booking request' },
      { step: 1, field: 'list', text: 'customers' },
      { step: 2, field: 'campaign', text: 'winter sale' },
      { step: 3, field: 'body', text: 'your phone number' },
    ])
  })

  it('names a form by the value its condition reads, and a deal stage by its id', () => {
    const contact = aiAutomationDraft(
      answer({
        trigger: {
          event: 'contactCreated',
          conditions: [{ field: 'formId', op: 'equals', value: 'quote request' }],
          combinator: 'and',
        },
        steps: [step('addContactTag', { tag: 'quote' })],
      }),
      RECORDS,
    )
    expect(contact.action.trigger.conditions).toEqual([{ field: 'formId', op: 'equals', value: 'form-quote' }])
    const deal = aiAutomationDraft(
      answer({
        trigger: {
          event: 'dealStageChanged',
          conditions: [
            { field: 'stageId', op: 'equals', value: 'proposal sent' },
            { field: 'previousStageId', op: 'equals', value: 'negotiation' },
            { field: 'title', op: 'contains', value: 'website' },
          ],
          combinator: 'or',
        },
        steps: [step('notifyAdmins', { title: 'A proposal went out' })],
      }),
      RECORDS,
    )
    expect(deal.action.trigger).toEqual({
      event: 'dealStageChanged',
      conditions: [
        { field: 'stageId', op: 'equals', value: 'stage-proposal' },
        { field: 'previousStageId', op: 'equals', value: '[negotiation]' },
        { field: 'title', op: 'contains', value: 'website' },
      ],
      combinator: 'or',
    })
  })

  it('is always written off, under a name, with no conditions left empty', () => {
    const draft = aiAutomationDraft(answer({ name: '', steps: [step('notifyAdmins', { title: 'Hi' })] }), emptyAiAutomationRecords())
    expect(draft.action).toEqual({
      name: AI_AUTOMATION_DEFAULT_NAME,
      trigger: { event: 'formSubmission' },
      steps: [{ type: 'notifyAdmins', title: 'Hi' }],
      enabled: false,
    })
  })
})

describe('aiAutomationDraftNote', () => {
  const draftOf = (steps: AiAutomationAnswerStep[]) => aiAutomationDraft(answer({ steps }), RECORDS)

  it('says the automation is off, and what to fill in before switching it on', () => {
    expect(aiAutomationDraftNote(draftOf([step('enrollList', { list: 'newsletter' })]), [])).toBe(
      'It is off until you switch it on. Review its steps in the Actions editor, then switch it on from the list.',
    )
    expect(aiAutomationDraftNote(draftOf([step('enrollList', { list: 'customers' })]), ['Pick who calls new leads.'])).toBe(
      'It is off until you switch it on. Fill in its placeholder first — Step 1: the list (“customers”). Pick who calls new leads.',
    )
    expect(
      aiAutomationDraftNote(
        draftOf([step('enrollList', { list: 'customers' }), step('addContactTag', { tag: '[segment]' })]),
        [],
      ),
    ).toBe(
      'It is off until you switch it on. Fill in its 2 placeholders first — Step 1: the list (“customers”); Step 2: the tag (“segment”).',
    )
  })
})

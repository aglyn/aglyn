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
  ACTION_MAX_CONDITIONS,
  ACTION_MAX_STEPS,
  CLIENT_ACTION_STEP_TYPES,
  FLOW_WAIT_MAX_MINUTES,
  HOST_ACTION_STEP_LABELS,
} from '@aglyn/aglyn/app-utils/actions'
import { CRM_TASK_MAX_DUE_DAYS } from '@aglyn/aglyn/app-utils/crm'
import { HOST_EVENT_TYPES } from '@aglyn/aglyn/app-utils/workflows'
import { AI_AUTOMATION_STEP_TYPES, AI_AUTOMATION_UNSUPPORTED } from '../model/ai-workflow-job'
import {
  AI_AUTOMATION_NAME_MAX_CHARS,
  AI_AUTOMATION_NOTES_MAX,
  AI_AUTOMATION_TOOL_NAME,
  AI_WORKFLOW_EXPLANATION_TOOL_NAME,
  AI_WORKFLOW_LINE_MAX_CHARS,
  AI_WORKFLOW_POINTS_MAX,
  AI_WORKFLOW_SUGGESTIONS_MAX,
  aiAutomationTool,
  aiWorkflowExplanationTool,
  lifecycleStageOf,
  readAiAutomationAnswer,
  readAiWorkflowExplanation,
} from './ai-workflow-tool'

/**
 * The automation tool is the Actions editor's vocabulary, and its reader is
 * where an answer is held to it and to what the workspace can run (AGL-2919).
 * Every refusal names the field, so the one re-ask can fix it.
 */

type Schema = Record<string, any>

function objectSchemas(node: unknown, found: Schema[] = []): Schema[] {
  if (!node || typeof node !== 'object') return found
  const record = node as Schema
  if (record['type'] === 'object') found.push(record)
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) value.forEach((entry) => objectSchemas(entry, found))
    else objectSchemas(value, found)
  }
  return found
}

const ALL = { crm: true, webhooks: true, bookings: true }
const NONE = { crm: false, webhooks: false, bookings: false }

const NULL_STEP = {
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

const step = (type: string, fields: Record<string, unknown> = {}) => ({ type, ...NULL_STEP, ...fields })

function answer(patch: Record<string, unknown> = {}) {
  return {
    name: 'Welcome new sign-ups',
    trigger: { event: 'formSubmission', conditions: [], combinator: 'and' },
    steps: [step('enrollList', { list: 'newsletter' })],
    notes: [],
    unsupported: null,
    ...patch,
  }
}

const codes = (result: { violations: Array<{ code: string }> }) => result.violations.map((one) => one.code)
const messages = (result: { violations: Array<{ message: string }> }) => result.violations.map((one) => one.message)

describe('the tools', () => {
  it('are strict: every object forbids extra keys and requires every key it has', () => {
    for (const tool of [aiAutomationTool(), aiWorkflowExplanationTool()]) {
      expect(tool.strict).toBe(true)
      const objects = objectSchemas(tool.inputSchema)
      expect(objects.length).toBeGreaterThanOrEqual(1)
      for (const object of objects) {
        expect(object['additionalProperties']).toBe(false)
        expect([...object['required']].sort()).toEqual(Object.keys(object['properties']).sort())
      }
    }
    expect(objectSchemas(aiAutomationTool().inputSchema)).toHaveLength(5)
    expect([aiAutomationTool().name, aiWorkflowExplanationTool().name]).toEqual([
      AI_AUTOMATION_TOOL_NAME,
      AI_WORKFLOW_EXPLANATION_TOOL_NAME,
    ])
  })

  it('are the same bytes on every call, so they stay inside the cached prefix', () => {
    expect(JSON.stringify(aiAutomationTool())).toBe(JSON.stringify(aiAutomationTool()))
    expect(JSON.stringify(aiWorkflowExplanationTool())).toBe(JSON.stringify(aiWorkflowExplanationTool()))
  })

  it('offers every host event as a trigger, and only the steps that act on the person an event names', () => {
    const properties = aiAutomationTool().inputSchema['properties'] as Schema
    expect(properties['trigger'].properties.event.enum).toEqual([...HOST_EVENT_TYPES])
    expect(properties['steps'].items.properties.type.enum).toEqual([...AI_AUTOMATION_STEP_TYPES])
    expect(properties['unsupported'].anyOf[0].enum).toEqual([...AI_AUTOMATION_UNSUPPORTED])
    for (const type of AI_AUTOMATION_STEP_TYPES) expect(HOST_ACTION_STEP_LABELS[type]).toBeTruthy()
    // The on-page steps need a selector on a page a description cannot name.
    // A site alert is the one the server also runs: it answers the visitor
    // whose request raised the event.
    const onPage = AI_AUTOMATION_STEP_TYPES.filter((type) => CLIENT_ACTION_STEP_TYPES.has(type))
    expect(onPage).toEqual(['siteAlert'])
  })
})

describe('reading an automation', () => {
  it('reads an answer into the automation, with the defaults a step leaves out', () => {
    const read = readAiAutomationAnswer(
      answer({
        name: `  ${'A very long automation name '.repeat(4)}`,
        trigger: {
          event: 'contactStageChanged',
          conditions: [{ field: 'lifecycleStage', op: 'equals', value: 'Sales qualified' }],
          combinator: 'or',
        },
        steps: [
          step('sendEmail', { subject: 'Hello', body: 'Thanks [first name].', toField: 'email' }),
          step('siteAlert', { message: 'Thanks!', severity: 'loud' }),
          step('assignContactOwner', { owner: '  Round-Robin ' }),
        ],
        notes: ['Pick who follows up.', '<script>alert(1)</script>', 'A', 'B', 'C'],
      }),
      ALL,
    )
    expect(read.violations).toEqual([])
    expect(read.value).toEqual({
      name: 'A very long automation name A very long automation name A very long automation name A very long automation name'.slice(
        0,
        AI_AUTOMATION_NAME_MAX_CHARS,
      ),
      trigger: {
        event: 'contactStageChanged',
        conditions: [{ field: 'lifecycleStage', op: 'equals', value: 'sales-qualified' }],
        combinator: 'or',
      },
      steps: [
        step('sendEmail', { subject: 'Hello', body: 'Thanks [first name].' }),
        step('siteAlert', { message: 'Thanks!', severity: 'info' }),
        step('assignContactOwner', { owner: 'round robin' }),
      ],
      notes: ['Pick who follows up.', 'A', 'B'],
      unsupported: null,
    })
    expect(read.value?.notes).toHaveLength(AI_AUTOMATION_NOTES_MAX)
  })

  it('refuses a trigger that is not a host event, and a step the tool does not offer', () => {
    expect(codes(readAiAutomationAnswer(answer({ trigger: { event: 'formSubmitted', conditions: [] } }), ALL))).toEqual([
      'automation-trigger',
    ])
    const onPage = readAiAutomationAnswer(answer({ steps: [step('runJs')] }), ALL)
    expect(codes(onPage)).toEqual(['automation-step-type'])
    expect(onPage.value).toBeNull()
    expect(codes(readAiAutomationAnswer({ name: 'x' }, ALL))).toEqual(['automation-shape'])
    expect(codes(readAiAutomationAnswer(answer({ steps: [] }), ALL))).toEqual(['automation-shape'])
  })

  it('refuses a trigger or a step the workspace cannot run, saying what to do instead', () => {
    const booking = readAiAutomationAnswer(answer({ trigger: { event: 'booking', conditions: [] } }), NONE)
    expect(codes(booking)).toEqual(['automation-plan'])
    expect(messages(booking)[0]).toBe(
      'The trigger "New booking" needs bookings, which this workspace does not have. Pick another trigger, or answer with unsupported "needs-bookings".',
    )
    const crm = readAiAutomationAnswer(answer({ steps: [step('addContactTag', { tag: 'vip' })] }), NONE)
    expect(messages(crm)).toEqual([
      'Step 1 (Tag the contact) needs the CRM, which this workspace does not have. Leave it out, or answer with unsupported "needs-crm".',
    ])
    expect(readAiAutomationAnswer(answer({ steps: [step('addContactTag', { tag: 'vip' })] }), ALL).violations).toEqual([])
  })

  it('reads a condition only over the fields its trigger carries', () => {
    const carried = readAiAutomationAnswer(
      answer({ trigger: { event: 'dealWon', conditions: [{ field: 'formName', op: 'equals', value: 'x' }] } }),
      ALL,
    )
    expect(codes(carried)).toEqual(['automation-condition'])
    expect(messages(carried)[0]).toContain('The trigger "Deal won" does not carry "formName". It carries: dealId, title,')
    // A form submission carries every field its form collects, but names its
    // form by name: a form's id is what a contact created by a form carries.
    expect(
      readAiAutomationAnswer(
        answer({ trigger: { event: 'formSubmission', conditions: [{ field: 'budget', op: 'notEmpty', value: null }] } }),
        ALL,
      ).value?.trigger.conditions,
    ).toEqual([{ field: 'budget', op: 'notEmpty', value: null }])
    expect(
      codes(
        readAiAutomationAnswer(
          answer({ trigger: { event: 'formSubmission', conditions: [{ field: 'formId', op: 'equals', value: 'f1' }] } }),
          ALL,
        ),
      ),
    ).toEqual(['automation-condition'])
    expect(
      readAiAutomationAnswer(
        answer({ trigger: { event: 'contactCreated', conditions: [{ field: 'formId', op: 'equals', value: 'f1' }] } }),
        ALL,
      ).violations,
    ).toEqual([])
    // A value is needed to compare against, and a lifecycle stage is one the CRM has.
    expect(
      messages(
        readAiAutomationAnswer(
          answer({ trigger: { event: 'lead', conditions: [{ field: 'source', op: 'equals', value: ' ' }] } }),
          ALL,
        ),
      ),
    ).toEqual(['The condition on "source" needs the value it compares against.'])
    expect(
      codes(
        readAiAutomationAnswer(
          answer({
            trigger: { event: 'contactCreated', conditions: [{ field: 'lifecycleStage', op: 'equals', value: 'hot' }] },
          }),
          ALL,
        ),
      ),
    ).toEqual(['automation-condition'])
  })

  it('lets only a step’s own condition read whether the wait before it ran out of time', () => {
    const timedOut = { field: '_waitTimedOut', op: 'notEmpty', value: null }
    expect(
      readAiAutomationAnswer(
        answer({
          trigger: { event: 'lead', conditions: [] },
          steps: [step('waitForEvent', { event: 'booking', minutes: 1440 }), step('exitFlow', { when: timedOut })],
        }),
        ALL,
      ).value?.steps[1].when,
    ).toEqual(timedOut)
    expect(
      codes(readAiAutomationAnswer(answer({ trigger: { event: 'lead', conditions: [timedOut] } }), ALL)),
    ).toEqual(['automation-condition'])
  })

  it('holds each step to the fields it needs, in the bounds the executor keeps', () => {
    const cases: Array<[ReturnType<typeof step>, string]> = [
      [step('sendEmail', { subject: 'Hi' }), 'Step 1 (Send an email) needs body.'],
      [step('enrollList'), 'Step 1 (Enroll in a list) needs list.'],
      [step('wait', { minutes: 0 }), `Step 1 (Wait) needs minutes, a whole number from 1 to ${FLOW_WAIT_MAX_MINUTES}.`],
      [step('wait', { minutes: 1.5 }), `Step 1 (Wait) needs minutes, a whole number from 1 to ${FLOW_WAIT_MAX_MINUTES}.`],
      [step('waitForEvent', { minutes: 60, event: 'somethingElse' }), 'Step 1 (Wait for something to happen) needs the event it waits for.'],
      [step('setContactStage', { stage: 'Lead' }), 'Step 1 (Set the contact’s lifecycle stage) needs the lifecycle stage to set.'],
      [
        step('createCrmTask', { title: 'Call', taskKind: 'call', dueInDays: CRM_TASK_MAX_DUE_DAYS + 1 }),
        `Step 1 (Create a CRM task) needs dueInDays, from 0 to ${CRM_TASK_MAX_DUE_DAYS}.`,
      ],
      [step('logCrmActivity', { body: 'Signed up', activityKind: 'visit' }), 'Step 1 (Log a CRM activity) needs activityKind.'],
      [step('addContactTag', { tag: 'x'.repeat(61) }), 'Step 1 (Tag the contact): tag is longer than 60 characters.'],
    ]
    for (const [raw, message] of cases) {
      expect([raw.type, messages(readAiAutomationAnswer(answer({ steps: [raw] }), ALL))]).toEqual([raw.type, [message]])
    }
  })

  it('takes an owner as round robin or an address, and a teammate named without one is a note', () => {
    const owner = (value: string) => readAiAutomationAnswer(answer({ steps: [step('assignContactOwner', { owner: value })] }), ALL)
    expect(owner('sam@example.test').value?.steps[0].owner).toBe('sam@example.test')
    expect(codes(owner('Sam from sales'))).toEqual(['automation-owner'])
  })

  it('refuses markup in anything a person reads', () => {
    const read = readAiAutomationAnswer(
      answer({ steps: [step('sendEmail', { subject: 'Hi', body: 'Click <img src=x onerror=alert(1)>' })] }),
      ALL,
    )
    expect(codes(read)).toEqual(['automation-markup'])
    expect(readAiAutomationAnswer(answer({ steps: [step('notifyAdmins', { title: 'New lead [name]' })] }), ALL).violations).toEqual([])
  })

  it('refuses more steps or conditions than an automation holds', () => {
    const many = Array.from({ length: ACTION_MAX_STEPS + 1 }, () => step('notifyAdmins', { title: 'Hi' }))
    expect(codes(readAiAutomationAnswer(answer({ steps: many }), ALL))).toEqual(['automation-too-many-steps'])
    const conditions = Array.from({ length: ACTION_MAX_CONDITIONS + 1 }, () => ({ field: 'path', op: 'contains', value: '/' }))
    expect(codes(readAiAutomationAnswer(answer({ trigger: { event: 'pageView', conditions } }), ALL))).toEqual([
      'automation-too-many-conditions',
    ])
  })

  it('takes a reason nothing was drafted only from the reasons offered, and never one the workspace disproves', () => {
    const noTrigger = readAiAutomationAnswer(
      answer({ trigger: { event: 'dealWon', conditions: [{ field: 'x', op: 'notEmpty', value: null }] }, steps: [], unsupported: 'no-trigger' }),
      NONE,
    )
    expect(noTrigger.violations).toEqual([])
    expect(noTrigger.value).toEqual({
      name: 'Welcome new sign-ups',
      trigger: { event: HOST_EVENT_TYPES[0], conditions: [], combinator: 'and' },
      steps: [],
      notes: [],
      unsupported: 'no-trigger',
    })
    expect(codes(readAiAutomationAnswer(answer({ unsupported: 'too-hard' }), ALL))).toEqual(['automation-shape'])
    expect(messages(readAiAutomationAnswer(answer({ unsupported: 'needs-webhooks' }), ALL))).toEqual([
      'This workspace has webhooks: build the automation with it.',
    ])
    expect(readAiAutomationAnswer(answer({ unsupported: 'needs-webhooks' }), NONE).value?.unsupported).toBe(
      'needs-webhooks',
    )
  })

  it('reads a lifecycle stage by its id or its label', () => {
    expect([lifecycleStageOf('Marketing qualified'), lifecycleStageOf(' LEAD '), lifecycleStageOf('warm')]).toEqual([
      'marketing-qualified',
      'lead',
      null,
    ])
  })
})

describe('reading an explanation', () => {
  it('keeps a summary, and at most so many points and suggestions, each cut to a line', () => {
    const read = readAiWorkflowExplanation({
      summary: '  It welcomes new sign-ups.  ',
      points: Array.from({ length: AI_WORKFLOW_POINTS_MAX + 2 }, (_, index) => `Point ${index + 1}`),
      suggestions: ['y'.repeat(AI_WORKFLOW_LINE_MAX_CHARS + 50), '', 7, ...Array.from({ length: 5 }, () => 'Check it')],
    })
    expect(read.violations).toEqual([])
    expect(read.value?.summary).toBe('It welcomes new sign-ups.')
    expect(read.value?.points).toHaveLength(AI_WORKFLOW_POINTS_MAX)
    expect(read.value?.suggestions).toHaveLength(AI_WORKFLOW_SUGGESTIONS_MAX)
    expect(read.value?.suggestions[0]).toHaveLength(AI_WORKFLOW_LINE_MAX_CHARS)
  })

  it('refuses an explanation with no summary, with markup, or naming an address', () => {
    expect(codes(readAiWorkflowExplanation({ summary: ' ', points: [], suggestions: [] }))).toEqual(['explanation-shape'])
    expect(
      codes(readAiWorkflowExplanation({ summary: 'It runs.', points: ['<iframe src="x">'], suggestions: [] })),
    ).toEqual(['explanation-markup'])
    expect(
      codes(readAiWorkflowExplanation({ summary: 'It emails jane@example.test.', points: [], suggestions: [] })),
    ).toEqual(['explanation-address'])
  })
})

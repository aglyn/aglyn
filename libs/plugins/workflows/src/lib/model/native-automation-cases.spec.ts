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

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  actionRunResult,
  actionRunSummary,
  runTriggeredByLabel,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import {
  describeInteractionPlaceholder,
  interactionPlaceholders,
} from '@aglyn/aglyn/app-utils/draft-placeholders'
import {
  CLIENT_ACTION_STEP_TYPES,
  ELEMENT_SCOPED_SITE_EVENTS,
  SITE_EVENT_TYPES,
  siteInteractionDocument,
  triggerFilterProblem,
} from '@aglyn/aglyn/app-utils/site-interactions'
import {
  HOST_ACTION_STEP_LABELS,
  SEND_EMAIL_REPLY_INELIGIBLE_REASONS,
  sendEmailReplyIneligibility,
  stepRunsAfterWait,
  validateHostAction,
} from './host-actions'
import {
  ORG_AUTOMATION_STEP_TYPES,
  ORG_AUTOMATION_TRIGGER_EVENTS,
  orgAutomationRunsOnHost,
  orgAutomationStopReason,
  readOrgAutomation,
} from './org-automations'
import {
  WORKFLOW_ACTION_STEP_TYPES,
  validateWorkflowSteps,
  workflowFunctionCalls,
} from '../engine/workflow-steps'

/*
 * THE AUTOMATION RULES THE NATIVE APPS REPLAY (AGL-3670).
 *
 * The native Automation screens validate an action, a workflow and an org
 * automation before they write, exactly as the console's editors do. The
 * modules that hold those rules reach core's `site-interactions`, which also
 * carries the client-step sanitizers (HTML, analytics), so they cannot go on
 * the native generators' pure list. Instead this spec runs the console's own
 * functions over the inputs below and holds their answers in
 * `libs/native/contracts/automation-cases.generated.json`, which the Swift and
 * Kotlin ports replay in their unit tests. A rule change here reds this spec
 * until the fixture is rewritten (`AGLYN_WRITE_NATIVE_CASES=1`), and the
 * rewritten fixture reds the native ports until they follow.
 */

const FIXTURE = join(
  __dirname,
  '../../../../../native/contracts/automation-cases.generated.json',
)

const formTrigger = { event: 'formSubmission' }
const alert = { type: 'siteAlert', message: 'Thanks!', severity: 'success' }

const ACTIONS: unknown[] = [
  { name: '', trigger: formTrigger, steps: [alert] },
  { name: 'A', trigger: { event: '' }, steps: [alert] },
  { name: 'A', trigger: { event: 'x' }, steps: [alert] },
  { name: 'A', trigger: { event: 'elementClick' }, steps: [alert] },
  { name: 'A', trigger: { event: 'elementClick', selector: '#buy' }, steps: [alert] },
  { name: 'A', trigger: { event: 'scrollDepth' }, steps: [alert] },
  { name: 'A', trigger: { event: 'timeOnPage', threshold: 0 }, steps: [alert] },
  { name: 'A', trigger: { event: 'scrollDepth', threshold: 50 }, steps: [alert] },
  { name: 'A', trigger: { event: 'pageVisit', cooldownMinutes: 0 }, steps: [alert] },
  { name: 'A', trigger: { event: 'formSubmission', filter: 'a == b' }, steps: [alert] },
  { name: 'A', trigger: { event: 'formSubmission', filter: 'subscribe +' }, steps: [alert] },
  { name: 'A', trigger: { event: 'formSubmission', filter: 'subscribe' }, steps: [alert] },
  { name: 'A', trigger: { ...formTrigger, combinator: 'xor' }, steps: [alert] },
  { name: 'A', trigger: { ...formTrigger, conditions: [{ field: '', op: 'equals', value: 'x' }] }, steps: [alert] },
  { name: 'A', trigger: { ...formTrigger, conditions: [{ field: 'a', op: 'equals', value: '' }] }, steps: [alert] },
  { name: 'A', trigger: { ...formTrigger, conditions: [{ field: 'a', op: 'notEmpty' }, { field: 'b', op: 'contains', value: ' ' }] }, steps: [alert] },
  { name: 'A', trigger: { ...formTrigger, conditions: [{ field: 'a', op: 'gt', value: '1' }] }, steps: [alert] },
  {
    name: 'A',
    trigger: {
      ...formTrigger,
      conditions: Array.from({ length: 6 }, () => ({ field: 'a', op: 'notEmpty' })),
    },
    steps: [alert],
  },
  { name: 'A', trigger: formTrigger, steps: [] },
  { name: 'A', trigger: formTrigger, steps: Array.from({ length: 11 }, () => alert) },
  { name: 'A', trigger: formTrigger, steps: [{ ...alert, message: ' ' }] },
  { name: 'A', trigger: formTrigger, steps: [{ ...alert, when: { conditions: [{ field: '', op: 'notEmpty' }] } }] },
  { name: 'A', trigger: formTrigger, steps: [{ ...alert, when: { conditions: [{ field: 'x', op: 'equals' }] } }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'runWorkflow', workflowName: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'runWorkflow', workflowName: 'Score' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'customEvent', eventName: 'x' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'customEvent', eventName: 'lead-scored' }] },
  { name: 'A', trigger: { event: 'lead-scored' }, steps: [alert] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'datasetAppend', datasetName: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'datasetAppend', datasetId: 'd1' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'updateDataset', datasetId: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'webhookPost', webhookName: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'sendEmail', subject: '', body: 'x' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'sendEmail', subject: 'Hi', body: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'sendEmail', subject: 'Hi', body: 'There' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'sendEmail', subject: 'Hi', body: 'There', transactional: true }] },
  { name: 'A', trigger: { event: 'dealWon' }, steps: [{ type: 'sendEmail', subject: 'Hi', body: 'There', transactional: true }] },
  {
    name: 'A',
    trigger: formTrigger,
    steps: [{ type: 'wait', delayMinutes: 60 }, { type: 'sendEmail', subject: 'Hi', body: 'There', transactional: true }],
  },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'sendEmail', subject: 'Hi', body: 'B', topicId: 't1', transactional: true }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'sendEmail', subject: 'Hi', body: 'B', toField: 'manager', transactional: true }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'notifyAdmins', title: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'enrollList', listId: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'assignCampaign', campaignId: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'wait', delayMinutes: 0 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'wait', delayMinutes: 1440 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'wait', delayMinutes: 200000 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'waitForEvent', eventName: '', timeoutMinutes: 60 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'waitForEvent', eventName: 'booking', timeoutMinutes: 0 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'waitForEvent', eventName: 'booking', timeoutMinutes: 4320 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'exitFlow' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'setContactStage', lifecycleStage: 'customer' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'setContactStage', lifecycleStage: 'nope' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'addContactTag', tag: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'addContactTag', tag: 'x'.repeat(61) }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'addContactTag', tag: 'vip' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'assignContactOwner', ownerEmail: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'assignContactOwner', ownerEmail: 'a@b.co', roundRobin: true }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'assignContactOwner', roundRobin: true }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'assignContactOwner', ownerEmail: 'a@b.co' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'createCrmTask', title: '', kind: 'call', dueInDays: 1 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'createCrmTask', title: 'Call', kind: 'nope', dueInDays: 1 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'createCrmTask', title: 'Call', kind: 'call', dueInDays: 400 }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'createCrmTask', title: 'Call', kind: 'call', dueInDays: 1, priority: 'urgent' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'createCrmTask', title: 'Call', kind: 'call', dueInDays: 1, priority: 'high' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'logCrmActivity', kind: 'note', body: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'logCrmActivity', kind: 'note', body: 'x', direction: 'inbound' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'logCrmActivity', kind: 'call', body: 'x', direction: 'internal' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'logCrmActivity', kind: 'email', body: 'x', direction: 'internal' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'logCrmActivity', kind: 'nope', body: 'x' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'addClass', selector: '', className: 'x' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'showElement', selector: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'redirect', url: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'redirect', url: 'https://example.com' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'showOverlay', overlayId: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'scrollTo', selector: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'trackGaEvent', eventName: '' }] },
  { name: 'A', trigger: formTrigger, steps: [{ type: 'setAttribute', selector: '#a', attribute: 'onclick', value: 'x' }] },
]

const WORKFLOW_STEPS: unknown[] = [
  [],
  [{ functionName: 'double', args: ['1'] }],
  [{ type: 'sendEmail', subject: '', body: '' }],
  [{ functionName: 'double', args: ['1'] }, { type: 'notifyAdmins', title: '' }],
  [{ type: 'redirect', url: 'https://example.com' }],
  [{ type: 'siteAlert', message: 'Hi', severity: 'info' }],
  [{ type: 'runWorkflow', workflowName: 'Other' }],
  Array.from({ length: 26 }, () => ({ functionName: 'f', args: [] })),
]

const ORG: unknown[] = [
  {},
  { name: 'A', trigger: { event: 'pageView' }, steps: [], visibleTo: ['org'] },
  { name: 'A', trigger: { event: 'formSubmission' }, steps: [{ type: 'runWorkflow', workflowName: 'x' }], visibleTo: ['org'] },
  { name: 'A', trigger: { event: 'formSubmission' }, steps: [{ type: 'siteAlert', message: 'x' }], visibleTo: ['org'] },
  { name: 'A', trigger: { event: 'formSubmission' }, steps: [{ type: 'teleport' }], visibleTo: ['org'] },
  { name: 'A', trigger: { event: 'formSubmission' }, steps: [{ type: 'sendEmail', subject: 'Hi', body: '' }], visibleTo: ['org'] },
  { name: 'A', trigger: { event: 'formSubmission' }, steps: [{ type: 'sendEmail', subject: 'Hi', body: 'B' }], visibleTo: [] },
  {
    name: 'A',
    trigger: { event: 'formSubmission' },
    steps: [{ type: 'sendEmail', subject: 'Hi', body: 'B' }],
    visibleTo: Array.from({ length: 31 }, (_, i) => `host:h${i}`),
  },
  {
    name: '  Welcome  ',
    trigger: { event: 'lead', filter: ' subscribe ', conditions: [{ field: 'source', op: 'equals', value: 'form' }] },
    steps: [{ type: 'sendEmail', subject: 'Hi', body: 'B' }, { type: 'wait', delayMinutes: 60 }],
    visibleTo: ['host:h1', 'host:h2'],
    enabled: false,
  },
  {
    name: 'x'.repeat(80),
    trigger: { event: 'booking', conditions: [{ field: 'a', op: 'notEmpty' }], combinator: 'or' },
    steps: [{ type: 'notifyAdmins', title: 'New booking' }],
    visibleTo: ['org'],
  },
]

function cases(fn: (...args: any[]) => unknown, inputs: unknown[][]) {
  return inputs.map((args) => ({ args, result: fn(...(JSON.parse(JSON.stringify(args)) as unknown[])) ?? null }))
}

function build() {
  return {
    '//': [
      'Generated by libs/plugins/workflows/src/lib/model/native-automation-cases.spec.ts (AGLYN_WRITE_NATIVE_CASES=1); do not edit.',
      'The console automation rules the native Automation screens replay (AGL-3670).',
    ],
    values: {
      HOST_ACTION_STEP_LABELS,
      WORKFLOW_ACTION_STEP_TYPES,
      CLIENT_ACTION_STEP_TYPES: [...CLIENT_ACTION_STEP_TYPES].sort(),
      SITE_EVENT_TYPES,
      ELEMENT_SCOPED_SITE_EVENTS,
      ORG_AUTOMATION_TRIGGER_EVENTS,
      ORG_AUTOMATION_STEP_TYPES,
      SEND_EMAIL_REPLY_INELIGIBLE_REASONS,
    },
    functions: {
      validateHostAction: cases(validateHostAction as (a: unknown) => unknown, ACTIONS.map((a) => [a])),
      validateWorkflowSteps: cases(validateWorkflowSteps as (s: unknown) => unknown, WORKFLOW_STEPS.map((s) => [s])),
      readOrgAutomation: cases(readOrgAutomation, ORG.map((o) => [o])),
      triggerFilterProblem: cases(triggerFilterProblem as (f: unknown, o: unknown) => unknown, [
        ['', {}],
        ['subscribe', {}],
        ['a == b', {}],
        ['a == b', { remedy: 'action' }],
        ['"a == b"', {}],
        ['a && b', {}],
        ['x <', {}],
        ['(a', {}],
        ['(a', { remedy: 'action' }],
        ['price * 2', {}],
      ]),
      siteInteractionDocument: cases(siteInteractionDocument as (i: unknown) => unknown, [
        [{ name: 'A', trigger: { event: 'formSubmission' }, steps: [alert] }],
        [
          {
            name: 'A',
            trigger: {
              event: 'scrollDepth',
              threshold: 50,
              pathPattern: '/blog/*',
              oncePerSession: true,
              cooldownMinutes: '30',
              conditions: [{ field: 'a', op: 'notEmpty' }],
              combinator: 'or',
            },
            steps: [alert],
            enabled: false,
            recipe: null,
          },
        ],
        [{ name: 'A', trigger: { event: 'pageVisit', cooldownMinutes: 0, everyTime: true }, steps: [alert] }],
      ]),
      sendEmailReplyIneligibility: cases(sendEmailReplyIneligibility as (s: unknown, c: unknown) => unknown, [
        [{ type: 'sendEmail' }, { event: 'formSubmission', afterWait: false }],
        [{ type: 'sendEmail' }, { event: 'dealWon', afterWait: false }],
        [{ type: 'sendEmail' }, { event: 'booking', afterWait: true }],
        [{ type: 'sendEmail', topicId: 't' }, { event: 'memberSignUp', afterWait: false }],
        [{ type: 'sendEmail', toField: 'email' }, { event: 'formSubmission', afterWait: false }],
        [{ type: 'sendEmail', toField: 'boss' }, { event: 'formSubmission', afterWait: false }],
        [{ type: 'sendEmail' }, { event: null, afterWait: false }],
      ]),
      stepRunsAfterWait: cases(stepRunsAfterWait as (s: unknown, i: number) => unknown, [
        [[{ type: 'sendEmail' }], 0],
        [[{ type: 'wait', delayMinutes: 5 }, { type: 'sendEmail' }], 1],
        [[{ type: 'waitForEvent', eventName: 'booking' }, { type: 'sendEmail' }], 1],
        [[{ type: 'sendEmail' }, { type: 'wait', delayMinutes: 5 }], 0],
      ]),
      workflowFunctionCalls: cases(workflowFunctionCalls as (w: unknown) => unknown, [
        [{ name: 'w', steps: [{ type: 'notifyAdmins', title: 'x' }, { functionName: 'f', args: ['1'] }, { functionName: 'g', args: [], resultName: 'out' }] }],
      ]),
      interactionPlaceholders: cases(interactionPlaceholders as (i: unknown) => unknown, [
        [{ trigger: { event: 'formSubmission' }, steps: [alert] }],
        [
          {
            trigger: { event: 'formSubmission', conditions: [{ field: 'source', op: 'equals', value: '[your form]' }] },
            steps: [
              { type: 'sendEmail', subject: 'Hi [first name]', body: 'See [the link](https://x.co) and [your offer]' },
              { type: 'enrollList', listId: '', listName: '[newsletter list]' },
            ],
          },
        ],
      ]),
      describeInteractionPlaceholder: cases(describeInteractionPlaceholder as (p: unknown) => unknown, [
        [{ step: null, names: 'the condition value', text: 'your form' }],
        [{ step: 2, names: 'the subject', text: 'first name' }],
      ]),
      runTriggeredByLabel: cases(runTriggeredByLabel as (e: unknown) => unknown, [
        [{}],
        [{ triggeredBy: { kind: 'member', email: 'a@b.co' } }],
        [{ triggeredBy: { kind: 'member', uid: 'u1' } }],
        [{ triggeredBy: { kind: 'member' } }],
        [{ triggeredBy: { kind: 'apiKey', apiKeyName: 'Zapier' } }],
        [{ triggeredBy: { kind: 'apiKey' } }],
        [{ triggeredBy: { kind: 'visitor', email: 'v@x.co' } }],
        [{ triggeredBy: { kind: 'visitor' } }],
        [{ triggeredBy: { kind: 'webhook', name: 'Stripe' } }],
        [{ triggeredBy: { kind: 'webhook' } }],
        [{ triggeredBy: { kind: 'platform' } }],
      ]),
      actionRunResult: cases(actionRunResult as (e: unknown) => unknown, [
        [{ result: 'failed' }],
        [{ result: 'skipped' }],
        [{ action: 'Action ran on formSubmission' }],
        [{ action: 'Action ran on formSubmission with errors: webhook 500' }],
        [{ action: 'Published page' }],
      ]),
      actionRunSummary: cases(actionRunSummary as (e: unknown) => unknown, [
        [{ summary: 'Sent email · webhook 200' }],
        [{ action: 'Action ran on lead with errors: webhook 500' }],
        [{ action: 'Action ran on lead' }],
        [{ action: 'Something else' }],
        [{}],
      ]),
      orgAutomationRunsOnHost: cases(orgAutomationRunsOnHost as (a: unknown, h: string) => unknown, [
        [{ enabled: true, visibleTo: ['org'], deletedAt: null }, 'h1'],
        [{ enabled: true, visibleTo: ['host:h2'], deletedAt: null }, 'h1'],
        [{ enabled: true, visibleTo: ['host:h1'], pausedHostIds: ['h1'], deletedAt: null }, 'h1'],
        [{ enabled: false, visibleTo: ['org'], deletedAt: null }, 'h1'],
      ]),
      orgAutomationStopReason: cases(orgAutomationStopReason as (a: unknown, h: string) => unknown, [
        [{ enabled: true, visibleTo: ['org'], deletedAt: null }, 'h1'],
        [{ enabled: true, visibleTo: ['host:h2'], deletedAt: null }, 'h1'],
        [{ enabled: true, visibleTo: ['host:h1'], pausedHostIds: ['h1'], deletedAt: null }, 'h1'],
        [{ enabled: false, visibleTo: ['org'], deletedAt: null }, 'h1'],
      ]),
    },
  }
}

describe('the automation rules the native apps replay (AGL-3670)', () => {
  it('match libs/native/contracts/automation-cases.generated.json', () => {
    const content = `${JSON.stringify(build(), null, 2)}\n`
    if (process.env['AGLYN_WRITE_NATIVE_CASES'] === '1') writeFileSync(FIXTURE, content)
    // Rewrite with AGLYN_WRITE_NATIVE_CASES=1, then update the Swift and
    // Kotlin ports until their replay tests pass.
    expect(readFileSync(FIXTURE, 'utf8')).toBe(content)
  })
})

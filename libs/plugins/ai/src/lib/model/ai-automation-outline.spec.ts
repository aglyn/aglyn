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

import type { HostAction } from '@aglyn/aglyn/app-utils/actions'
import type { HostWorkflow } from '@aglyn/aglyn/app-utils/workflows'
import { emptyAiAutomationRecords, type AiAutomationRecords } from './ai-automation-draft'
import {
  AI_OUTLINE_RUN_ERRORS_MAX,
  aiActionOutline,
  aiActionRecordKinds,
  aiRedactPersonal,
  aiRunErrors,
  aiRunOutline,
  aiWorkflowExplanationText,
  aiWorkflowOutline,
} from './ai-automation-outline'

/**
 * What an explanation is shown (AGL-2919): how an automation is set up, and
 * what its run history recorded — with every address, teammate and on-page
 * code left out, and whether the records it names still exist looked up.
 */

const RECORDS: AiAutomationRecords = {
  ...emptyAiAutomationRecords(),
  lists: [{ id: 'list-news', name: 'Newsletter' }],
  datasets: [{ id: 'ds-leads', name: 'Leads' }],
}

describe('aiRedactPersonal', () => {
  it('replaces every email address in a line, and nothing else', () => {
    expect(aiRedactPersonal('Write to sam@example.test or (jo.lee+news@mail.example.co.uk), not @handle.')).toBe(
      'Write to [email address] or ([email address]), not @handle.',
    )
  })
})

describe('aiActionOutline', () => {
  const action: HostAction = {
    name: 'Follow up quote requests',
    enabled: false,
    trigger: {
      event: 'contactCreated',
      conditions: [
        { field: 'lifecycleStage', op: 'equals', value: 'lead' },
        { field: 'email', op: 'contains', value: 'boss@bigco.test' },
        { field: 'source', op: 'equals', value: '[the quote form]' },
        { field: 'formId', op: 'notEmpty' },
      ],
      combinator: 'or',
      filter: 'source == "import"',
    },
    steps: [
      { type: 'sendEmail', subject: 'Thanks', body: 'Reply to sales@bigco.test.', toField: 'workEmail' },
      { type: 'enrollList', listId: 'list-news', listName: 'Newsletter' },
      { type: 'enrollList', listName: 'Old list' },
      { type: 'datasetAppend', datasetName: '[leads]' },
      { type: 'wait', delayMinutes: 2 * 24 * 60 },
      { type: 'waitForEvent', eventName: 'booking', timeoutMinutes: 90 },
      {
        type: 'exitFlow',
        when: { conditions: [{ field: '_waitTimedOut', op: 'notEmpty' }] },
      },
      { type: 'assignContactOwner', ownerUid: 'uid-sales-lead' },
      { type: 'assignContactOwner', roundRobin: true },
      { type: 'createCrmTask', title: 'Call them', kind: 'call', dueInDays: 1, assigneeEmail: 'rep@bigco.test' },
      { type: 'logCrmActivity', kind: 'note', body: 'Asked for a quote' },
      { type: 'addClass', selector: '#zzselector', className: 'zzclass' },
      { type: 'runJs', code: 'zzscript()' },
      { type: 'setContactStage', lifecycleStage: 'sales-qualified' },
    ],
  } as HostAction

  it('outlines the automation by the labels the editor shows, with what each named record’s standing is', () => {
    expect(aiActionOutline(action, RECORDS).split('\n')).toEqual([
      'Automation: "Follow up quote requests" — an action, switched off.',
      'Starts when: Contact created.',
      'Only when any of these hold: lifecycleStage equals "Lead"; email contains "[email address]"; source equals "[the quote form]" (a placeholder nobody has filled in); formId is not empty.',
      'And only when this expression is true: "source == "import"".',
      'Steps, in order:',
      '1. Send an email: subject "Thanks", text "Reply to [email address].", to the event\'s workEmail field.',
      '2. Enroll in a list: "Newsletter" — the site has it.',
      '3. Enroll in a list: "Old list" — the site has none by that name.',
      '4. Write to a dataset: "[leads]" — a placeholder nobody has filled in.',
      '5. Wait: 2 days.',
      '6. Wait for something to happen: New booking, giving up after 90 minutes.',
      '7. End the flow here. Only if _waitTimedOut is not empty.',
      '8. Assign the contact an owner: a named teammate.',
      '9. Assign the contact an owner: by round robin.',
      '10. Create a CRM task: "Call them", a call, due in 1 day, for a named teammate.',
      '11. Log a CRM activity: a note: "Asked for a quote".',
      '12. Add a CSS class: runs in the visitor’s browser on the page.',
      '13. Run custom JS (Business): runs in the visitor’s browser on the page.',
      '14. Set the contact’s lifecycle stage: "Sales qualified".',
    ])
  })

  it('never carries an address, a teammate’s id, or the code an on-page step holds', () => {
    const outline = aiActionOutline(action, RECORDS)
    for (const hidden of ['boss@bigco.test', 'sales@bigco.test', 'rep@bigco.test', 'uid-sales-lead', 'zzselector', 'zzclass', 'zzscript']) {
      expect([hidden, outline.includes(hidden)]).toEqual([hidden, false])
    }
  })

  it('names the kinds of record its steps name, each once, for the read that says whether they still exist', () => {
    expect(aiActionRecordKinds(action)).toEqual(['lists', 'datasets'])
    expect(aiActionRecordKinds({ steps: [{ type: 'notifyAdmins', title: 'Hi' }] })).toEqual([])
  })

  it('says nothing of a record’s standing when the records were not read, and marks a switched-on automation', () => {
    const outline = aiActionOutline({ ...action, enabled: true, steps: [action.steps[1]] }, null)
    expect(outline).toContain('— an action, switched on.')
    expect(outline).toContain('1. Enroll in a list: "Newsletter".')
    expect(aiActionOutline({ ...action, steps: [] }, RECORDS)).toContain('Steps, in order:\n(none)')
  })
})

describe('aiWorkflowOutline', () => {
  it('outlines each function call, whether the site still has the function, and what it returns', () => {
    const workflow: HostWorkflow = {
      name: 'Shipping quote',
      steps: [
        { functionId: 'fn-rate', functionName: 'rateFor', args: ['weight', ' '], resultName: 'rate' },
        { functionName: 'discountFor', args: [] },
      ],
      returnValue: 'rate * step2',
    }
    expect(aiWorkflowOutline(workflow, [{ id: 'fn-rate', name: 'shippingRate' }]).split('\n')).toEqual([
      'Workflow: "Shipping quote" — a workflow, a list of function calls.',
      'Starts when: it is called — by an automation, an inbound webhook or a computed variable.',
      'Steps, in order:',
      '1. Runs the function "rateFor" — the site has it, given "weight"; its result is kept as "rate".',
      '2. Runs the function "discountFor" — the site has none by that name; its result is kept as "step2".',
      'Returns: "rate * step2".',
    ])
    expect(
      aiWorkflowOutline({ ...workflow, trigger: { event: 'formSubmission', filter: 'path == "/quote"' } }, null),
    ).toContain('Starts when: Form submitted, only when this expression is true: "path == "/quote"".')
  })
})

describe('a failed run', () => {
  it('reads the errors an action run recorded, and a workflow run’s failure', () => {
    expect(
      aiRunErrors({ action: 'Action ran on lead with errors: unknown list "Old list"; no email to enroll' }),
    ).toEqual(['unknown list "Old list"', 'no email to enroll'])
    expect(aiRunErrors({ action: 'Workflow failed on formSubmission: unknown function "rateFor"' })).toEqual([
      'unknown function "rateFor"',
    ])
    expect(aiRunErrors({ result: 'failed', summary: 'webhook 500' })).toEqual(['webhook 500'])
    expect(aiRunErrors({ result: 'succeeded', summary: 'sent email' })).toEqual([])
    const many = Array.from({ length: AI_OUTLINE_RUN_ERRORS_MAX + 3 }, (_, index) => `error ${index}`).join('; ')
    expect(aiRunErrors({ action: `Action ran on lead with errors: ${many}` })).toHaveLength(AI_OUTLINE_RUN_ERRORS_MAX)
  })

  it('outlines when and on what it ran, what it did and what went wrong, with addresses removed', () => {
    const at = { toDate: () => new Date('2026-09-14T08:30:59.000Z') }
    expect(
      aiRunOutline({
        trigger: 'contactCreated',
        createdAt: at,
        summary: 'sent email to jane@example.test',
        action: 'Action ran on contactCreated with errors: no contact for jane@example.test',
      }).split('\n'),
    ).toEqual([
      'The run that failed: on Contact created, 2026-09-14 08:30 UTC.',
      'What it did: sent email to [email address].',
      'What went wrong:',
      '- no contact for [email address]',
    ])
    expect(aiRunOutline({ trigger: 'lead', result: 'failed' }).split('\n')).toEqual([
      'The run that failed: on New lead.',
      'What went wrong:',
      '- (the run recorded no error)',
    ])
  })
})

describe('aiWorkflowExplanationText', () => {
  it('reads as a summary, the points in order, and what to do, in the words of what was asked', () => {
    const explanation = { summary: 'It failed.', points: ['It started.', 'It stopped.'], suggestions: ['Pick a list.'] }
    expect(aiWorkflowExplanationText(explanation, 'diagnose')).toBe(
      'It failed.\n\nWhat happened:\n1. It started.\n2. It stopped.\n\nHow to fix it:\n- Pick a list.',
    )
    expect(aiWorkflowExplanationText(explanation, 'explain')).toBe(
      'It failed.\n\nWhat it does:\n1. It started.\n2. It stopped.\n\nWorth checking:\n- Pick a list.',
    )
    expect(aiWorkflowExplanationText({ summary: 'It welcomes people.', points: [], suggestions: [] }, 'explain')).toBe(
      'It welcomes people.',
    )
  })
})

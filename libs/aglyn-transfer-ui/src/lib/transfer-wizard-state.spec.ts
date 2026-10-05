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

/**
 * What each step needs before Next, held without rendering: two columns on
 * one field and a required field with no column block the mapping; an
 * unchosen date order, lookup or meaning blocks the values; a row several
 * records match blocks the conflicts until it is decided.
 */

import { createTransferPolicy } from '@aglyn/aglyn/data-transfer'
import type { TransferField } from '@aglyn/aglyn/data-transfer'

import {
  TRANSFER_WIZARD_STEPS,
  conflictsStepProblems,
  createTransferWizardDraft,
  mappingStepGate,
  memoryTransferWizardStorage,
  proposeMissingPicklistChoices,
  transferWizardStorageKey,
  valuesStepProblems,
} from './transfer-wizard-state'
import {
  orderTransferWizardSteps,
  registerTransferWizardStep,
  transferWizardStepsFor,
} from './transfer-wizard-steps'
import type { TransferPicklistReview } from './transfer-client'

const FIELDS: TransferField[] = [
  { id: 'name', label: 'Name', type: 'text', required: true },
  { id: 'email', label: 'Email', type: 'email' },
  {
    id: 'id',
    label: 'Aglyn ID',
    type: 'text',
    system: true,
    readOnly: true,
    matchKey: true,
  },
  { id: 'createdAt', label: 'Created', type: 'datetime', system: true },
]

const label = (id: string) =>
  FIELDS.find((field) => field.id === id)?.label ?? id

const REVIEW: TransferPicklistReview = {
  fieldId: 'kind',
  spec: { restricted: true, standardValues: [], meanings: ['open', 'closed'] },
  set: {
    values: [{ id: 'open', label: 'Open', active: true, meaning: 'open' }],
    defaultValueId: null,
  },
  result: {
    matched: [],
    unmatched: [
      {
        value: 'Pending',
        key: 'pending',
        count: 2,
        rows: [0, 1],
        suggestions: [],
      },
    ],
  },
}

describe('mappingStepGate', () => {
  it('blocks two columns on one field and a required field with no column', () => {
    const gate = mappingStepGate({ 0: 'email', 1: 'email' }, FIELDS)
    expect(gate.usable).toBe(false)
    expect(gate.problems.duplicates).toEqual([
      { fieldId: 'email', columns: [0, 1] },
    ])
    expect(gate.problems.unmappedRequired).toEqual(['name'])
  })

  it('takes the Aglyn ID as a match key, and refuses a field that is never written', () => {
    expect(mappingStepGate({ 0: 'name', 1: 'id' }, FIELDS).usable).toBe(true)
    expect(
      mappingStepGate({ 0: 'name', 1: 'createdAt' }, FIELDS).problems.invalid,
    ).toEqual([{ column: 1, fieldId: 'createdAt' }])
  })
})

describe('valuesStepProblems', () => {
  it('asks for a date order, a lookup choice, and a meaning on a list that has meanings', () => {
    const analysis = {
      picklists: [REVIEW],
      derivations: [
        {
          fieldId: 'joined',
          filled: 2,
          unchanged: 1,
          derivations: [],
          problems: [],
          ambiguousDates: 1,
        },
      ],
      lookups: [
        {
          fieldId: 'team',
          unresolved: [
            { value: 'Ops', key: 'ops', count: 1, rows: [0], suggestions: [] },
          ],
        },
      ],
    }
    const draft = {
      picklistChoices: { kind: { pending: { action: 'addValue' as const } } },
      lookupChoices: {},
      dateOrders: {},
    }
    const problems = valuesStepProblems(analysis, draft, label)
    expect(problems).toEqual([
      'kind: "Pending" needs a meaning to be added.',
      'joined: choose whether its dates are month first or day first.',
      'team: choose what to do with "Ops".',
    ])
    expect(
      valuesStepProblems(
        analysis,
        {
          picklistChoices: {
            kind: { pending: { action: 'addValue', meaning: 'open' } },
          },
          lookupChoices: { team: { ops: { action: 'leaveBlank' } } },
          dateOrders: { joined: 'dmy' },
        },
        label,
      ),
    ).toEqual([])
  })

  it('proposes a choice for each undecided value and keeps the ones already made', () => {
    expect(proposeMissingPicklistChoices({ picklists: [REVIEW] }, {})).toEqual({
      kind: { pending: { action: 'leaveBlank' } },
    })
    expect(
      proposeMissingPicklistChoices(
        { picklists: [REVIEW] },
        { kind: { pending: { action: 'refuseRow' } } },
      ),
    ).toEqual({
      kind: { pending: { action: 'refuseRow' } },
    })
  })
})

describe('conflictsStepProblems', () => {
  const ambiguous = [
    {
      row: 3,
      via: { fieldId: 'name', value: 'sam lee' },
      recordIds: ['a', 'b'],
    },
  ]

  it('holds Next until every ambiguous row has a record or an action, when asked to choose', () => {
    expect(
      conflictsStepProblems(createTransferPolicy(), FIELDS, ambiguous),
    ).toEqual([
      'Choose a record, or another action, for the row that matches more than one record.',
    ])
    expect(
      conflictsStepProblems(
        createTransferPolicy({ rows: { 3: { recordId: 'a' } } }),
        FIELDS,
        ambiguous,
      ),
    ).toEqual([])
    expect(
      conflictsStepProblems(
        createTransferPolicy({
          record: { onMatch: 'update', onNew: 'create', onAmbiguous: 'skip' },
        }),
        FIELDS,
        ambiguous,
      ),
    ).toEqual([])
  })

  it('refuses appending to a field that is not a list', () => {
    expect(
      conflictsStepProblems(
        createTransferPolicy({ fields: { email: { mode: 'append' } } }),
        FIELDS,
        [],
      ),
    ).toEqual([
      'A field choice: "Email" is not a list, so it cannot be appended to.',
    ])
  })
})

describe('the draft and the steps', () => {
  it('saves and loads a draft per job', () => {
    const storage = memoryTransferWizardStorage()
    const key = transferWizardStorageKey('people', 'job-1')
    storage.save(key, {
      ...createTransferWizardDraft(),
      jobId: 'job-1',
      step: 'values',
    })
    expect(storage.load(key)?.step).toBe('values')
    storage.clear(key)
    expect(storage.load(key)).toBeNull()
  })

  it('places a plugin step after the step it follows, from the prop or the registry', () => {
    const consent = {
      id: 'consent',
      label: 'Consent',
      after: 'conflicts' as const,
      render: () => null,
    }
    const remove = registerTransferWizardStep('people', consent)
    expect(transferWizardStepsFor('people')).toEqual([consent])
    expect(
      orderTransferWizardSteps(
        TRANSFER_WIZARD_STEPS,
        transferWizardStepsFor('people'),
      ).map((step) => step.id),
    ).toEqual([
      'upload',
      'mapping',
      'values',
      'matching',
      'conflicts',
      'consent',
      'dryRun',
      'apply',
      'results',
    ])
    remove()
    expect(transferWizardStepsFor('people')).toEqual([])
  })
})

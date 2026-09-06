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

import { DEFAULT_DEAL_STAGES } from '@aglyn/aglyn'
import {
  contactChoicesFor,
  dealDocumentFromForm,
  dealFormFromDoc,
  dealFormProblem,
  dealPatchFromForm,
  emptyDealForm,
} from './deal-form-model'

const pipeline = { $id: 'default', stages: [...DEFAULT_DEAL_STAGES] }
const context = {
  visibleTo: ['host:shop'],
  hostId: 'shop',
  uid: 'u1',
  nowMs: Date.UTC(2026, 8, 5, 12),
}

describe('the deal form (AGL-2598)', () => {
  it('opens blank at the first open stage, with any preselected link kept', () => {
    const form = emptyDealForm(pipeline, { contactId: 'c1', contactName: 'Ada' })
    expect(form).toMatchObject({
      pipelineId: 'default',
      stageId: 'qualified',
      currency: 'usd',
      contactId: 'c1',
      contactName: 'Ada',
      companyId: '',
    })
  })

  it('names what keeps the form from saving', () => {
    const blank = emptyDealForm(pipeline)
    expect(dealFormProblem(blank, 'create')).toMatch(/needs a title/)
    expect(dealFormProblem({ ...blank, title: 'Roaster', amount: 'ten' }, 'create')).toMatch(
      /amount/,
    )
    expect(
      dealFormProblem({ ...blank, title: 'Roaster', expectedClose: 'soon' }, 'create'),
    ).toMatch(/expected close/)
    expect(dealFormProblem({ ...blank, title: 'Roaster', stageId: '' }, 'create')).toMatch(
      /stage/,
    )
    // An existing deal's stage is the route's to write, not the form's.
    expect(dealFormProblem({ ...blank, title: 'Roaster', stageId: '' }, 'edit')).toBeNull()
    expect(dealFormProblem({ ...blank, title: 'Roaster' }, 'create')).toBeNull()
  })

  it('builds an open, scoped, stamped document and omits what was left blank', () => {
    const doc = dealDocumentFromForm(
      {
        ...emptyDealForm(pipeline),
        title: '  Roaster upgrade ',
        amount: '$2,500.00',
        currency: 'EUR',
        expectedClose: '2026-10-01',
        ownerUid: 'u9',
        contactId: 'c1',
        contactName: 'Ada Lovelace',
        // A company name with no company id is not a link, so it is dropped.
        companyName: 'Stray',
      },
      context,
    )
    expect(doc).toMatchObject({
      title: 'Roaster upgrade',
      titleLower: 'roaster upgrade',
      pipelineId: 'default',
      stageId: 'qualified',
      status: 'open',
      amountCents: 250_000,
      currency: 'eur',
      ownerUid: 'u9',
      contactId: 'c1',
      contactName: 'Ada Lovelace',
      stageChangedAtMs: context.nowMs,
      visibleTo: ['host:shop'],
      hostId: 'shop',
      createdByUid: 'u1',
    })
    expect(typeof doc['expectedCloseAtMs']).toBe('number')
    expect(doc).not.toHaveProperty('companyId')
    expect(doc).not.toHaveProperty('companyName')
    expect(doc).not.toHaveProperty('notes')
  })

  it('patches the editable fields and clears the ones emptied, never the stage', () => {
    const { set, clear } = dealPatchFromForm(
      {
        ...emptyDealForm(pipeline),
        title: 'Roaster',
        stageId: 'won',
        amount: '',
        ownerUid: '',
        notes: 'Call back Tuesday',
      },
      context.nowMs,
    )
    expect(set).toMatchObject({ title: 'Roaster', notes: 'Call back Tuesday' })
    expect(set).not.toHaveProperty('stageId')
    expect(set).not.toHaveProperty('status')
    expect(set).not.toHaveProperty('visibleTo')
    expect(clear).toEqual(
      expect.arrayContaining(['amountCents', 'ownerUid', 'contactId', 'companyId']),
    )
    expect(clear).not.toContain('notes')
  })

  it('round-trips a stored deal into the form', () => {
    const form = dealFormFromDoc({
      $id: 'd1',
      title: 'Roaster',
      pipelineId: 'default',
      stageId: 'negotiation',
      status: 'open',
      amountCents: 123_450,
      currency: 'USD',
      expectedCloseAtMs: Date.UTC(2026, 9, 1, 12),
      visibleTo: ['host:shop'],
      hostId: 'shop',
    })
    expect(form.amount).toBe('1234.50')
    expect(form.currency).toBe('usd')
    expect(form.expectedClose).toMatch(/^2026-(09-30|10-01|10-02)$/)
    expect(form.stageId).toBe('negotiation')
  })
})

describe('the contact picker match', () => {
  const rows = [
    { $id: 'c1', email: 'ada@example.com', name: 'Ada Lovelace', nameTokens: ['a', 'ad', 'ada', 'l', 'lo', 'lov'] },
    { $id: 'c2', email: 'grace@example.com', name: 'Grace Hopper' },
    { $id: 'c3', email: 'nobody@example.com' },
  ]

  it('matches an email prefix, a name prefix or a later word, in the list grammar', () => {
    expect(contactChoicesFor('ada', rows, 'g').map((c) => c.id)).toEqual(['c1'])
    expect(contactChoicesFor('Hopper', rows, 'g').map((c) => c.id)).toEqual(['c2'])
    expect(contactChoicesFor('nob', rows, 'g').map((c) => c.id)).toEqual(['c3'])
    expect(contactChoicesFor('zzz', rows, 'g')).toEqual([])
    // Nothing typed offers the window itself, capped.
    expect(contactChoicesFor('', rows, 'g', 2)).toHaveLength(2)
  })

  it('offers a nameless contact by email', () => {
    expect(contactChoicesFor('nobody', rows, 'g')[0]).toEqual({
      id: 'c3',
      name: '',
      email: 'nobody@example.com',
    })
  })
})

describe('a deal whose amount is derived (AGL-2620)', () => {
  it('leaves the amount and the currency out of the patch, whatever the form holds', () => {
    const form = { ...emptyDealForm(pipeline), title: 'Roaster', amount: '12.00', currency: 'eur' }
    const patch = dealPatchFromForm(form, context.nowMs, { amountDerived: true })
    expect(patch.set).not.toHaveProperty('amountCents')
    expect(patch.set).not.toHaveProperty('currency')
    expect(patch.set).toMatchObject({ title: 'Roaster' })
    // A blank amount would have been a clear; on a derived deal it is nothing.
    const cleared = dealPatchFromForm({ ...form, amount: '' }, context.nowMs, { amountDerived: true })
    expect(cleared.clear).not.toContain('amountCents')
    // THE CONTROL: a typed amount is written as before.
    expect(dealPatchFromForm(form, context.nowMs).set).toMatchObject({ amountCents: 1200, currency: 'eur' })
  })
})

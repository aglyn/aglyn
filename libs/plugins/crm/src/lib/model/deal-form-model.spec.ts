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

import { crmPicklistFromLabels, DEFAULT_DEAL_STAGES, effectiveCrmPicklist } from '@aglyn/aglyn'
import {
  contactChoicesFor,
  dealDocumentFromForm,
  dealFormFromDoc,
  dealFormProblem,
  dealPatchFromForm,
  emptyDealForm,
  judgeDealFormPicklists,
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
      stageId: 'prospecting',
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
      stageId: 'prospecting',
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

describe("the deal form's Opportunity fields (AGL-3516)", () => {
  const prospecting = DEFAULT_DEAL_STAGES[0]
  const proposal = DEFAULT_DEAL_STAGES.find((stage) => stage.id === 'proposal-price-quote')

  it('writes type, lead source, next step, an override and a campaign, and stamps the stage’s category', () => {
    const doc = dealDocumentFromForm(
      {
        ...emptyDealForm(pipeline),
        title: 'Roaster',
        type: 'New Business',
        leadSource: 'Trade show',
        nextStep: '  Send the   quote ',
        probability: '35',
        campaignId: 'spring',
      },
      { ...context, stage: proposal },
    )
    expect(doc).toMatchObject({
      type: 'New Business',
      leadSource: 'Trade show',
      nextStep: 'Send the quote',
      probability: 35,
      forecastCategory: 'bestCase',
      campaignId: 'spring',
    })
    // A category picked on the form wins over the stage's.
    expect(
      dealDocumentFromForm(
        { ...emptyDealForm(pipeline), title: 'R', forecastCategory: 'commit' },
        { ...context, stage: prospecting },
      ),
    ).toMatchObject({ forecastCategory: 'commit' })
    // Left blank: nothing stored but the stage's category.
    const blank = dealDocumentFromForm({ ...emptyDealForm(pipeline), title: 'R' }, { ...context, stage: prospecting })
    expect(blank).toMatchObject({ forecastCategory: 'pipeline' })
    for (const key of ['type', 'leadSource', 'nextStep', 'probability', 'campaignId']) {
      expect(blank).not.toHaveProperty(key)
    }
  })

  it('refuses a probability outside 0–100 and clears a blank one back to the stage’s', () => {
    const form = { ...emptyDealForm(pipeline), title: 'Roaster' }
    expect(dealFormProblem({ ...form, probability: '120' }, 'edit')).toMatch(/probability/)
    expect(dealFormProblem({ ...form, probability: 'most' }, 'edit')).toMatch(/probability/)
    expect(dealFormProblem({ ...form, probability: '0' }, 'edit')).toBeNull()
    const { set, clear } = dealPatchFromForm(form, context.nowMs, { stage: prospecting })
    expect(clear).toEqual(expect.arrayContaining(['probability', 'type', 'leadSource', 'nextStep', 'campaignId']))
    expect(set).toMatchObject({ forecastCategory: 'pipeline' })
    expect(dealPatchFromForm({ ...form, probability: '0' }, context.nowMs).set).toMatchObject({ probability: 0 })
    // No stage known and none picked: the field goes, and readers derive it.
    expect(dealPatchFromForm(form, context.nowMs).clear).toContain('forecastCategory')
  })

  it('round-trips the fields of a stored deal', () => {
    const form = dealFormFromDoc({
      $id: 'd1',
      title: 'Roaster',
      pipelineId: 'default',
      stageId: 'prospecting',
      status: 'open',
      visibleTo: ['org'],
      hostId: 'shop',
      type: 'Existing Business',
      leadSource: 'Web',
      nextStep: 'Call',
      probability: 0,
      forecastCategory: 'commit',
      campaignId: 'spring',
    })
    expect(form).toMatchObject({
      type: 'Existing Business',
      leadSource: 'Web',
      nextStep: 'Call',
      probability: '0',
      forecastCategory: 'commit',
      campaignId: 'spring',
    })
  })

  it('judges the two picklists the way the server doors do', () => {
    const lists = {
      type: effectiveCrmPicklist('opportunityType', null),
      leadSource: effectiveCrmPicklist('leadSource', null),
    }
    const form = { ...emptyDealForm(pipeline), title: 'R', type: 'new business', leadSource: 'web' }
    expect(judgeDealFormPicklists(form, lists, { created: true })).toMatchObject({
      ok: true,
      values: { type: 'New Business', leadSource: 'Web' },
    })
    expect(judgeDealFormPicklists({ ...form, type: 'Upsell' }, lists, { created: true })).toEqual({
      ok: false,
      error: 'Type must be one of: Existing Business, New Business.',
    })
    // A value the deal already holds is kept, listed or not.
    expect(
      judgeDealFormPicklists({ ...form, type: 'Upsell' }, lists, { created: false, current: { type: 'Upsell' } }),
    ).toMatchObject({ ok: true, values: { type: 'Upsell' } })
    // A new deal with no Type takes the list's default; its lead source is never defaulted.
    const defaulted = {
      type: { ...crmPicklistFromLabels(['Renewal', 'New Business']), defaultValueId: null },
      leadSource: lists.leadSource,
    }
    defaulted.type.defaultValueId = defaulted.type.values[0].id
    expect(
      judgeDealFormPicklists({ ...form, type: '', leadSource: '' }, defaulted, { created: true }),
    ).toMatchObject({ ok: true, values: { type: 'Renewal', leadSource: '' } })
    expect(
      judgeDealFormPicklists({ ...form, type: '', leadSource: '' }, defaulted, { created: false }),
    ).toMatchObject({ ok: true, values: { type: '' } })
  })
})

describe("the deal form's contact keeps the Primary contact role (AGL-3521)", () => {
  const form = { ...emptyDealForm(pipeline), title: 'Committee' }

  it('creates a deal with its contact as the Primary role, and none without one', () => {
    expect(dealDocumentFromForm({ ...form, contactId: 'c1' }, context)).toMatchObject({
      contactId: 'c1',
      contactRoles: [{ contactId: 'c1', primary: true }],
    })
    expect(dealDocumentFromForm(form, context)).not.toHaveProperty('contactRoles')
  })

  it('moves the Primary with a changed contact, and writes no roles when it is unchanged', () => {
    const current = {
      contactId: 'c1',
      contactRoles: [
        { contactId: 'c1', role: 'Decision Maker', primary: true },
        { contactId: 'c2', role: 'Evaluator', primary: false },
      ],
    }
    const nowMs = context.nowMs
    expect(dealPatchFromForm({ ...form, contactId: 'c2' }, nowMs, { current }).set).toMatchObject({
      contactId: 'c2',
      contactRoles: [
        { contactId: 'c1', role: 'Decision Maker', primary: false },
        { contactId: 'c2', role: 'Evaluator', primary: true },
      ],
    })
    expect(dealPatchFromForm({ ...form, contactId: 'c3' }, nowMs, { current }).set['contactRoles']).toEqual([
      { contactId: 'c3', primary: true },
      { contactId: 'c1', role: 'Decision Maker', primary: false },
      { contactId: 'c2', role: 'Evaluator', primary: false },
    ])
    const cleared = dealPatchFromForm(form, nowMs, { current })
    expect(cleared.clear).toContain('contactId')
    expect(cleared.set['contactRoles']).toEqual([
      { contactId: 'c1', role: 'Decision Maker', primary: false },
      { contactId: 'c2', role: 'Evaluator', primary: false },
    ])
    expect(dealPatchFromForm({ ...form, contactId: 'c1' }, nowMs, { current }).set).not.toHaveProperty(
      'contactRoles',
    )
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

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

import { CONTACT_FIELDS_MAX_PER_ORG } from '@aglyn/aglyn/app-utils/contact-custom-fields'
import { DEFAULT_DEAL_STAGES, type CrmDealStage } from '@aglyn/aglyn/app-utils/crm'
import {
  checkCrmFieldSetup,
  checkCrmPipelineSetup,
  CRM_FIELD_OPTIONS_MAX,
  CRM_SETUP_OPEN_STAGES_MAX,
  type CrmFieldDefinitionDoc,
  type CrmPipelineSetup,
  crmFieldOptions,
  crmPipelineSetupFacts,
  crmSetupStageProbability,
  mergeCrmSetupStages,
  planCrmFieldSetup,
  planCrmPipelineSetup,
  readCrmFieldSetup,
  readCrmPipelineSetup,
  readCrmSetupStage,
} from './crm-setup-content'
import { type PipelineDoc, stagesProblem } from './deal-board-model'

const NOW = new Date('2026-10-12T15:00:00.000Z')
const CONTEXT = { visibleTo: ['host:h1'], hostId: 'h1', uid: 'u1', nowMs: NOW.getTime() }

function setup(content: Record<string, unknown>): CrmPipelineSetup {
  const read = readCrmPipelineSetup(content)
  if (read.ok === false) throw new Error(read.problems.join('; '))
  return read.value
}

function pipeline(id: string, name: string, extra: Partial<PipelineDoc> = {}): PipelineDoc {
  return {
    $id: id,
    name,
    stages: DEFAULT_DEAL_STAGES.map((stage) => ({ ...stage })),
    isDefault: false,
    archivedAt: null,
    visibleTo: ['org'],
    ...extra,
  } as PipelineDoc
}

const names = (stages: readonly CrmDealStage[]) => stages.map((stage) => `${stage.kind}:${stage.name}`)

describe('reading a pipeline ask', () => {
  it('reads a stage’s probability written after it', () => {
    expect(readCrmSetupStage('Discovery (20%)')).toEqual({ name: 'Discovery', probability: 20 })
    expect(readCrmSetupStage(' Proposal  ( 140 ) ')).toEqual({ name: 'Proposal', probability: 100 })
    expect(readCrmSetupStage('Negotiation')).toEqual({ name: 'Negotiation', probability: null })
  })

  it('takes Won and Lost listed as stages as the closing stages’ names, and drops repeats', () => {
    const value = setup({ name: 'Agency', stages: ['Discovery', 'Proposal', 'discovery', 'Negotiation', 'Won', 'Closed Lost'] })
    expect(value.stages.map((one) => one.name)).toEqual(['Discovery', 'Proposal', 'Negotiation'])
    expect(value.wonStage).toBe('Won')
    expect(value.lostStage).toBe('Closed Lost')
    expect(value.makeDefault).toBe(false)
  })

  it('refuses no name, too many stages, and one name for both closing stages', () => {
    expect(checkCrmPipelineSetup({ stages: ['A'] })).toEqual({ ok: false, problems: ['A pipeline needs a name.'] })
    const many = Array.from({ length: CRM_SETUP_OPEN_STAGES_MAX + 1 }, (_, index) => `Stage ${index}`)
    expect(checkCrmPipelineSetup({ name: 'X', stages: many }).ok).toBe(false)
    expect(checkCrmPipelineSetup({ name: 'X', wonStage: 'Done', lostStage: 'done' }).ok).toBe(false)
    expect(checkCrmPipelineSetup({ name: 'X', stages: ['A'] })).toEqual({ ok: true, facts: { name: 'X', stages: ['A'] } })
  })
})

describe('the stages a pipeline ends up with', () => {
  it('spreads unasked probabilities by position', () => {
    expect([0, 1, 2].map((index) => crmSetupStageProbability(index, 3))).toEqual([25, 50, 75])
    expect(crmSetupStageProbability(0, 30)).toBe(5)
  })

  it('keeps an existing stage’s id, adds the missing, keeps the unlisted, and renames Won and Lost', () => {
    const merged = mergeCrmSetupStages(DEFAULT_DEAL_STAGES, {
      stages: [{ name: 'Discovery', probability: null }, { name: 'qualification', probability: 30 }],
      wonStage: 'Won',
      lostStage: null,
    })
    expect(merged[0]).toMatchObject({ id: 'discovery', name: 'Discovery', kind: 'open', order: 0, forecastCategory: 'pipeline' })
    expect(merged[1]).toMatchObject({ id: 'qualification', name: 'Qualification', probability: 30, order: 1 })
    expect(merged[2].id).toBe('prospecting')
    expect(merged.slice(-2).map((stage) => [stage.id, stage.name])).toEqual([
      ['won', 'Won'],
      ['lost', 'Closed Lost'],
    ])
    expect(stagesProblem(merged)).toBeNull()
    expect(merged.map((stage) => stage.order)).toEqual(merged.map((_, index) => index))
  })
})

describe('planning a pipeline', () => {
  const agency = setup({
    name: 'Agency sales',
    stages: ['Discovery', 'Proposal (60%)', 'Negotiation'],
    wonStage: 'Won',
    lostStage: 'Lost',
  })

  it('creates exactly the asked stages, as the default where the site has no pipeline yet', () => {
    const plan = planCrmPipelineSetup(agency, [], CONTEXT)
    if (plan.kind !== 'create') throw new Error(plan.kind)
    const stages = plan.document['stages'] as CrmDealStage[]
    expect(names(stages)).toEqual(['open:Discovery', 'open:Proposal', 'open:Negotiation', 'won:Won', 'lost:Lost'])
    expect(stages.map((stage) => stage.probability)).toEqual([25, 60, 75, 100, 0])
    expect(plan.document).toMatchObject({
      name: 'Agency sales',
      isDefault: true,
      archivedAt: null,
      visibleTo: ['host:h1'],
      hostId: 'h1',
      createdByUid: 'u1',
    })
    expect(plan.defaultsOff).toEqual([])
  })

  it('keeps the standard stages for a new pipeline asked for with none', () => {
    const plan = planCrmPipelineSetup(setup({ name: 'Renewals' }), [pipeline('p1', 'Sales', { isDefault: true })], CONTEXT)
    if (plan.kind !== 'create') throw new Error(plan.kind)
    expect((plan.document['stages'] as CrmDealStage[]).map((stage) => stage.id)).toEqual(DEFAULT_DEAL_STAGES.map((stage) => stage.id))
    expect(plan.document['isDefault']).toBe(false)
  })

  it('takes the default from the others when asked', () => {
    const plan = planCrmPipelineSetup(
      setup({ name: 'Agency sales', makeDefault: true }),
      [pipeline('p1', 'Sales', { isDefault: true }), pipeline('p2', 'Old', { isDefault: true, archivedAt: 5 })],
      CONTEXT,
    )
    expect(plan).toMatchObject({ kind: 'create', defaultsOff: ['p1'] })
  })

  it('brings a pipeline matched by name without case to the ask, and asked again changes nothing', () => {
    const first = planCrmPipelineSetup(agency, [pipeline('p1', 'AGENCY SALES')], CONTEXT)
    if (first.kind !== 'update') throw new Error(first.kind)
    expect(first.id).toBe('p1')
    // The same name in another case is the same pipeline, and keeps its own.
    expect(first.patch.name).toBeUndefined()
    // Nothing is removed: the standard open stages stay, after the asked ones.
    expect(names(first.patch.stages ?? []).slice(0, 4)).toEqual(['open:Discovery', 'open:Proposal', 'open:Negotiation', 'open:Prospecting'])
    const after = pipeline('p1', 'AGENCY SALES', { stages: first.patch.stages })
    expect(planCrmPipelineSetup(agency, [after], CONTEXT)).toEqual({
      kind: 'update',
      id: 'p1',
      name: 'AGENCY SALES',
      patch: {},
      defaultsOff: [],
    })
  })

  it('renames by renameFrom, and refuses a name another active pipeline has', () => {
    const pipelines = [pipeline('p1', 'Sales'), pipeline('p2', 'Partners')]
    expect(planCrmPipelineSetup(setup({ name: 'Direct', renameFrom: 'sales' }), pipelines, CONTEXT)).toMatchObject({
      kind: 'update',
      id: 'p1',
      patch: { name: 'Direct' },
    })
    expect(planCrmPipelineSetup(setup({ name: 'Partners', renameFrom: 'Sales' }), pipelines, CONTEXT)).toEqual({
      kind: 'refuse',
      error: 'Another pipeline is already called "Partners".',
    })
  })

  it('reports its stages as facts', () => {
    expect(crmPipelineSetupFacts(DEFAULT_DEAL_STAGES)).toMatchObject({ wonStage: 'Closed Won', lostStage: 'Closed Lost' })
  })
})

describe('reading a field ask', () => {
  it('derives the key and keeps choices only for a Choice field', () => {
    expect(readCrmFieldSetup({ object: 'deal', label: 'Budget', type: 'number', options: ['x'] })).toEqual({
      ok: true,
      value: { object: 'deal', label: 'Budget', key: 'budget', type: 'number', options: [], currency: null, required: false },
    })
    expect(checkCrmFieldSetup({ object: 'company', label: 'Industry tier', type: 'select', options: ['A', 'A', ' B '] })).toEqual({
      ok: true,
      facts: { object: 'company', key: 'industry_tier', type: 'select' },
    })
  })

  it('refuses an object, a type or a label the CRM does not have', () => {
    expect(checkCrmFieldSetup({ object: 'opportunity', label: 'Budget', type: 'number' }).ok).toBe(false)
    expect(checkCrmFieldSetup({ object: 'deal', label: 'Budget', type: 'money' }).ok).toBe(false)
    expect(checkCrmFieldSetup({ object: 'deal', label: '123', type: 'text' }).ok).toBe(false)
    expect(checkCrmFieldSetup({ object: 'deal', label: 'Tier', type: 'select' }).ok).toBe(false)
  })

  it('bounds choices as the drawer does', () => {
    const many = Array.from({ length: CRM_FIELD_OPTIONS_MAX + 5 }, (_, index) => `o${index}`)
    expect(crmFieldOptions(many)).toHaveLength(CRM_FIELD_OPTIONS_MAX)
    expect(crmFieldOptions(['a', ' a ', '', 'b'])).toEqual(['a', 'b'])
  })
})

describe('planning a field', () => {
  const field = (id: string, extra: Partial<CrmFieldDefinitionDoc>): CrmFieldDefinitionDoc =>
    ({ $id: id, key: id, label: id, type: 'text', order: 0, retiredAt: null, ...extra }) as CrmFieldDefinitionDoc
  const context = { hostId: 'h1', now: NOW, visibleTo: ['org'] }
  const budget = (() => {
    const read = readCrmFieldSetup({ object: 'deal', label: 'Budget', type: 'number', required: true })
    if (!read.ok) throw new Error('unread')
    return read.value
  })()

  it('creates it last on its object’s tab, org-wide, with the Fields table’s query fields', () => {
    const plan = planCrmFieldSetup(budget, [field('region', { object: 'deal', order: 4 }), field('tier', { order: 9 })], context)
    expect(plan).toEqual({
      kind: 'create',
      document: expect.objectContaining({
        key: 'budget',
        label: 'Budget',
        type: 'number',
        required: true,
        order: 5,
        retiredAt: null,
        object: 'deal',
        hostId: 'h1',
        visibleTo: ['org'],
        createdAt: NOW,
        updatedAt: NOW,
      }),
    })
    if (plan.kind === 'create') expect(plan.document['searchTokens']).toEqual(expect.arrayContaining(['budget']))
  })

  it('finds a field of that label or key on the same object, and only there', () => {
    expect(planCrmFieldSetup(budget, [field('f1', { object: 'deal', label: 'BUDGET', key: 'deal_budget' })], context)).toEqual({
      kind: 'existing',
      id: 'f1',
      label: 'BUDGET',
      options: [],
    })
    expect(planCrmFieldSetup(budget, [field('budget', { object: 'company' })], context).kind).toBe('create')
  })

  it('gives an existing Choice field only the choices it lacks', () => {
    const read = readCrmFieldSetup({ object: 'lead', label: 'Tier', type: 'select', options: ['Gold', 'Silver', 'Bronze'] })
    if (!read.ok) throw new Error('unread')
    expect(
      planCrmFieldSetup(read.value, [field('f1', { object: 'lead', label: 'Tier', key: 'tier', type: 'select', options: ['Gold'] })], context),
    ).toEqual({ kind: 'existing', id: 'f1', label: 'Tier', options: ['Silver', 'Bronze'] })
  })

  it('refuses a key a retired field keeps, and the org’s ceiling', () => {
    expect(planCrmFieldSetup(budget, [field('f1', { object: 'deal', key: 'budget', label: 'Old budget', retiredAt: 5 })], context)).toMatchObject({
      kind: 'refuse',
      status: 409,
    })
    const full = Array.from({ length: CONTACT_FIELDS_MAX_PER_ORG }, (_, index) => field(`k${index}`, {}))
    expect(planCrmFieldSetup(budget, full, context)).toMatchObject({ kind: 'refuse', status: 403 })
  })
})

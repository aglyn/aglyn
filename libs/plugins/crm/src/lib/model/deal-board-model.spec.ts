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
  activePipelines,
  addStage,
  boardSummary,
  defaultPipelineOf,
  newPipelineDocument,
  pipelineArchiveRefusal,
  pipelineNameProblem,
  dateInputMs,
  dateInputValue,
  daysInStage,
  dealEventPayload,
  moveStage,
  newStageId,
  parseAmountInput,
  removeStage,
  setStageProbability,
  stageRemovalRefusal,
  stagesProblem,
} from './deal-board-model'

const pipeline = { stages: [...DEFAULT_DEAL_STAGES] }

describe('the board summary (AGL-2598)', () => {
  it('counts and sums only OPEN deals, per currency, weighted by stage', () => {
    const summary = boardSummary(
      [
        { status: 'open', amountCents: 100_000, currency: 'usd', stageId: 'qualified' },
        { status: 'open', amountCents: 50_000, currency: 'usd', stageId: 'negotiation' },
        { status: 'open', amountCents: 20_000, currency: 'eur', stageId: 'proposal-sent' },
        // Closed deals are neither counted nor valued: the summary is what is
        // still in play.
        { status: 'won', amountCents: 900_000, currency: 'usd', stageId: 'won' },
        { status: 'lost', amountCents: 900_000, currency: 'usd', stageId: 'lost' },
      ],
      pipeline,
    )
    expect(summary.openCount).toBe(3)
    expect(summary.valueByCurrency).toEqual({ usd: 150_000, eur: 20_000 })
    // 10% of 1,000 + 60% of 500 = 100 + 300; 40% of 200 = 80.
    expect(summary.weightedByCurrency).toEqual({ usd: 40_000, eur: 8_000 })
  })

  it('values an open deal in a stage the pipeline lost at nothing', () => {
    const summary = boardSummary(
      [{ status: 'open', amountCents: 100_000, currency: 'usd', stageId: 'gone' }],
      pipeline,
    )
    expect(summary.valueByCurrency).toEqual({ usd: 100_000 })
    expect(summary.weightedByCurrency).toEqual({ usd: 0 })
  })
})

describe('editing stages', () => {
  it('adds an open stage in front of Won and Lost with a unique slug id', () => {
    const stages = addStage(pipeline.stages, 'Demo booked', 30)
    const ids = stages.map((stage) => stage.id)
    expect(ids).toEqual([
      'qualified',
      'contact-made',
      'proposal-sent',
      'negotiation',
      'demo-booked',
      'won',
      'lost',
    ])
    expect(stages.map((stage) => stage.order)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(stages[4]).toMatchObject({ name: 'Demo booked', probability: 30, kind: 'open' })
    // A second stage of the same name does not become the first.
    expect(newStageId('Demo booked', stages)).toBe('demo-booked-2')
  })

  it('reorders an open stage but never past a closing one', () => {
    const down = moveStage(pipeline.stages, 'negotiation', 'down')
    expect(down.map((stage) => stage.id)).toEqual(pipeline.stages.map((stage) => stage.id))
    const up = moveStage(pipeline.stages, 'negotiation', 'up')
    expect(up.map((stage) => stage.id)).toEqual([
      'qualified',
      'contact-made',
      'negotiation',
      'proposal-sent',
      'won',
      'lost',
    ])
    expect(up.map((stage) => stage.order)).toEqual([0, 1, 2, 3, 4, 5])
    // Won cannot be moved at all.
    expect(moveStage(pipeline.stages, 'won', 'up').map((stage) => stage.id)).toEqual(
      pipeline.stages.map((stage) => stage.id),
    )
  })

  it('sets an open stage probability and leaves the closing stages fixed', () => {
    const stages = setStageProbability(
      setStageProbability(pipeline.stages, 'qualified', 175),
      'won',
      5,
    )
    expect(stages.find((stage) => stage.id === 'qualified')?.probability).toBe(100)
    expect(stages.find((stage) => stage.id === 'won')?.probability).toBe(100)
  })

  it('refuses to remove a stage with deals in it, a closing stage, or the last open one', () => {
    expect(stageRemovalRefusal(pipeline.stages, 'proposal-sent', 3)).toMatch(/3 deals are/)
    expect(stageRemovalRefusal(pipeline.stages, 'proposal-sent', 1)).toMatch(/1 deal is/)
    expect(stageRemovalRefusal(pipeline.stages, 'won', 0)).toMatch(/Won/)
    expect(stageRemovalRefusal(pipeline.stages, 'lost', 0)).toMatch(/Lost/)
    expect(stageRemovalRefusal(pipeline.stages, 'proposal-sent', 0)).toBeNull()
    const one = pipeline.stages.filter((stage) => stage.kind !== 'open' || stage.id === 'qualified')
    expect(stageRemovalRefusal(one, 'qualified', 0)).toMatch(/at least one open/)
  })

  it('removes a stage and renumbers the rest', () => {
    const stages = removeStage(pipeline.stages, 'contact-made')
    expect(stages.map((stage) => stage.id)).toEqual([
      'qualified',
      'proposal-sent',
      'negotiation',
      'won',
      'lost',
    ])
    expect(stages.map((stage) => stage.order)).toEqual([0, 1, 2, 3, 4])
  })

  it('names what makes a set of stages unsaveable', () => {
    expect(stagesProblem(pipeline.stages)).toBeNull()
    expect(stagesProblem([])).toMatch(/needs stages/)
    expect(stagesProblem(pipeline.stages.filter((stage) => stage.id !== 'won'))).toMatch(/one Won/)
    expect(
      stagesProblem(pipeline.stages.map((stage) => (stage.id === 'qualified' ? { ...stage, name: ' ' } : stage))),
    ).toMatch(/needs a name/)
    expect(stagesProblem([...pipeline.stages, { ...pipeline.stages[0] }])).toMatch(/share the id/)
  })
})

describe('the event payload', () => {
  it('flattens to strings and numbers, with absent links as empty strings', () => {
    expect(
      dealEventPayload(
        'd1',
        {
          title: 'Roaster upgrade',
          amountCents: 250_000,
          currency: 'USD',
          stageId: 'negotiation',
          ownerUid: 'u9',
        },
        'proposal-sent',
      ),
    ).toEqual({
      dealId: 'd1',
      title: 'Roaster upgrade',
      amountCents: 250_000,
      currency: 'usd',
      stageId: 'negotiation',
      previousStageId: 'proposal-sent',
      ownerUid: 'u9',
      contactId: '',
      companyId: '',
    })
  })

  it('carries the loss reason only when there is one', () => {
    const lost = dealEventPayload(
      'd1',
      { title: 't', stageId: 'lost', lostReason: 'Budget cut' },
      'negotiation',
    )
    expect(lost['lostReason']).toBe('Budget cut')
    expect(dealEventPayload('d1', { title: 't', stageId: 'won' }, 'x')).not.toHaveProperty(
      'lostReason',
    )
  })
})

describe('the amount and date inputs', () => {
  it('parses what people paste and refuses a negative', () => {
    expect(parseAmountInput('$1,234.50')).toBe(123_450)
    expect(parseAmountInput('19.995')).toBe(2_000)
    expect(parseAmountInput('')).toBeNull()
    expect(parseAmountInput('-5')).toBeNull()
    expect(parseAmountInput('abc')).toBeNull()
  })

  it('round-trips a calendar day through the date input', () => {
    const ms = dateInputMs('2026-09-05')
    expect(ms).not.toBeNull()
    expect(dateInputValue(ms)).toBe('2026-09-05')
    expect(dateInputMs('9/5/2026')).toBeNull()
  })

  it('counts whole days in stage, never negative', () => {
    const now = Date.UTC(2026, 8, 5, 12)
    expect(daysInStage({ stageChangedAtMs: now - 3.5 * 86_400_000 }, now)).toBe(3)
    expect(daysInStage({ stageChangedAtMs: now + 86_400_000 }, now)).toBe(0)
    expect(daysInStage({ createdAt: { seconds: (now - 2 * 86_400_000) / 1000 } }, now)).toBe(2)
    expect(daysInStage({}, now)).toBe(0)
  })
})

describe('more than one pipeline (AGL-2620)', () => {
  const sales = { $id: 'sales', name: 'Sales', isDefault: true, archivedAt: null }
  const renewals = { $id: 'renewals', name: 'Renewals', archivedAt: null }
  const retired = { $id: 'old', name: 'Sales 2025', isDefault: false, archivedAt: 1_700_000_000_000 }

  it('offers only the active pipelines, and defaults to the active one flagged default', () => {
    expect(activePipelines([sales, renewals, retired]).map((p) => p.$id)).toEqual(['sales', 'renewals'])
    expect(defaultPipelineOf([renewals, sales, retired])?.$id).toBe('sales')
    // The flag on an archived pipeline does not make it the default.
    expect(defaultPipelineOf([renewals, { ...retired, isDefault: true }])?.$id).toBe('renewals')
    expect(defaultPipelineOf([retired])).toBeNull()
  })

  it('requires a name that no ACTIVE pipeline already has, without case', () => {
    expect(pipelineNameProblem('   ', [sales])).toMatch(/needs a name/)
    expect(pipelineNameProblem('sales', [sales, renewals])).toMatch(/already called "Sales"/)
    // Renaming a pipeline to its own name is not a collision.
    expect(pipelineNameProblem('Sales', [sales, renewals], 'sales')).toBeNull()
    // An archived pipeline's name is free again.
    expect(pipelineNameProblem('Sales 2025', [sales, retired])).toBeNull()
    expect(pipelineNameProblem('Partners', [sales, renewals])).toBeNull()
  })

  it('refuses to archive the default, the last, an archived one, or one holding open deals', () => {
    expect(pipelineArchiveRefusal(retired, [sales, retired], 0)).toMatch(/already archived/)
    expect(pipelineArchiveRefusal(renewals, [renewals, retired], 0)).toMatch(/last pipeline/)
    expect(pipelineArchiveRefusal(sales, [sales, renewals], 0)).toMatch(/default pipeline/)
    expect(pipelineArchiveRefusal(renewals, [sales, renewals], 3)).toMatch(/^3 open deals are in this pipeline/)
    expect(pipelineArchiveRefusal(renewals, [sales, renewals], 1)).toMatch(/^1 open deal is/)
    expect(pipelineArchiveRefusal(renewals, [sales, renewals], 0)).toBeNull()
  })

  it('creates a pipeline from a COPY of the default stages, active and not default', () => {
    const document = newPipelineDocument('  Renewals  ', {
      visibleTo: ['host:shop'],
      hostId: 'shop',
      uid: 'u1',
      nowMs: Date.UTC(2026, 8, 5, 12),
    })
    expect(document).toMatchObject({
      name: 'Renewals',
      isDefault: false,
      archivedAt: null,
      visibleTo: ['host:shop'],
      hostId: 'shop',
      createdByUid: 'u1',
    })
    const stages = document.stages as Array<{ id: string }>
    expect(stages.map((stage) => stage.id)).toEqual(DEFAULT_DEAL_STAGES.map((stage) => stage.id))
    expect(stages[0]).not.toBe(DEFAULT_DEAL_STAGES[0])
  })
})

/**
 * @jest-environment node
 */
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
 * The model switch (AGL-2942): Auto is the routing table; a pick is honored
 * only inside the plan's tiers, the org restriction and the allotment
 * allowlist, which bound Auto too; and the price beside each option is its
 * cost over Auto's for the same typical request. Model ids come from the
 * catalog here, never written out, so the suite follows the catalog.
 */

import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import { AI_MODEL_CATALOG, estimateAiBilledUsd, type AiCatalogEntry } from './catalog'
import {
  AI_MODEL_AUTO,
  AI_PLAN_MODEL_TIERS,
  AI_STEP_NOMINAL_USAGE,
  aiMedianUsage,
  aiModelOptions,
  aiModelsSelectable,
  resolveAiModelChoice,
} from './model-choice'
import { aiModelForStep, resolveAiRoute } from './routing'

beforeEach(() => {
  delete process.env.AI_PROVIDER
  delete process.env.AI_DEFAULT_MODEL
  delete process.env.ASSIST_MODEL
})

const providerId = (): string => resolveAiRoute('copy.section')?.provider.id ?? ''

function ofTier(tier: AiCatalogEntry['tier'], except?: string): AiCatalogEntry {
  const entry = AI_MODEL_CATALOG.find(
    (candidate) => candidate.provider === providerId() && candidate.tier === tier && candidate.id !== except,
  )
  if (!entry) throw new Error(`the default provider has no ${tier} model`)
  return entry
}

describe('Auto is the routing table', () => {
  it('a request that picks nothing, or picks auto, runs on the table’s answer for its kind', () => {
    for (const kind of ['assist.chat', 'copy.element', 'copy.section', 'job.text'] as const) {
      expect(resolveAiModelChoice(kind, null, { plan: 'pro' })).toEqual({
        model: aiModelForStep(kind),
        auto: true,
        declined: null,
      })
      expect(resolveAiModelChoice(kind, AI_MODEL_AUTO, { plan: 'pro' })?.model).toBe(
        aiModelForStep(kind),
      )
    }
  })
})

describe('a pick is bounded', () => {
  it('by the plan’s tiers: the dearest tier is declined on Pro and honored on Agency', () => {
    const deep = ofTier('deep')
    expect(resolveAiModelChoice('copy.section', deep.id, { plan: 'pro' })).toEqual({
      model: aiModelForStep('copy.section'),
      auto: true,
      declined: deep.id,
    })
    expect(resolveAiModelChoice('copy.section', deep.id, { plan: 'agency' })).toEqual({
      model: deep.id,
      auto: false,
      declined: null,
    })
  })

  it('Free runs on Auto whatever it asks for', () => {
    expect(aiModelsSelectable(providerId(), { plan: 'free' })).toEqual([])
    expect(resolveAiModelChoice('copy.element', ofTier('fast').id, { plan: 'free' })).toMatchObject({
      auto: true,
      model: aiModelForStep('copy.element'),
    })
  })

  it('a model this platform does not offer is declined', () => {
    expect(resolveAiModelChoice('copy.element', 'no-such-model', { plan: 'enterprise' })).toMatchObject({
      auto: true,
      declined: 'no-such-model',
    })
  })

  it('by the ALLOTMENT allowlist, which bounds Auto as well as a pick', () => {
    const fast = ofTier('fast')
    const balanced = ofTier('balanced')
    const bounds = { plan: 'agency' as OrgPlan, allotmentModels: [fast.id] }
    expect(aiModelsSelectable(providerId(), bounds).map((entry) => entry.id)).toEqual([fast.id])
    expect(resolveAiModelChoice('copy.section', balanced.id, bounds)).toEqual({
      model: fast.id,
      auto: true,
      declined: balanced.id,
    })
  })

  it('by the ORG restriction the same way', () => {
    const fast = ofTier('fast')
    const deep = ofTier('deep')
    const bounds = { plan: 'enterprise' as OrgPlan, orgModels: [fast.id] }
    expect(resolveAiModelChoice('assist.chat', deep.id, bounds)).toEqual({
      model: fast.id,
      auto: true,
      declined: deep.id,
    })
  })

  it('Auto off the list runs on the listed model of the same tier before the cheapest', () => {
    const route = aiModelForStep('copy.section')
    const otherBalanced = ofTier('balanced', route)
    expect(
      resolveAiModelChoice('copy.section', null, {
        plan: 'pro',
        orgModels: [ofTier('fast').id, otherBalanced.id],
      })?.model,
    ).toBe(otherBalanced.id)
  })

  it('a list that leaves nothing this deployment serves falls back to the routing table', () => {
    expect(
      resolveAiModelChoice('copy.section', null, { plan: 'pro', allotmentModels: [] })?.model,
    ).toBe(aiModelForStep('copy.section'))
    expect(
      resolveAiModelChoice('copy.section', null, { plan: 'pro', orgModels: ['no-such-model'] })?.model,
    ).toBe(aiModelForStep('copy.section'))
  })
})

describe('the price beside each option', () => {
  it('Auto is 1×; each option is its cost over Auto’s for the same request, in credits, cheapest first', () => {
    const listed = aiModelOptions('copy.section', { plan: 'agency' }, null)
    if (!listed) throw new Error('no provider')
    expect(listed.auto).toMatchObject({
      id: AI_MODEL_AUTO,
      multiplier: 1,
      model: aiModelForStep('copy.section'),
    })
    const typical = AI_STEP_NOMINAL_USAGE['copy.section']
    const autoCost = estimateAiBilledUsd(typical, listed.auto.model)
    expect(listed.options.length).toBeGreaterThan(1)
    for (const option of listed.options) {
      expect(option.multiplier).toBe(
        Math.round((estimateAiBilledUsd(typical, option.id) / autoCost) * 10) / 10,
      )
    }
    const credits = listed.options.map((option) => option.creditsPerRequest)
    expect(credits).toEqual([...credits].sort((a, b) => a - b))
    expect(listed.measured).toBe(false)
  })

  it('prices from the workspace’s measured median when there is one', () => {
    const measured = { inputTokens: 50_000, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 }
    const nominal = aiModelOptions('copy.section', { plan: 'pro' }, null)
    const priced = aiModelOptions('copy.section', { plan: 'pro' }, measured)
    expect(priced?.measured).toBe(true)
    expect(priced?.auto.creditsPerRequest).toBeGreaterThan(nominal?.auto.creditsPerRequest ?? 0)
  })

  it('never lists a tier the plan does not offer', () => {
    for (const plan of Object.keys(AI_PLAN_MODEL_TIERS) as OrgPlan[]) {
      for (const option of aiModelOptions('assist.chat', { plan }, null)?.options ?? []) {
        expect(AI_PLAN_MODEL_TIERS[plan]).toContain(option.tier)
      }
    }
  })
})

describe('the measured median', () => {
  const usage = (inputTokens: number, outputTokens: number) => ({
    inputTokens,
    outputTokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
  })

  it('needs three exchanges, and takes each field’s own middle', () => {
    expect(aiMedianUsage([usage(1, 1), usage(2, 2)])).toBeNull()
    expect(aiMedianUsage([usage(10, 5), usage(30, 1), usage(20, 9)])).toEqual(usage(20, 5))
    expect(aiMedianUsage([usage(10, 1), usage(20, 2), usage(30, 3), usage(40, 4)])).toEqual(usage(25, 3))
  })
})

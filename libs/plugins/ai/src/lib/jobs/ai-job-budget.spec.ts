/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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
 * How long a generation takes, planned from what one answer costs in time
 * (AGL-2907), counting every model call a generation may make (AGL-3036). The
 * rates are declared assumptions, so this suite holds the arithmetic built on
 * them — and that the developer notes still call them assumptions — rather
 * than anything about a provider's real speed. What it does hold for real is
 * that the doctrine's loop, driven through its lookup rounds and its re-ask on
 * a fake clock, never takes longer than the worst case the arithmetic plans.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyAiSiteInventory } from '../model/ai-site-inventory'
import { AI_MODEL_CATALOG, type AiCatalogEntry } from '../providers/catalog'
import type { AiCompletion, AiProvider, AiProviderRequest, AiTool } from '../providers/contract'
import { AI_GENERATION_MAX_ATTEMPTS, runValidatedGeneration } from '../runtime/ai-doctrine'
import {
  AI_INVENTORY_LOOKUP_MAX_ROUNDS,
  AI_INVENTORY_LOOKUP_TOOL_NAME,
} from '../tools/ai-inventory-lookup-tool'
import {
  AI_JOB_ASSUMED_FIRST_TOKEN_MS,
  AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND,
  AI_JOB_INLINE_BUDGET_MS,
  AI_JOB_STEP_MAX_MINIMUM_MS,
  AI_JOB_STEP_OVERHEAD_MS,
  AI_JOB_SWEEP_BUDGET_MS,
  AI_JOB_SWEEP_QUEUE_READ_MS,
  aiGenerationMaxTokensWithin,
  aiGenerationWorstCaseMs,
  aiGenerationWorstCaseOnTierMs,
  aiJobAssumedAnswerMs,
  aiJobBudgetTier,
  aiJobStepBudget,
} from './ai-job-budget'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')
const TIERS = ['fast', 'balanced', 'deep'] as const
const modelOn = (tier: AiCatalogEntry['tier']) =>
  AI_MODEL_CATALOG.find((entry) => entry.tier === tier)?.id as string

/** The developer notes, read as prose: a sentence the notes wrap across lines still says it. */
const notes = () => readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')

describe('the planning rates', () => {
  it('plan the slower tiers slower, and an unknown model at the slowest', () => {
    const rates = AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND
    expect(rates.fast).toBeGreaterThan(rates.balanced)
    expect(rates.balanced).toBeGreaterThan(rates.deep)
    for (const entry of AI_MODEL_CATALOG) expect([entry.id, aiJobBudgetTier(entry.id)]).toEqual([entry.id, entry.tier])
    expect(aiJobBudgetTier('a-model-no-catalog-lists')).toBe('deep')
  })

  it('are named as assumptions in the developer notes, with the figures the code uses', () => {
    const text = notes()
    expect(text).toMatch(/declared assumptions, not measurements/i)
    const { fast, balanced, deep } = AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND
    expect(text).toContain(`${fast}, ${balanced} and ${deep} output tokens a second`)
    expect(text).toContain(`${AI_JOB_ASSUMED_FIRST_TOKEN_MS / 1_000} s before a provider starts answering`)
    expect(text).toContain(`${AI_JOB_SWEEP_QUEUE_READ_MS / 1_000} s for the queue read before a sweep's first step`)
  })
})

describe('the most a step may need (AGL-3036)', () => {
  it('is the beat’s budget less its queue read, past an inline door’s budget', () => {
    expect(AI_JOB_STEP_MAX_MINIMUM_MS).toBe(AI_JOB_SWEEP_BUDGET_MS - AI_JOB_SWEEP_QUEUE_READ_MS)
    expect(AI_JOB_STEP_MAX_MINIMUM_MS).toBeGreaterThan(AI_JOB_INLINE_BUDGET_MS)
    expect(notes()).toContain(`${AI_JOB_STEP_MAX_MINIMUM_MS.toLocaleString('en-US')} ms a beat can give a step`)
  })

  it('reaches the machine and its doors from here, where the budget that bounds them is planned', () => {
    // The machine hands both budgets out rather than keeping copies of its own.
    const machine = readFileSync(join(__dirname, 'ai-jobs.ts'), 'utf8')
    expect(machine).toContain('export { AI_JOB_INLINE_BUDGET_MS, AI_JOB_SWEEP_BUDGET_MS }')
    expect(machine).not.toMatch(/export const AI_JOB_(INLINE|SWEEP)_BUDGET_MS =/)
  })
})

describe('aiGenerationWorstCaseMs', () => {
  it('waits for a first token on every call — each lookup round, the answer and its re-ask — and spends the allowance they share (AGL-3036)', () => {
    expect(AI_GENERATION_MAX_ATTEMPTS).toBe(2)
    expect(AI_INVENTORY_LOOKUP_MAX_ROUNDS).toBe(2)
    const balanced = modelOn('balanced')
    const answerMs = aiJobAssumedAnswerMs(1_000, 'balanced')
    expect(answerMs).toBe(Math.ceil((1_000 * 1_000) / AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND.balanced))
    // Unless told otherwise, a generation may look records up as often as the doctrine lets it.
    expect(aiGenerationWorstCaseMs({ maxTokens: 1_000, model: balanced })).toBe(
      4 * AI_JOB_ASSUMED_FIRST_TOKEN_MS + 2 * answerMs + AI_JOB_STEP_OVERHEAD_MS,
    )
    // One offered no inventory makes no lookup.
    expect(aiGenerationWorstCaseMs({ maxTokens: 1_000, model: balanced, lookups: 0 })).toBe(
      2 * AI_JOB_ASSUMED_FIRST_TOKEN_MS + 2 * answerMs + AI_JOB_STEP_OVERHEAD_MS,
    )
    // One request and no loop: the text step's shape.
    expect(aiGenerationWorstCaseMs({ maxTokens: 1_000, model: balanced, attempts: 1, lookups: 0 })).toBe(
      AI_JOB_ASSUMED_FIRST_TOKEN_MS + answerMs + AI_JOB_STEP_OVERHEAD_MS,
    )
    // A step's reads of its own are its own time.
    expect(aiGenerationWorstCaseMs({ maxTokens: 1_000, model: balanced, lookups: 0, ownReadsMs: 8_000 })).toBe(
      2 * AI_JOB_ASSUMED_FIRST_TOKEN_MS + 2 * answerMs + AI_JOB_STEP_OVERHEAD_MS + 8_000,
    )
  })

  it('is the same on a tier as for every model of it, and an unknown model is the slowest tier’s (AGL-3026)', () => {
    for (const entry of AI_MODEL_CATALOG) {
      expect([entry.id, aiGenerationWorstCaseOnTierMs({ tier: entry.tier, maxTokens: 8_000 })]).toEqual([
        entry.id,
        aiGenerationWorstCaseMs({ model: entry.id, maxTokens: 8_000 }),
      ])
    }
    expect(aiGenerationWorstCaseMs({ model: 'a-model-nobody-listed', maxTokens: 8_000 })).toBe(
      aiGenerationWorstCaseOnTierMs({ tier: 'deep', maxTokens: 8_000 }),
    )
  })
})

describe('the doctrine’s loop never outruns that worst case (AGL-3036)', () => {
  const CEILING = 1_200
  const LOOKUP_OUTPUT = 60
  const TOOL: AiTool = {
    name: 'submit_probe',
    description: 'Submit the probe.',
    strict: true,
    inputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
  }
  const usage = (outputTokens: number) => ({ inputTokens: 500, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const lookupCall = (outputTokens: number): AiCompletion => ({
    kind: 'completion',
    text: '',
    toolUse: [{ name: AI_INVENTORY_LOOKUP_TOOL_NAME, input: { kind: 'components', query: 'card' } }],
    usage: usage(outputTokens),
    estCostUsd: 0.001,
    stopReason: 'tool_use',
  })
  const answer = (ok: boolean, outputTokens: number): AiCompletion => ({
    kind: 'completion',
    text: '',
    toolUse: [{ name: TOOL.name, input: { ok } }],
    usage: usage(outputTokens),
    estCostUsd: 0.001,
    stopReason: 'tool_use',
  })

  /**
   * A provider on a fake clock: every call waits the assumed first token, then
   * is charged for exactly the output it answers with at the tier's rate.
   */
  function timed(tier: AiCatalogEntry['tier'], reply: (request: AiProviderRequest, call: number) => AiCompletion) {
    const clock = { ms: 0 }
    const requests: AiProviderRequest[] = []
    const fake: AiProvider = {
      id: 'fake',
      label: 'Fake',
      apiKeyEnv: 'FAKE_AI_KEY',
      endpointHost: 'ai.test',
      readApiKey: () => 'key',
      models: () => [],
      complete: async (request) => {
        requests.push(request)
        const completion = reply(request, requests.length)
        clock.ms += AI_JOB_ASSUMED_FIRST_TOKEN_MS + aiJobAssumedAnswerMs(completion.usage.outputTokens, tier)
        return completion
      },
      stream: async () => {
        throw new Error('the doctrine loop never streams')
      },
    }
    const run = () =>
      runValidatedGeneration('probe', {
        model: modelOn(tier),
        provider: fake,
        instructions: [{ text: 'Answer the probe.' }],
        inventory: emptyAiSiteInventory('host-1'),
        messages: [{ role: 'user' as const, content: 'Brief: a probe' }],
        tool: TOOL,
        maxTokens: CEILING,
        check: (input) =>
          input['ok'] === true
            ? { value: input, violations: [] }
            : { value: null, violations: [{ rule: null, code: 'probe-not-yet', message: 'Not yet.' }] },
      })
    return { clock, requests, run }
  }

  it.each(TIERS)(
    'on the %s tier, both lookup rounds, an answer that breaks a rule and its re-ask take exactly the worst case',
    async (tier) => {
      const { clock, requests, run } = timed(tier, (request, call) =>
        call <= AI_INVENTORY_LOOKUP_MAX_ROUNDS
          ? lookupCall(LOOKUP_OUTPUT)
          : // Every answer runs to the whole of what it was asked for.
            answer(call > AI_INVENTORY_LOOKUP_MAX_ROUNDS + 1, request.maxTokens as number),
      )
      const result = await run()
      expect(result.status).toBe('ok')
      expect(requests).toHaveLength(AI_INVENTORY_LOOKUP_MAX_ROUNDS + AI_GENERATION_MAX_ATTEMPTS)
      // Each call is asked for what is left of the allowance, never more than the ceiling.
      expect(requests.map((request) => request.maxTokens)).toEqual([
        CEILING,
        CEILING,
        CEILING,
        2 * CEILING - 2 * LOOKUP_OUTPUT - CEILING,
      ])
      expect(clock.ms + AI_JOB_STEP_OVERHEAD_MS).toBe(aiGenerationWorstCaseMs({ model: modelOn(tier), maxTokens: CEILING }))
    },
  )

  it.each(TIERS)(
    'on the %s tier, lookup rounds each answered at the ceiling spend the allowance, and the loop stops inside the worst case',
    async (tier) => {
      const { clock, requests, run } = timed(tier, (request) => lookupCall(request.maxTokens as number))
      const result = await run()
      expect(requests).toHaveLength(AI_INVENTORY_LOOKUP_MAX_ROUNDS)
      expect(result.status).toBe('needs_input')
      if (result.status !== 'needs_input') return
      expect(result.violations.map((violation) => violation.code)).toEqual(['answer-cut-off'])
      expect(clock.ms + AI_JOB_STEP_OVERHEAD_MS).toBeLessThanOrEqual(
        aiGenerationWorstCaseMs({ model: modelOn(tier), maxTokens: CEILING }),
      )
    },
  )
})

describe('aiGenerationMaxTokensWithin', () => {
  const budgets = [AI_JOB_INLINE_BUDGET_MS, AI_JOB_SWEEP_BUDGET_MS, AI_JOB_STEP_MAX_MINIMUM_MS, 50_000, 16_000]

  it('is the largest ceiling whose worst case fits the budget, on every catalog model, with and without lookups', () => {
    for (const entry of AI_MODEL_CATALOG) {
      for (const budgetMs of budgets) {
        for (const lookups of [0, AI_INVENTORY_LOOKUP_MAX_ROUNDS]) {
          const ceiling = aiGenerationMaxTokensWithin({ budgetMs, model: entry.id, cap: 1_000_000, lookups })
          const label = `${entry.id} in ${budgetMs} ms with ${lookups} lookups`
          expect([label, ceiling > 0]).toEqual([label, true])
          expect([label, aiGenerationWorstCaseMs({ maxTokens: ceiling, model: entry.id, lookups }) <= budgetMs]).toEqual([label, true])
          expect([label, aiGenerationWorstCaseMs({ maxTokens: ceiling + 1, model: entry.id, lookups }) > budgetMs]).toEqual([label, true])
        }
      }
    }
  })

  it('never passes its cap, and is zero when not even an empty answer fits', () => {
    const [entry] = AI_MODEL_CATALOG
    expect(aiGenerationMaxTokensWithin({ budgetMs: 600_000, model: entry.id, cap: 2_000 })).toBe(2_000)
    const floor = 4 * AI_JOB_ASSUMED_FIRST_TOKEN_MS + AI_JOB_STEP_OVERHEAD_MS
    expect(aiGenerationMaxTokensWithin({ budgetMs: floor, model: entry.id, cap: 2_000 })).toBe(0)
  })
})

describe('aiJobStepBudget (AGL-3035, AGL-3036)', () => {
  it('registers the worst case at the routing ceiling where it fits a beat, and asks the whole ceiling on the served tier', () => {
    const budget = aiJobStepBudget({ tier: 'balanced', maxTokens: 6_000 })
    expect(budget.minimumMs).toBe(aiGenerationWorstCaseOnTierMs({ tier: 'balanced', maxTokens: 6_000 }))
    expect(budget.minimumMs).toBeLessThanOrEqual(AI_JOB_STEP_MAX_MINIMUM_MS)
    expect(budget.maxTokens(modelOn('balanced'))).toBe(6_000)
    expect(budget.maxTokens(modelOn('fast'))).toBe(6_000)
    expect(budget.maxTokens(modelOn('deep'))).toBeLessThan(6_000)
  })

  it('asks less than the routing ceiling on the served tier when its worst case could never start, and registers what that takes', () => {
    const budget = aiJobStepBudget({ tier: 'balanced', maxTokens: 8_000 })
    expect(aiGenerationWorstCaseOnTierMs({ tier: 'balanced', maxTokens: 8_000 })).toBeGreaterThan(AI_JOB_STEP_MAX_MINIMUM_MS)
    const served = budget.maxTokens(modelOn('balanced'))
    expect(served).toBeLessThan(8_000)
    expect(budget.minimumMs).toBe(aiGenerationWorstCaseOnTierMs({ tier: 'balanced', maxTokens: served }))
    expect(budget.minimumMs).toBeLessThanOrEqual(AI_JOB_STEP_MAX_MINIMUM_MS)
    expect(aiGenerationWorstCaseOnTierMs({ tier: 'balanced', maxTokens: served + 1 })).toBeGreaterThan(AI_JOB_STEP_MAX_MINIMUM_MS)
  })

  it('fits every catalog model inside the minimum, and lets a faster tier ask up to a cap above the served ceiling', () => {
    const budget = aiJobStepBudget({ tier: 'balanced', maxTokens: 1_000, cap: 2_000, lookups: 0 })
    for (const entry of AI_MODEL_CATALOG) {
      const ceiling = budget.maxTokens(entry.id)
      expect([entry.id, ceiling > 0, ceiling <= 2_000]).toEqual([entry.id, true, true])
      expect([entry.id, aiGenerationWorstCaseMs({ model: entry.id, maxTokens: ceiling, lookups: 0 }) <= budget.minimumMs]).toEqual([
        entry.id,
        true,
      ])
    }
    expect(budget.maxTokens(modelOn('balanced'))).toBe(1_000)
    expect(budget.maxTokens(modelOn('fast'))).toBeGreaterThan(1_000)
  })
})

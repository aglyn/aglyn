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
 * (AGL-2907). The rates are declared assumptions, so this suite holds the
 * arithmetic built on them — and that the developer notes still call them
 * assumptions — rather than anything about a provider's real speed.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AI_MODEL_CATALOG } from '../providers/catalog'
import { AI_GENERATION_MAX_ATTEMPTS } from '../runtime/ai-doctrine'
import {
  AI_JOB_ASSUMED_FIRST_TOKEN_MS,
  AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND,
  AI_JOB_STEP_OVERHEAD_MS,
  aiGenerationMaxTokensWithin,
  aiGenerationWorstCaseMs,
  aiGenerationWorstCaseOnTierMs,
  aiJobBudgetTier,
} from './ai-job-budget'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..')

/** A budget constant as the machine declares it, read from its source so the machine is not loaded. */
function machineConstant(name: string): number {
  const source = readFileSync(join(__dirname, 'ai-jobs.ts'), 'utf8')
  const match = new RegExp(`export const ${name} = ([\\d_]+)`).exec(source)
  if (!match) throw new Error(`ai-jobs.ts declares no ${name}`)
  return Number(match[1].replace(/_/g, ''))
}

describe('the planning rates', () => {
  it('plan the slower tiers slower, and an unknown model at the slowest', () => {
    const rates = AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND
    expect(rates.fast).toBeGreaterThan(rates.balanced)
    expect(rates.balanced).toBeGreaterThan(rates.deep)
    for (const entry of AI_MODEL_CATALOG) expect([entry.id, aiJobBudgetTier(entry.id)]).toEqual([entry.id, entry.tier])
    expect(aiJobBudgetTier('a-model-no-catalog-lists')).toBe('deep')
  })

  it('are named as assumptions in the developer notes, with the figures the code uses', () => {
    // Read as prose: a sentence the notes wrap across lines still says it.
    const notes = readFileSync(join(REPO_ROOT, 'docs/AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect(notes).toMatch(/declared assumptions, not measurements/i)
    const { fast, balanced, deep } = AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND
    expect(notes).toContain(`${fast}, ${balanced} and ${deep} output tokens a second`)
    expect(notes).toContain(`${AI_JOB_ASSUMED_FIRST_TOKEN_MS / 1_000} s before a provider starts answering`)
  })
})

describe('aiGenerationWorstCaseMs', () => {
  it('is every attempt answered at its ceiling, with the step’s own reads and writes', () => {
    expect(AI_GENERATION_MAX_ATTEMPTS).toBe(2)
    const balanced = AI_MODEL_CATALOG.find((entry) => entry.tier === 'balanced')?.id as string
    const answerMs = Math.ceil((1_000 / AI_JOB_ASSUMED_OUTPUT_TOKENS_PER_SECOND.balanced) * 1_000)
    expect(aiGenerationWorstCaseMs({ maxTokens: 1_000, model: balanced })).toBe(
      2 * (AI_JOB_ASSUMED_FIRST_TOKEN_MS + answerMs) + AI_JOB_STEP_OVERHEAD_MS,
    )
    expect(aiGenerationWorstCaseMs({ maxTokens: 1_000, model: balanced, attempts: 1 })).toBe(
      AI_JOB_ASSUMED_FIRST_TOKEN_MS + answerMs + AI_JOB_STEP_OVERHEAD_MS,
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

describe('aiGenerationMaxTokensWithin', () => {
  const budgets = [
    machineConstant('AI_JOB_INLINE_BUDGET_MS'),
    machineConstant('AI_JOB_SWEEP_BUDGET_MS'),
    44_000,
    12_000,
  ]

  it('is the largest ceiling whose worst case fits the budget, on every catalog model', () => {
    for (const entry of AI_MODEL_CATALOG) {
      for (const budgetMs of budgets) {
        const ceiling = aiGenerationMaxTokensWithin({ budgetMs, model: entry.id, cap: 1_000_000 })
        const label = `${entry.id} in ${budgetMs} ms`
        expect([label, aiGenerationWorstCaseMs({ maxTokens: ceiling, model: entry.id }) <= budgetMs]).toEqual([label, true])
        expect([label, aiGenerationWorstCaseMs({ maxTokens: ceiling + 1, model: entry.id }) > budgetMs]).toEqual([label, true])
      }
    }
  })

  it('never passes its cap, and is zero when not even an empty answer fits', () => {
    const [entry] = AI_MODEL_CATALOG
    expect(aiGenerationMaxTokensWithin({ budgetMs: 600_000, model: entry.id, cap: 2_000 })).toBe(2_000)
    const floor = 2 * AI_JOB_ASSUMED_FIRST_TOKEN_MS + AI_JOB_STEP_OVERHEAD_MS
    expect(aiGenerationMaxTokensWithin({ budgetMs: floor, model: entry.id, cap: 2_000 })).toBe(0)
  })
})

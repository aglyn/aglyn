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

jest.mock('../runtime/site-inventory', () => ({ __esModule: true, readSiteInventory: jest.fn() }))

import { AI_MODEL_CATALOG } from '../providers/catalog'
import { buildAnthropicRequestBody } from '../providers/anthropic'
import {
  AI_JOB_LAYOUT_LANGUAGE_BUDGET,
  AI_JOB_LAYOUT_LANGUAGE_TOKENS,
} from './ai-job-layout-language'
import {
  AI_JOB_PAGE_LANGUAGE_BUDGET,
  AI_JOB_PAGE_LANGUAGE_FOLLOW_UP_TOKENS,
  AI_JOB_PAGE_LANGUAGE_TOKENS,
  AI_LAYOUT_LANGUAGE_THINKING,
  AI_LAYOUT_PAGE_THINKING_TOKENS,
} from './ai-job-page-language'

/** The most output tokens a live language answer wrote on 2026-10-07: a page, and a header and footer. */
const LIVE_MOST = { page: 1_745, frame: 583 }

const BALANCED = AI_MODEL_CATALOG.filter((entry) => entry.tier === 'balanced').map((entry) => entry.id)

describe('the layout language thinks, with room to (AGL-3660)', () => {
  it('asks adaptively, at an effort it names', () => {
    expect(AI_LAYOUT_LANGUAGE_THINKING).toEqual({ thinking: 'adaptive', effort: 'medium' })
  })

  it('sends Claude Sonnet 5.5 adaptive thinking at medium, never a disabled setting', () => {
    const body = buildAnthropicRequestBody({
      model: 'claude-sonnet-5-5',
      maxTokens: AI_JOB_PAGE_LANGUAGE_TOKENS,
      system: [{ text: 'rules', cacheBreakpoint: true }],
      messages: [{ role: 'user', content: 'a page' }],
      stream: false,
      ...AI_LAYOUT_LANGUAGE_THINKING,
    })
    expect(body['thinking']).toEqual({ type: 'adaptive' })
    expect(body['output_config']).toEqual({ effort: 'medium' })
  })

  it.each(BALANCED)('serves a page its whole ceiling on %s: the time budget cuts nothing off', (model) => {
    // `aiJobStepBudget` lowers a ceiling whose worst case does not fit a
    // beat's least time. A ceiling lowered under the answer plus its thinking
    // would cut every thoughtful page off — at 5,000 of room it was 879.
    expect(AI_JOB_PAGE_LANGUAGE_BUDGET.maxTokens(model)).toBe(AI_JOB_PAGE_LANGUAGE_TOKENS)
    expect(AI_JOB_LAYOUT_LANGUAGE_BUDGET.maxTokens(model)).toBe(AI_JOB_LAYOUT_LANGUAGE_TOKENS)
  })

  it('leaves room for thinking above the largest answer the live runs wrote', () => {
    expect(AI_JOB_PAGE_LANGUAGE_TOKENS - LIVE_MOST.page).toBeGreaterThanOrEqual(AI_LAYOUT_PAGE_THINKING_TOKENS)
    expect(AI_JOB_LAYOUT_LANGUAGE_TOKENS - LIVE_MOST.frame).toBeGreaterThanOrEqual(4_000)
    expect(AI_JOB_PAGE_LANGUAGE_FOLLOW_UP_TOKENS).toBeGreaterThan(1_500)
  })
})

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

jest.mock('@aglyn/aglyn/plugin-manager/plugin-site-cache', () => ({ __esModule: true, dropPluginSiteCache: jest.fn(async () => undefined) }))

import { DEFAULT_SITE_THEME } from '@aglyn/aglyn/app-utils/default-site'
import type { AiJob } from '../model/ai-jobs.types'
import { aiSiteKind } from '../model/ai-site-kinds'
import { aiSiteLookSignature, aiSiteSeed, aiSiteStyleFor, type AiSiteLookAnswer, type AiSiteStyle } from '../model/ai-site-look'
import { aiRunSiteLook, aiSiteLookPrompt, aiSiteThemeUntouched } from './ai-job-site-look'

const trades = aiSiteKind('trades') as NonNullable<ReturnType<typeof aiSiteKind>>

const job = (overrides: Partial<AiJob> = {}): AiJob =>
  ({
    $id: 'job-1-t',
    orgId: 'org-1',
    hostId: 'host-1',
    kind: 'theme',
    brief: 'A roofing company in Tulsa.',
    inputs: { businessType: 'a roofing company', siteKind: 'trades', originJobId: 'job-1' },
    steps: [],
    outputs: [],
    ...overrides,
  }) as unknown as AiJob

const spent = { usage: { inputTokens: 300, outputTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 }, estCostUsd: 0.001, model: 'claude-haiku-4-5', stopReason: 'tool_use', attempts: 1, effort: null }

describe('the look unit (AGL-3660)', () => {
  it('offers the kind’s bases and pairings in the job’s own order', () => {
    const bases = trades.look.bases.map((base) => ({ base, words: base }))
    const one = aiSiteLookPrompt({ job: job({ $id: 'job-a' }), kind: trades, bases })
    const two = aiSiteLookPrompt({ job: job({ $id: 'job-zz' }), kind: trades, bases })
    expect(one).toContain('Kind of site: Home services & trades.')
    const line = (prompt: string) => prompt.split('\n').find((text) => text.startsWith('Base themes')) ?? ''
    expect(line(one)).not.toBe(line(two))
  })

  it('draws the site apart from the workspace’s other sites, saves it, and reports one output', async () => {
    const answer: AiSiteLookAnswer = { base: 'carbon', hue: 210, fonts: 'oswald', buttons: 'caps' }
    const sibling = aiSiteStyleFor({ kind: trades, answer, seed: aiSiteSeed('job-1') })
    let saved: AiSiteStyle | null = null
    const outcome = await aiRunSiteLook({ job: job(), stepIndex: 0, now: new Date(), firestore: {} as never }, job(), {
      generate: (async () => ({ status: 'ok', value: answer, ...spent })) as never,
      others: async () => [sibling],
      save: async (_firestore, input) => {
        saved = input.style
        return { write: 'applied', baseName: 'Carbon' }
      },
    })
    expect(outcome.outputs).toEqual([expect.objectContaining({ resource: 'theme', id: 'look', hostId: 'host-1' })])
    const own = aiSiteLookSignature(saved as unknown as AiSiteStyle)
    const other = aiSiteLookSignature(sibling)
    expect(['base', 'hueFamily', 'fonts', 'buttons'].every((key) => own[key as 'base'] === other[key as 'base'])).toBe(false)
  })

  it('still designs a look when the answer could not be used', async () => {
    let saved: AiSiteStyle | null = null
    const outcome = await aiRunSiteLook({ job: job(), stepIndex: 0, now: new Date(), firestore: {} as never }, job(), {
      generate: (async () => ({ status: 'needs_input', violations: [], message: 'x', ...spent })) as never,
      others: async () => [],
      save: async (_firestore, input) => {
        saved = input.style
        return { write: 'applied', baseName: 'Bootstrap' }
      },
    })
    expect(outcome.outputs).toHaveLength(1)
    expect((saved as unknown as AiSiteStyle).kind).toBe('trades')
  })

  it('runs on the model the person picked, else the fast tier of the job’s provider', async () => {
    const models: string[] = []
    const run = (overrides: Partial<AiJob>) =>
      aiRunSiteLook(
        { job: job(overrides), stepIndex: 0, now: new Date(), firestore: {} as never, modelFor: () => 'claude-opus-5' },
        job(overrides),
        {
          generate: (async (_kind: string, input: { model: string }) => {
            models.push(input.model)
            return { status: 'ok', value: {}, ...spent }
          }) as never,
          others: async () => [],
          save: async () => ({ write: 'applied', baseName: 'Minimal' }),
        },
      )
    await run({ model: 'claude-opus-5' } as Partial<AiJob>)
    await run({})
    expect(models[0]).toBe('claude-opus-5')
    expect(models[1]).not.toBe('claude-opus-5')
  })

  it('replaces only the theme a site was born with', () => {
    expect(aiSiteThemeUntouched({ theme: DEFAULT_SITE_THEME })).toBe(true)
    expect(aiSiteThemeUntouched({})).toBe(true)
    expect(aiSiteThemeUntouched({ theme: DEFAULT_SITE_THEME, themeOverride: { patch: { shape: { borderRadius: 4 } } } })).toBe(false)
    expect(aiSiteThemeUntouched({ theme: { ...DEFAULT_SITE_THEME, shape: { borderRadius: 2 } } })).toBe(false)
    expect(aiSiteThemeUntouched({ theme: DEFAULT_SITE_THEME, themeSelection: { kind: 'preset', id: 'theme-presets.minimal', name: 'Minimal' } })).toBe(false)
  })
})

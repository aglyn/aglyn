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
 * THE ASSIST SIGNAL BOARD, AS THE STAFF APPS PRINT IT (AGL-3667).
 *
 * `/api/ai/admin/signals?view=prepared` sends each table of the page as the
 * lines it prints. These pin the figures the page words: money to four places
 * under a dollar, shares as whole percents, a ranking that says it is a cut,
 * and the empty sentences that keep "nothing spent" apart from "priced at $0".
 */

import { mineAssistSignals, type AssistSignalRow } from './assist-signal-mining'
import { assistSignalsView, money, percent, rankingFootnote } from './assist-signals-view'

const turn = (overrides: Partial<AssistSignalRow>): AssistSignalRow => ({
  orgId: 'org-a',
  exchangeId: 'x1',
  route: '/org/hosts/site/pages',
  kind: 'chat',
  model: 'model-one',
  tier: 'entitled',
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadTokens: 500,
  cacheWriteTokens: 0,
  providerCostUsd: 0.0042,
  docsPaths: ['docs/pages'],
  stopReason: 'end_turn',
  feedback: null,
  deflected: false,
  ...overrides,
})

describe('the Assist signal board for the staff apps', () => {
  it('prints money to four places under a dollar and two above, and shares as whole percents', () => {
    expect(money(0.0042)).toBe('$0.0042')
    expect(money(12.5)).toBe('$12.50')
    expect(percent(0.456)).toBe('46%')
    expect(percent(null)).toBe('\u2014')
  })

  it('says a ranking is a cut when it is', () => {
    expect(rankingFootnote(5, 5, { one: 'workspace', many: 'workspaces' })).toBe('Showing all 5 workspaces.')
    expect(rankingFootnote(25, 60, { one: 'workspace', many: 'workspaces' })).toContain('Showing the top 25 of 60 workspaces.')
    expect(rankingFootnote(0, 0, { one: 'workspace', many: 'workspaces' })).toBe('')
  })

  it('folds a report into the fleet chips, the splits and the docs gaps', () => {
    const report = mineAssistSignals(
      [
        turn({ exchangeId: 'a', feedback: 'down' }),
        turn({ exchangeId: 'b', tier: 'free', model: 'model-two', providerCostUsd: 0.001 }),
        turn({ exchangeId: 'c', deflected: true, providerCostUsd: 0, docsPaths: [] }),
      ],
      { limit: 25 },
    )
    const view = assistSignalsView(report)
    expect(view.fleet.chips[0]).toBe('3 turns')
    expect(view.fleet.chips).toEqual(expect.arrayContaining(['$0.0052 estimated', expect.stringContaining('answered free')]))
    expect(view.split.empty).toBe('')
    expect(view.split.tier.map((row) => row.key).sort()).toEqual(['entitled', 'free'])
    expect(view.split.tier[0].detail).toContain('turns')
    expect(view.docsGaps.rows[0]).toMatchObject({ path: 'docs/pages' })
    expect(view.docsGaps.rows[0].headline).toContain('down rate')
    expect(view.ungrounded.rows.length).toBeGreaterThan(0)
  })

  it('keeps "nothing was spent" apart from "priced at zero"', () => {
    const deflected = assistSignalsView(
      mineAssistSignals([turn({ deflected: true, providerCostUsd: 0 })], { limit: 25 }),
    )
    expect(deflected.split.empty).toContain('answered from the docs index or the answer cache')
    const unpriced = assistSignalsView(mineAssistSignals([turn({ providerCostUsd: 0 })], { limit: 25 }))
    expect(unpriced.split.empty).toContain('a gap in the rate table, not a saving')
  })

  it('words the spend board, its failure and a refused row', () => {
    const report = {
      ...mineAssistSignals([turn({})], { limit: 25 }),
      spend: {
        month: '2026-10',
        ranked: 40,
        truncated: false,
        failed: false,
        rows: [
          {
            orgId: 'org-a',
            orgLabel: 'Acme',
            plan: 'pro',
            aiAddon: true,
            credits: 1200,
            providerCostUsd: 3.5,
            refusals: { band: 1, cap: 0, messages: 2, budget: 0, allotment: 0, account: 1, requests: 0, refusals: 0, platform: 0, total: 3 },
          },
        ],
      },
    }
    const view = assistSignalsView(report as never)
    expect(view.spend.heading).toBe('AI spend this month, by workspace \u00b7 2026-10')
    expect(view.spend.rows[0]).toMatchObject({ workspace: 'Acme', addon: 'on', cost: '$3.50', refusals: '3' })
    expect(view.spend.rows[0].refusalDetail).toContain('free taste 1')
    expect(view.spend.footnote).toContain('Showing the top 1 of 40 workspaces')
    const failed = assistSignalsView({ ...report, spend: { ...report.spend, rows: [], failed: true } } as never)
    expect(failed.spend.note).toContain('a failed read, not a month in which nobody spent')
  })
})

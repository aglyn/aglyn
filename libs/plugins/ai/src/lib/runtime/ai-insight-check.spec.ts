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

import type { AiInsightTable } from '../model/ai-insight'
import {
  aiInsightGap,
  aiInsightNumbers,
  checkAiInsight,
  checkAiInsightAnswer,
} from './ai-insight-check'

/**
 * Every insight a person reads is traced to the rows it cites (AGL-2915):
 * a number that is not in them, a rise the change does not show, a row that
 * does not exist or a person named is left out — and a sentence that reads
 * its table honestly, however it rounds or words it, is kept.
 */

const TRAFFIC: AiInsightTable = {
  ref: 't1',
  reader: 'traffic.summary',
  days: 14,
  scope: 'site',
  title: 'Traffic',
  source: { label: 'Analytics', path: 'analytics' },
  period: { from: '2026-09-03', to: '2026-09-16', days: 14 },
  columns: [
    { key: 'metric', label: 'Figure', kind: 'text' },
    { key: 'current', label: 'This window', kind: 'count' },
    { key: 'previous', label: 'Window before', kind: 'count' },
    { key: 'change', label: 'Change', kind: 'change' },
  ],
  rows: [
    { metric: 'Page views', current: 1204, previous: 1050, change: 14.7 },
    { metric: 'Visitors', current: 830, previous: 874, change: -5 },
    { metric: 'Avg. per day', current: 86, previous: 75, change: null },
  ],
  omitted: 0,
  notes: [],
}

const ORDERS: AiInsightTable = {
  ref: 't2',
  reader: 'commerce.sales',
  days: 30,
  scope: 'site',
  title: 'Orders',
  source: { label: 'Orders', path: 'commerce/orders' },
  period: { from: '2026-08-18', to: '2026-09-16', days: 30 },
  columns: [
    { key: 'figure', label: 'Figure', kind: 'text' },
    { key: 'value', label: 'Value', kind: 'money', currency: 'USD' },
  ],
  rows: [
    { figure: 'Revenue', value: 18234.5 },
    { figure: 'Average order value', value: 64.2 },
  ],
  omitted: 0,
  notes: [],
}

const PAGES: AiInsightTable = {
  ref: 't3',
  reader: 'traffic.pages',
  days: 14,
  scope: 'site',
  title: 'Top pages',
  source: { label: 'Analytics', path: 'analytics' },
  period: { from: '2026-09-03', to: '2026-09-16', days: 14 },
  columns: [
    { key: 'path', label: 'Page', kind: 'text' },
    { key: 'views', label: 'Views', kind: 'count' },
    { key: 'share', label: 'Share', kind: 'percent' },
    { key: 'dwell', label: 'Avg. time', kind: 'duration' },
  ],
  rows: [
    { path: '/pricing-2026', views: 410, share: 34.1, dwell: 124 },
    { path: '/', views: 388, share: 32.2, dwell: 45 },
    { path: '/contact', views: 97, share: 8.1, dwell: 3_900 },
  ],
  omitted: 0,
  notes: [],
}

const TABLES = [TRAFFIC, ORDERS, PAGES]

const kept = (text: string, cites = [{ table: 't1', rows: [0] }]) =>
  expect([text, checkAiInsight({ text, cites }, TABLES)]).toEqual([text, []])

const left = (text: string, finding: string | RegExp, cites = [{ table: 't1', rows: [0] }]) => {
  const findings = checkAiInsight({ text, cites }, TABLES)
  expect([text, findings]).toEqual([
    text,
    expect.arrayContaining([typeof finding === 'string' ? finding : expect.stringMatching(finding)]),
  ])
}

describe('reading the numbers a sentence writes', () => {
  it('reads separators, decimals, signs, currencies and units', () => {
    expect(
      aiInsightNumbers('Revenue was $18,234.50, up 14.7% on 1,050 views, or -5 and 1.2k and 3 minutes').map(
        ({ value, decimals, negative, unit }) => ({ value, decimals, negative, unit }),
      ),
    ).toEqual([
      { value: 18234.5, decimals: 2, negative: false, unit: 'currency' },
      { value: 14.7, decimals: 1, negative: false, unit: 'percent' },
      { value: 1050, decimals: 0, negative: false, unit: null },
      { value: 5, decimals: 0, negative: true, unit: null },
      { value: 1.2, decimals: 1, negative: false, unit: 'thousand' },
      { value: 3, decimals: 0, negative: false, unit: 'minutes' },
    ])
  })

  it('reads minutes and seconds written together as one figure', () => {
    expect(aiInsightNumbers('Visitors stay 2m 04s on it').map(({ value, unit }) => ({ value, unit }))).toEqual([
      { value: 124, unit: 'seconds' },
    ])
  })

  it('does not read the digits inside a word', () => {
    expect(aiInsightNumbers('Q3 and t1 and h2o')).toEqual([])
  })
})

describe('an insight that traces is kept', () => {
  it('quotes its figures as the table has them', () => {
    kept('Page views rose 14.7% to 1,204 in the last 14 days.')
    kept('Page views rose from 1,050 to 1,204.')
  })

  it('rounds or cuts to the decimals it writes', () => {
    kept('Page views rose about 15%.')
    kept('Page views rose more than 14%.')
    kept('Revenue reached $18.2k.', [{ table: 't2', rows: [0] }])
    kept('Revenue reached $18,234.50, with an average order of $64.20.', [{ table: 't2', rows: [0, 1] }])
  })

  it('reads a fall written without a sign', () => {
    kept('Visitors fell 5% to 830.', [{ table: 't1', rows: [1] }])
  })

  it('reads durations in the unit written', () => {
    kept('Visitors spend about 2 minutes on the pricing page.', [{ table: 't3', rows: [0] }])
    kept('Visitors spend 2m 04s on the pricing page.', [{ table: 't3', rows: [0] }])
    kept('The contact page holds visitors for over an hour: 1 hour on average.', [{ table: 't3', rows: [2] }])
  })

  it('may name the window, a date in it, or how many rows it cites', () => {
    kept('Between September 3 and September 16, your top 3 pages drew 410, 388 and 97 views.', [
      { table: 't3', rows: [0, 1, 2] },
    ])
  })

  it('may repeat a number written in a label it cites', () => {
    kept('/pricing-2026 is your most visited page, with 410 views and 34.1% of all views.', [
      { table: 't3', rows: [0] },
    ])
  })

  it('may say something without a number, as long as it cites the row', () => {
    kept('Your pricing page is the page people read most.', [{ table: 't3', rows: [0] }])
  })
})

describe('an insight that does not trace is left out', () => {
  it('when a number is in no row it cites', () => {
    left('Page views rose 22% to 1,204.', 'insight-number-untraced:22%')
    // The figure is in the table, but in a row the insight does not cite.
    left('Visitors fell to 830.', 'insight-number-untraced:830', [{ table: 't1', rows: [0] }])
  })

  it('when it computes a figure of its own', () => {
    // 1,204 − 1,050 = 154: true, and in no row.
    left('Page views grew by 154.', 'insight-number-untraced:154')
    // 410 + 388 + 97 = 895: a total no reader returned.
    left('Your top 3 pages drew 895 views between them.', 'insight-number-untraced:895', [
      { table: 't3', rows: [0, 1, 2] },
    ])
  })

  it('when a unit reads a column of another kind', () => {
    left('Revenue reached 1,204%.', 'insight-number-untraced:1,204%')
    left('Revenue reached $1,204.', 'insight-number-untraced:$1,204')
  })

  it('when the direction it names contradicts the change it quotes', () => {
    left('Page views fell 14.7%.', 'insight-direction:14.7%')
    left('Visitors rose 5%.', 'insight-direction:5%', [{ table: 't1', rows: [1] }])
  })

  it('when it cites a table or a row the job did not read', () => {
    left('Page views rose 14.7%.', 'insight-unknown-table:t9', [{ table: 't9', rows: [0] }])
    left('Page views rose 14.7%.', 'insight-unknown-row:t1:7', [{ table: 't1', rows: [7] }])
  })

  it('when it cites nothing', () => {
    left('Your site is doing well.', 'insight-no-citation', [])
    left('Your site is doing well.', 'insight-no-citation', [{ table: 't1', rows: [] }])
  })

  it('when it names a person, or is not plain words', () => {
    left('Most orders came from sam.rep@example.org, 1,204 of them.', 'insight-personal-details')
    left('**Page views** rose 14.7%.', 'insight-markup')
    left('x'.repeat(300), 'insight-too-long')
  })
})

describe('an answer', () => {
  it('keeps what traces, leaves out what does not, and counts it', () => {
    const check = checkAiInsightAnswer(
      {
        insights: [
          { text: 'Page views rose 14.7% to 1,204.', cites: [{ table: 't1', rows: [0] }] },
          { text: 'Visitors rose 12%.', cites: [{ table: 't1', rows: [1] }] },
          { text: 'Revenue reached $18,234.50.', cites: [{ table: 't2', rows: [0] }] },
        ],
        gap: 'The figures do not say which campaigns sent these visitors.',
      },
      TABLES,
    )
    expect(check.kept.map((insight) => insight.text)).toEqual([
      'Page views rose 14.7% to 1,204.',
      'Revenue reached $18,234.50.',
    ])
    expect(check.left.map((verdict) => verdict.findings)).toEqual([['insight-number-untraced:12%']])
    expect(check.gap).toBe('The figures do not say which campaigns sent these visitors.')
  })

  it('reads no more than five insights', () => {
    const insight = { text: 'Page views rose 14.7%.', cites: [{ table: 't1', rows: [0] }] }
    const check = checkAiInsightAnswer({ insights: Array(7).fill(insight), gap: null }, TABLES)
    expect(check.kept).toHaveLength(5)
    expect(check.left.map((verdict) => verdict.findings)).toEqual([['insight-too-many'], ['insight-too-many']])
  })

  it('reads nothing from an answer that is not one', () => {
    expect(checkAiInsightAnswer(null, TABLES)).toEqual({ kept: [], left: [], gap: null, findings: [] })
  })
})

describe('the gap sentence', () => {
  it('is a short sentence without figures that names nobody', () => {
    expect(aiInsightGap('  Refunds are not in these figures. ')).toBe('Refunds are not in these figures.')
    expect(aiInsightGap('Only 3 of the forms are counted.')).toBeNull()
    expect(aiInsightGap('Ask sam.rep@example.org.')).toBeNull()
    expect(aiInsightGap('x'.repeat(250))).toBeNull()
    expect(aiInsightGap(null)).toBeNull()
  })
})

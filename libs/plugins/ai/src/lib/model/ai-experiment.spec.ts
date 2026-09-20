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

import type { PluginFigureTable } from '@aglyn/aglyn/plugin-manager/plugin-figures'
import {
  AI_EXPERIMENT_CONFIDENCE,
  AI_EXPERIMENT_NEXT_INCONCLUSIVE,
  AI_EXPERIMENT_MIN_EXPOSURES,
  aiExperimentConfidenceThreshold,
  aiExperimentTarget,
  aiExperimentTask,
  aiExperimentTestNames,
  aiExperimentVerdictNamesWinner,
  checkAiExperimentExplanation,
  checkAiExperimentVariants,
  isAiExperimentTable,
  readAiExperimentArms,
  readAiExperimentResult,
  type AiExperimentArm,
  type AiExperimentExplanationAnswer,
  type AiExperimentVariantsProposal,
} from './ai-experiment'

/**
 * A/B tests by AI (AGL-2914): the reading a result supports, and what an
 * explanation is allowed to say about it.
 *
 * The verdict is decided here rather than by the model, so this file is where
 * the one thing that must never happen is held: an explanation that names a
 * winner a result does not support.
 */

const COLUMNS: PluginFigureTable['columns'] = [
  { key: 'test', label: 'Test', kind: 'text' },
  { key: 'variant', label: 'Variant', kind: 'text' },
  { key: 'shown', label: 'Shown', kind: 'count' },
  { key: 'conversions', label: 'Conversions', kind: 'count' },
  { key: 'rate', label: 'Conversion rate', kind: 'percent' },
  { key: 'lift', label: 'Lift over the first variant', kind: 'change' },
  { key: 'confidence', label: 'Confidence in the lift', kind: 'percent' },
]

const table = (rows: PluginFigureTable['rows']): PluginFigureTable => ({
  title: 'A/B tests',
  source: { label: 'A/B testing', path: 'marketing/experiments' },
  period: null,
  columns: COLUMNS,
  rows,
  omitted: 0,
  notes: [],
})

const arm = (
  id: string,
  exposures: number,
  conversions: number,
  confidence: number | null = null,
): AiExperimentArm => ({
  id,
  exposures,
  conversions,
  rate: exposures ? Math.round((conversions / exposures) * 1_000) / 10 : null,
  lift: null,
  confidence,
})

describe('reading the results table', () => {
  it('knows the A/B test table by the columns marketing publishes', () => {
    expect(isAiExperimentTable(table([]))).toBe(true)
    expect(
      isAiExperimentTable({
        ...table([]),
        columns: COLUMNS.filter((column) => column.key !== 'confidence'),
      }),
    ).toBe(false)
  })

  it('takes one test’s arms in the order the table gave them', () => {
    const rows = [
      { test: 'Hero', variant: 'A', shown: 900, conversions: 45, rate: 5, lift: null, confidence: null },
      { test: 'Hero', variant: 'B', shown: 880, conversions: 70, rate: 8, lift: 59.2, confidence: 98.1 },
      { test: 'Pricing', variant: 'A', shown: 500, conversions: 10, rate: 2, lift: null, confidence: null },
    ]
    expect(aiExperimentTestNames(table(rows))).toEqual(['Hero', 'Pricing'])
    expect(readAiExperimentArms(table(rows), 'Hero').map((entry) => entry.id)).toEqual(['A', 'B'])
    expect(readAiExperimentArms(table(rows), 'Hero')[1].confidence).toBe(98.1)
  })

  it('reads nothing from a table that is not the results', () => {
    const wrong = { ...table([{ shown: 1 }]), columns: [COLUMNS[0]] }
    expect(readAiExperimentArms(wrong, 'Hero')).toEqual([])
    expect(aiExperimentTestNames(wrong)).toEqual([])
  })
})

describe('the bar rises with the number of chances taken', () => {
  it('is the card’s own confidence for one challenger', () => {
    expect(aiExperimentConfidenceThreshold(1)).toBeCloseTo(AI_EXPERIMENT_CONFIDENCE, 10)
  })

  it('is stricter for two and three, so a family of tests is not called by chance', () => {
    expect(aiExperimentConfidenceThreshold(2)).toBeCloseTo(0.974679, 5)
    expect(aiExperimentConfidenceThreshold(3)).toBeCloseTo(0.983048, 5)
    expect(aiExperimentConfidenceThreshold(3)).toBeGreaterThan(aiExperimentConfidenceThreshold(2))
  })
})

describe('what a result supports', () => {
  it('is unreadable with nothing to compare against', () => {
    const reading = readAiExperimentResult('Hero', [arm('A', 5_000, 250)])
    expect(reading.verdict).toBe('unreadable')
    expect(reading.winnerId).toBeNull()
  })

  it('is too early while an arm is under the exposure floor', () => {
    const reading = readAiExperimentResult('Hero', [
      arm('A', 5_000, 250),
      arm('B', AI_EXPERIMENT_MIN_EXPOSURES - 1, 40, 99.9),
    ])
    expect(reading.verdict).toBe('too-early')
    expect(reading.winnerId).toBeNull()
    expect(reading.reasons).toEqual(['at least one variant has not been shown to enough visitors yet'])
  })

  it('is too early on traffic with almost no conversions, however confident the figure', () => {
    // 100,000 visitors an arm and four conversions between them: the normal
    // approximation behind the comparison has nothing to stand on.
    const reading = readAiExperimentResult('Hero', [
      arm('A', 100_000, 1),
      arm('B', 100_000, 3, 99.9),
    ])
    expect(reading.verdict).toBe('too-early')
    expect(reading.winnerId).toBeNull()
  })

  it('names a winner only where a challenger clears the corrected bar', () => {
    const decided = readAiExperimentResult('Hero', [arm('A', 4_000, 200), arm('B', 4_000, 260, 96.4)])
    expect(decided.verdict).toBe('winner')
    expect(decided.winnerId).toBe('B')

    // The SAME confidence with two challengers no longer clears it.
    const crowded = readAiExperimentResult('Hero', [
      arm('A', 4_000, 200),
      arm('B', 4_000, 260, 96.4),
      arm('C', 4_000, 210, 60),
    ])
    expect(crowded.verdict).toBe('inconclusive')
    expect(crowded.winnerId).toBeNull()
  })

  it('takes the most confident of several challengers that clear it', () => {
    const reading = readAiExperimentResult('Hero', [
      arm('A', 8_000, 400),
      arm('B', 8_000, 470, 98.2),
      arm('C', 8_000, 500, 99.6),
    ])
    expect(reading.verdict).toBe('winner')
    expect(reading.winnerId).toBe('C')
  })

  it('is inconclusive where the arms are close', () => {
    const reading = readAiExperimentResult('Hero', [arm('A', 4_000, 200), arm('B', 4_000, 206, 58)])
    expect(reading.verdict).toBe('inconclusive')
    expect(reading.winnerId).toBeNull()
    expect(reading.reasons[0]).toContain('more than chance')
  })

  it('gives it to the control when every challenger is confidently behind', () => {
    const reading = readAiExperimentResult('Hero', [
      arm('A', 6_000, 420),
      arm('B', 6_000, 330, 1.2),
      arm('C', 6_000, 300, 0.3),
    ])
    expect(reading.verdict).toBe('control')
    expect(reading.winnerId).toBe('A')
  })

  it('leaves the control undecided while a challenger could not be compared', () => {
    const reading = readAiExperimentResult('Hero', [
      arm('A', 6_000, 420),
      arm('B', 6_000, 330, 1.2),
      arm('C', 6_000, 300, null),
    ])
    expect(reading.verdict).toBe('inconclusive')
    expect(reading.winnerId).toBeNull()
  })

  it('agrees with itself about which verdicts name an arm', () => {
    expect(aiExperimentVerdictNamesWinner('winner')).toBe(true)
    expect(aiExperimentVerdictNamesWinner('control')).toBe(true)
    expect(aiExperimentVerdictNamesWinner('inconclusive')).toBe(false)
    expect(aiExperimentVerdictNamesWinner('too-early')).toBe(false)
    expect(aiExperimentVerdictNamesWinner('unreadable')).toBe(false)
  })
})

describe('an explanation is held to the reading', () => {
  const inconclusive = readAiExperimentResult('Hero', [
    arm('A', 4_000, 200),
    arm('B', 4_000, 206, 58),
  ])
  const decided = readAiExperimentResult('Hero', [
    arm('A', 4_000, 200),
    arm('B', 4_000, 260, 96.4),
  ])

  const answer = (
    partial: Partial<AiExperimentExplanationAnswer>,
  ): AiExperimentExplanationAnswer => ({
    headline: 'Both variants converted at about the same rate.',
    points: [],
    winner: '',
    next: '',
    ...partial,
  })

  it('DOES NOT DECLARE A WINNER on a result that is not significant', () => {
    const explained = checkAiExperimentExplanation(
      answer({
        points: ['B won on every measure.', 'Visitors saw both about equally often.'],
        winner: 'B',
        next: 'Roll B out to everyone.',
      }),
      inconclusive,
    )
    expect(explained).not.toBeNull()
    expect(explained?.winnerId).toBeNull()
    expect(explained?.headline).toBe('Both variants converted at about the same rate.')
    expect(explained?.points).toEqual(['Visitors saw both about equally often.'])
    // The recommendation is code's, not the model's, on an undecided result.
    expect(explained?.next).toBe(AI_EXPERIMENT_NEXT_INCONCLUSIVE)
    expect(explained?.findings).toContain('names-a-winner-the-reading-did-not:B')
    expect(explained?.findings).toContain('claims-a-winner:next')
  })

  it('refuses a recommendation that names a winner without saying so', () => {
    const explained = checkAiExperimentExplanation(
      answer({ points: ['Go with B from here.'], winner: '' }),
      inconclusive,
    )
    expect(explained?.points).toEqual([])
    expect(explained?.findings).toContain('claims-a-winner:point')
  })

  it('does not declare one while the test is too early either', () => {
    const early = readAiExperimentResult('Hero', [arm('A', 120, 12), arm('B', 110, 22, 99.4)])
    const explained = checkAiExperimentExplanation(
      answer({ headline: 'B is significantly ahead.', winner: 'B' }),
      early,
    )
    expect(early.verdict).toBe('too-early')
    expect(explained).toBeNull()
  })

  it('keeps the winner where the reading found one', () => {
    const explained = checkAiExperimentExplanation(
      answer({
        headline: 'Variant B converted better than the original.',
        points: ['B beat A by about three points.'],
        winner: 'B',
        next: 'Finish the test on B.',
      }),
      decided,
    )
    expect(explained?.winnerId).toBe('B')
    expect(explained?.points).toEqual(['B beat A by about three points.'])
    expect(explained?.findings).toEqual([])
  })

  it('removes an arm the figures do not hold, and one the reading did not name', () => {
    const invented = checkAiExperimentExplanation(answer({ winner: 'D' }), decided)
    expect(invented?.winnerId).toBe('B')
    expect(invented?.findings).toContain('names-an-arm-the-figures-do-not:D')

    const wrong = checkAiExperimentExplanation(answer({ winner: 'A' }), decided)
    expect(wrong?.winnerId).toBe('B')
    expect(wrong?.findings).toContain('names-a-winner-the-reading-did-not:A')
  })

  it('answers the reading’s own arm where the model named none', () => {
    expect(checkAiExperimentExplanation(answer({ winner: '' }), decided)?.winnerId).toBe('B')
  })

  it('is nothing at all when the headline itself was the unsupported claim', () => {
    expect(
      checkAiExperimentExplanation(answer({ headline: 'B wins.' }), inconclusive),
    ).toBeNull()
    expect(checkAiExperimentExplanation(null, inconclusive)).toBeNull()
  })
})

describe('a variants proposal', () => {
  const proposal = (
    variants: AiExperimentVariantsProposal['variants'],
  ): AiExperimentVariantsProposal => ({ goal: 'More trial signups', variants })

  const variant = (partial: Partial<AiExperimentVariantsProposal['variants'][0]>) => ({
    name: '',
    headline: '',
    body: '',
    subject: '',
    preheader: '',
    rationale: '',
    ...partial,
  })

  it('keeps a screen’s copy and drops an email’s fields from it', () => {
    const checked = checkAiExperimentVariants(
      proposal([
        variant({ name: 'Control', headline: 'Build your site today', body: 'Start free.' }),
        variant({ headline: 'Your site, live by lunch', body: 'No card needed.', subject: 'Hi' }),
      ]),
      'screen',
    )
    expect(checked?.proposal.variants.map((entry) => entry.name)).toEqual(['Control', 'Variant 2'])
    expect(checked?.proposal.variants[1].subject).toBe('')
    expect(checked?.findings).toContain('variant-fills-another-targets-fields')
  })

  it('keeps an email’s subject and preheader', () => {
    const checked = checkAiExperimentVariants(
      proposal([
        variant({ subject: 'Your invoice is ready', body: 'Open it here.' }),
        variant({ subject: 'Invoice #402 — ready to pay', body: 'One click.' }),
      ]),
      'email',
    )
    expect(checked?.proposal.variants[0].subject).toBe('Your invoice is ready')
    expect(checked?.proposal.variants).toHaveLength(2)
  })

  it('drops a variant with markup, one with no copy, and one that repeats another', () => {
    const checked = checkAiExperimentVariants(
      proposal([
        variant({ headline: 'Build your site today' }),
        variant({ headline: 'Build your site today' }),
        variant({ headline: '<h1>Build faster</h1>' }),
        variant({ rationale: 'shorter' }),
        variant({ headline: 'Live by lunch' }),
      ]),
      'screen',
    )
    expect(checked?.proposal.variants.map((entry) => entry.headline)).toEqual([
      'Build your site today',
      'Live by lunch',
    ])
    expect(checked?.findings).toEqual(
      expect.arrayContaining(['variant-repeats-another', 'variant-carries-markup', 'variant-has-no-copy']),
    )
  })

  it('is nothing when fewer than two variants survive', () => {
    expect(checkAiExperimentVariants(proposal([variant({ headline: 'Only one' })]), 'screen')).toBeNull()
    expect(checkAiExperimentVariants(null, 'screen')).toBeNull()
  })

  it('never proposes more than the card can store', () => {
    const checked = checkAiExperimentVariants(
      proposal(['a', 'b', 'c', 'd', 'e'].map((letter) => variant({ headline: `Headline ${letter}` }))),
      'screen',
    )
    expect(checked?.proposal.variants).toHaveLength(4)
  })
})

describe('the job’s inputs', () => {
  it('name the task and the target, or nothing', () => {
    expect(aiExperimentTask({ task: 'explain' })).toBe('explain')
    expect(aiExperimentTask({ task: 'rewrite' })).toBeNull()
    expect(aiExperimentTask(null)).toBeNull()
    expect(aiExperimentTarget({ target: 'email' })).toBe('email')
    expect(aiExperimentTarget({ target: 'popup' })).toBeNull()
  })
})

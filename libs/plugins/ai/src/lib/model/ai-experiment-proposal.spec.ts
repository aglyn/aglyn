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
 * What a console surface is allowed to make of an `experiment` job's answer
 * (AGL-2914).
 *
 * The step decided the verdict from the counts and cut the model's words back
 * to it. Everything here is the second half of that: a reading that reaches a
 * browser is a plain record, and the fields a surface would draw a conclusion
 * from — `winnerId`, `next` — are re-decided against the verdict rather than
 * trusted, because between the step and the card there is HTTP, a stored
 * document, and no type at all.
 */

import {
  AI_EXPERIMENT_NEXT_INCONCLUSIVE,
  AI_EXPERIMENT_NEXT_TOO_EARLY,
  AI_EXPERIMENT_NEXT_UNREADABLE,
  type AiExperimentVerdict,
} from './ai-experiment'
import {
  aiExperimentArmIsNamed,
  aiExperimentVerdictDisplay,
  readAiExperimentExplanation,
  readAiExperimentVariants,
} from './ai-experiment-proposal'

const UNDECIDED: readonly AiExperimentVerdict[] = [
  'too-early',
  'inconclusive',
  'unreadable',
]

const arms = [
  { id: 'A (control)', exposures: 4000, conversions: 200, rate: 5, lift: null, confidence: null },
  { id: 'B', exposures: 4000, conversions: 240, rate: 6, lift: 20, confidence: 97.4 },
]

const explanation = (patch: Record<string, unknown> = {}) => ({
  task: 'explain',
  verdict: 'winner',
  test: 'Hero copy',
  headline: 'B converted better than A over eight thousand visitors.',
  points: ['B was shown to 4,000 visitors and converted 240 of them.'],
  winnerId: 'B',
  next: 'Keep B and start a new test on the next idea.',
  threshold: 95,
  arms,
  ...patch,
})

describe('how a verdict may be drawn', () => {
  it('names no arm and takes no success tone on a verdict that decided nothing', () => {
    for (const verdict of UNDECIDED) {
      const display = aiExperimentVerdictDisplay(verdict)
      expect(display.namesAnArm).toBe(false)
      expect(display.tone).toBe('default')
      // The chip is not the only thing a reader sees, so the verdict also
      // carries a sentence saying in words that nothing is ahead.
      expect(display.caveat).toMatch(/ahead/i)
      // The chip states an ABSENCE. A status that named a leader would be the
      // claim the step refused, made in three words above the paragraph that
      // does not make it.
      expect(display.status).toMatch(/^(No|Nothing)\b/)
    }
  })

  it('names an arm only on a verdict the figures decided', () => {
    for (const verdict of ['winner', 'control'] as AiExperimentVerdict[]) {
      const display = aiExperimentVerdictDisplay(verdict)
      expect(display.namesAnArm).toBe(true)
      expect(display.tone).toBe('success')
      expect(display.caveat).toBe('')
    }
  })

  it('draws a verdict it does not recognize as the most careful one', () => {
    const display = aiExperimentVerdictDisplay('decided-by-vibes')
    expect(display.namesAnArm).toBe(false)
    expect(display.tone).toBe('default')
  })
})

describe('marking one arm', () => {
  it('marks the arm the figures named, and no other', () => {
    const reading = { verdict: 'winner' as const, winnerId: 'B' }
    expect(aiExperimentArmIsNamed(reading, 'B')).toBe(true)
    expect(aiExperimentArmIsNamed(reading, 'A (control)')).toBe(false)
  })

  it('marks nothing on a result that decided nothing, whatever the document carries', () => {
    for (const verdict of UNDECIDED) {
      // The shape a surface must survive: a stored winner beside a verdict
      // that does not support one.
      expect(aiExperimentArmIsNamed({ verdict, winnerId: 'B' }, 'B')).toBe(false)
    }
  })
})

describe('reading an explanation back', () => {
  it('keeps a winner the verdict and the figures both support', () => {
    const read = readAiExperimentExplanation(explanation())
    expect(read?.winnerId).toBe('B')
    expect(read?.next).toBe('Keep B and start a new test on the next idea.')
    expect(read?.arms.map((arm) => arm.id)).toEqual(['A (control)', 'B'])
  })

  it('drops a winner on an undecided verdict, and answers what to do in code’s own words', () => {
    const next: Record<string, string> = {
      'too-early': AI_EXPERIMENT_NEXT_TOO_EARLY,
      inconclusive: AI_EXPERIMENT_NEXT_INCONCLUSIVE,
      unreadable: AI_EXPERIMENT_NEXT_UNREADABLE,
    }
    for (const verdict of UNDECIDED) {
      const read = readAiExperimentExplanation(
        explanation({ verdict, next: 'Ship B — it is clearly the winner.' }),
      )
      expect(read?.winnerId).toBeNull()
      expect(read?.next).toBe(next[verdict])
    }
  })

  it('drops a winner the figures do not carry', () => {
    expect(readAiExperimentExplanation(explanation({ winnerId: 'C' }))?.winnerId).toBeNull()
  })

  it('refuses what is not an explanation, and one with nothing to say', () => {
    expect(readAiExperimentExplanation(explanation({ task: 'variants' }))).toBeNull()
    expect(readAiExperimentExplanation(explanation({ headline: '   ' }))).toBeNull()
    expect(readAiExperimentExplanation(explanation({ verdict: 'probably-b' }))).toBeNull()
    expect(readAiExperimentExplanation(null)).toBeNull()
  })
})

describe('reading variants back', () => {
  it('keeps the variants that carry copy, in order', () => {
    const read = readAiExperimentVariants({
      task: 'variants',
      target: 'email',
      goal: 'replies',
      variants: [
        { name: 'A (control)', subject: 'Your quote', body: 'As it stands.', rationale: '' },
        { name: 'B', subject: 'Your quote is ready', body: 'Shorter.', rationale: 'Specificity.' },
        // No copy at all: nothing to test, so nothing to show.
        { name: 'C', rationale: 'An idea with no words.' },
      ],
    })
    expect(read?.target).toBe('email')
    expect(read?.variants.map((variant) => variant.name)).toEqual(['A (control)', 'B'])
  })

  it('refuses what is not a variants answer, or names no target this step runs', () => {
    const variants = [{ name: 'A', headline: 'One' }, { name: 'B', headline: 'Two' }]
    expect(readAiExperimentVariants({ task: 'explain', target: 'screen', variants })).toBeNull()
    expect(readAiExperimentVariants({ task: 'variants', target: 'banner', variants })).toBeNull()
    expect(readAiExperimentVariants({ task: 'variants', target: 'screen', variants: [] })).toBeNull()
  })
})

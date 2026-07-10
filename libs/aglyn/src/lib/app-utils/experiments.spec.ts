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

import {
  assignExperimentVariant,
  compareVariants,
  evaluateAutoWinner,
  summarizeVariantStats,
  validateExperiment,
  type HostExperiment,
} from './experiments'

const running: HostExperiment = {
  name: 'Hero test',
  status: 'running',
  target: 'screen',
  screenId: 'screen-1',
  variants: [
    { id: 'a', weight: 1 },
    { id: 'b', weight: 1 },
  ],
}

describe('experiments (AGL-252)', () => {
  it('assigns deterministically and respects status', () => {
    const first = assignExperimentVariant(running, 'exp-1', 'visitor-1')
    for (let index = 0; index < 5; index += 1) {
      expect(assignExperimentVariant(running, 'exp-1', 'visitor-1')?.id).toBe(
        first?.id,
      )
    }
    expect(
      assignExperimentVariant(
        { ...running, status: 'draft' },
        'exp-1',
        'visitor-1',
      ),
    ).toBeNull()
    // A finished experiment serves the winner to everyone.
    expect(
      assignExperimentVariant(
        { ...running, status: 'done', winnerVariantId: 'b' },
        'exp-1',
        'visitor-1',
      )?.id,
    ).toBe('b')
  })

  it('splits traffic roughly by weight', () => {
    const weighted: HostExperiment = {
      ...running,
      variants: [
        { id: 'a', weight: 3 },
        { id: 'b', weight: 1 },
      ],
    }
    let aCount = 0
    for (let index = 0; index < 1000; index += 1) {
      const variant = assignExperimentVariant(
        weighted,
        'exp-2',
        `visitor-${index}`,
      )
      if (variant?.id === 'a') aCount += 1
    }
    expect(aCount).toBeGreaterThan(650)
    expect(aCount).toBeLessThan(850)
  })

  it('validates shape', () => {
    expect(validateExperiment(running)).toBeNull()
    expect(
      validateExperiment({ ...running, variants: [{ id: 'a' }] }),
    ).toMatch(/two variants/)
    expect(
      validateExperiment({ ...running, target: 'section', nodeId: '' }),
    ).toMatch(/element id/)
    expect(validateExperiment({ ...running, name: ' ' })).toMatch(/Name/)
  })

  it('compares variants: lift + z-test confidence (AGL-265)', () => {
    // Clear winner: 20% vs 10% on large samples → high confidence.
    const strong = compareVariants(
      { exposures: 1000, conversions: 100 },
      { exposures: 1000, conversions: 200 },
    )
    expect(strong.lift).toBeCloseTo(1.0)
    expect(strong.confidence).toBeGreaterThan(0.99)
    // A worse challenger: confidence well below 0.5.
    const worse = compareVariants(
      { exposures: 1000, conversions: 200 },
      { exposures: 1000, conversions: 100 },
    )
    expect(worse.confidence).toBeLessThan(0.01)
    // Tiny samples stay honest: null confidence.
    expect(
      compareVariants(
        { exposures: 0, conversions: 0 },
        { exposures: 3, conversions: 1 },
      ).confidence,
    ).toBeNull()
    expect(
      compareVariants(
        { exposures: 5, conversions: 0 },
        { exposures: 5, conversions: 0 },
      ).confidence,
    ).toBeNull()
    // Zero control rate → lift is null, not Infinity.
    expect(
      compareVariants(
        { exposures: 100, conversions: 0 },
        { exposures: 100, conversions: 10 },
      ).lift,
    ).toBeNull()
  })

  it('summarizes stats', () => {
    expect(summarizeVariantStats({ exposures: 200, conversions: 30 })).toEqual(
      { exposures: 200, conversions: 30, rate: 0.15 },
    )
    expect(summarizeVariantStats({}).rate).toBe(0)
  })
})

describe('end dates (AGL-273)', () => {
  const timed: HostExperiment = {
    name: 'Timed test',
    status: 'running',
    target: 'screen',
    screenId: 'screen-1',
    endAtMs: 1_000,
    variants: [{ id: 'a' }, { id: 'b' }],
  }

  it('serves variants inside the window and default past it', () => {
    expect(assignExperimentVariant(timed, 'x', 'visitor', 999)).not.toBeNull()
    expect(assignExperimentVariant(timed, 'x', 'visitor', 1_001)).toBeNull()
  })

  it('still serves the winner after the end date', () => {
    const decided = { ...timed, status: 'done' as const, winnerVariantId: 'b' }
    expect(assignExperimentVariant(decided, 'x', 'visitor', 2_000)?.id).toBe(
      'b',
    )
  })
})

describe('evaluateAutoWinner (AGL-273)', () => {
  const base: HostExperiment = {
    name: 'Auto test',
    status: 'running',
    target: 'screen',
    screenId: 'screen-1',
    variants: [{ id: 'control' }, { id: 'challenger' }],
    autoWinner: { minExposures: 100, confidence: 0.95 },
  }

  it('waits until every arm has minimum exposures', () => {
    expect(
      evaluateAutoWinner(base, {
        control: { exposures: 100, conversions: 5 },
        challenger: { exposures: 99, conversions: 30 },
      }),
    ).toBeNull()
  })

  it('promotes a confidently better challenger', () => {
    const decision = evaluateAutoWinner(base, {
      control: { exposures: 500, conversions: 25 },
      challenger: { exposures: 500, conversions: 75 },
    })
    expect(decision?.variantId).toBe('challenger')
    expect(decision?.confidence).toBeGreaterThan(0.95)
  })

  it('declares the control when every challenger confidently loses', () => {
    const decision = evaluateAutoWinner(base, {
      control: { exposures: 500, conversions: 75 },
      challenger: { exposures: 500, conversions: 25 },
    })
    expect(decision?.variantId).toBe('control')
  })

  it('stays undecided in the uncertain middle', () => {
    expect(
      evaluateAutoWinner(base, {
        control: { exposures: 500, conversions: 50 },
        challenger: { exposures: 500, conversions: 53 },
      }),
    ).toBeNull()
  })

  it('ignores experiments without the opt-in or not running', () => {
    expect(
      evaluateAutoWinner(
        { ...base, autoWinner: undefined },
        { control: {}, challenger: {} },
      ),
    ).toBeNull()
    expect(
      evaluateAutoWinner(
        { ...base, status: 'paused' },
        { control: {}, challenger: {} },
      ),
    ).toBeNull()
  })

  it('validates auto-winner config', () => {
    expect(
      validateExperiment({
        ...base,
        autoWinner: { minExposures: 0, confidence: 0.95 },
      }),
    ).toContain('minimum exposure')
    expect(
      validateExperiment({
        ...base,
        autoWinner: { minExposures: 100, confidence: 1.2 },
      }),
    ).toContain('confidence')
    expect(validateExperiment(base)).toBeNull()
  })
})

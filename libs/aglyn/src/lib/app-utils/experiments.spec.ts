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

  it('summarizes stats', () => {
    expect(summarizeVariantStats({ exposures: 200, conversions: 30 })).toEqual(
      { exposures: 200, conversions: 30, rate: 0.15 },
    )
    expect(summarizeVariantStats({}).rate).toBe(0)
  })
})

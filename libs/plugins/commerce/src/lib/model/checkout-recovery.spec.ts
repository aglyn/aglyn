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
 * The recovery state every checkout writer stamps (AGL-3321), and the
 * backfill's restatement of it, answer the same worked examples.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkoutRecoveryState } from './checkout-recovery'

const fixtures: {
  cases: Array<{ name: string; checkout: Record<string, unknown>; expected: string }>
} = JSON.parse(
  readFileSync(
    join(
      __dirname,
      ...Array(6).fill('..'),
      'tools',
      'scripts',
      'lib',
      'checkout-recovery-state.fixtures.json',
    ),
    'utf8',
  ),
)

describe('checkoutRecoveryState', () => {
  it('THE CONTROL: the fixtures name every state', () => {
    expect(new Set(fixtures.cases.map((entry) => entry.expected))).toEqual(
      new Set(['pending', 'reminded', 'none']),
    )
  })

  it.each(fixtures.cases.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    expect(checkoutRecoveryState(entry.checkout)).toBe(entry.expected)
  })
})

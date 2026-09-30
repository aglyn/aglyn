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
  formatStorageMb,
  listNames,
  usageAlertGuardDecision,
  usagePhrase,
  workspacePhrases,
} from './usage-alert-notice'

const MONTH = '2026-10'

describe('usageAlertGuardDecision (AGL-3431)', () => {
  const crossing = (
    threshold: number,
    guard?: { month?: string; threshold?: number },
    measured?: boolean,
  ) =>
    usageAlertGuardDecision({ cadence: 'crossing', threshold, guard, month: MONTH, measured })
  const monthly = (threshold: number, guard?: { month?: string; threshold?: number }) =>
    usageAlertGuardDecision({ cadence: 'monthly', threshold, guard, month: MONTH })

  it('announces a first crossing, and each higher step', () => {
    expect(crossing(80)).toEqual({ action: 'send', guard: { month: MONTH, threshold: 80 } })
    expect(crossing(100, { month: MONTH, threshold: 80 })).toEqual({
      action: 'send',
      guard: { month: MONTH, threshold: 100 },
    })
  })

  it('holds a crossing guard from ANY month — a legacy guard counts as announced', () => {
    expect(crossing(100, { month: '2026-07', threshold: 100 })).toEqual({ action: 'none' })
    expect(crossing(80, { month: '2026-07', threshold: 100 })).toEqual({
      action: 'rearm',
      guard: { month: MONTH, threshold: 80 },
    })
  })

  it('re-arms below every band by removing the guard', () => {
    expect(crossing(0, { month: MONTH, threshold: 100 })).toEqual({ action: 'rearm', guard: null })
    // Nothing to remove.
    expect(crossing(0)).toEqual({ action: 'none' })
  })

  it('never re-arms on a reading that could not be taken', () => {
    expect(crossing(0, { month: MONTH, threshold: 100 }, false)).toEqual({ action: 'none' })
    // …but a real crossing is still a crossing.
    expect(crossing(100, { month: MONTH, threshold: 80 }, false)).toMatchObject({ action: 'send' })
  })

  it('keeps the month guard for a meter that resets', () => {
    expect(monthly(100, { month: MONTH, threshold: 100 })).toEqual({ action: 'none' })
    expect(monthly(100, { month: '2026-09', threshold: 100 })).toEqual({
      action: 'send',
      guard: { month: MONTH, threshold: 100 },
    })
    expect(monthly(0, { month: MONTH, threshold: 100 })).toEqual({ action: 'none' })
  })

  it('reads a guard with no threshold as no guard', () => {
    expect(crossing(100, { month: '2026-09' })).toMatchObject({ action: 'send' })
  })
})

describe('the words a notice is built from', () => {
  it('says "N of the M" within the limit and "more than" past it', () => {
    const phrase = (used: number) =>
      usagePhrase({
        used,
        limit: 6,
        usedText: String(used),
        limitText: '6',
        noun: 'pages',
        suffix: 'per site',
      })
    expect(phrase(6)).toBe('6 of the 6 pages your plan includes per site')
    expect(phrase(8)).toBe('8 pages — more than the 6 your plan includes per site')
  })

  it('names the workspace, or says "your workspace" when it has no name', () => {
    expect(workspacePhrases('Ready To Roll').subject).toBe('The Ready To Roll workspace')
    expect(workspacePhrases('  ').object).toBe('your workspace')
  })

  it('formats storage and lists names the way a person reads them', () => {
    expect(formatStorageMb(250)).toBe('250 MB')
    expect(formatStorageMb(2048)).toBe('2 GB')
    expect(formatStorageMb(10_752)).toBe('10.5 GB')
    expect(listNames(['a', 'b', 'c'])).toBe('a, b and c')
  })
})

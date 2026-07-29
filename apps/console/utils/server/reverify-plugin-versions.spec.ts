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
  regressionNeedsStaff,
  reverifyOutcome,
  summariseReverify,
  type ReverifyEntry,
} from './reverify-plugin-versions'

describe('reverifyOutcome (AGL-1086)', () => {
  it('calls a pass that now fails a regression', () => {
    expect(reverifyOutcome({ ok: true, verifierVersion: 2 }, { ok: false })).toBe(
      'regressed',
    )
  })

  it('does NOT call a first-time failure a regression', () => {
    // Nobody was ever told these bytes were clean, so the new checker did
    // not break anything — it found something that was always there.
    expect(reverifyOutcome(null, { ok: false })).toBe('still-failing')
    expect(reverifyOutcome({ verifierVersion: 1 }, { ok: false })).toBe(
      'still-failing',
    )
  })

  it('reports a fix and a no-change', () => {
    expect(reverifyOutcome({ ok: false }, { ok: true })).toBe('fixed')
    expect(reverifyOutcome({ ok: true }, { ok: true })).toBe('unchanged')
    expect(reverifyOutcome({ ok: false }, { ok: false })).toBe('still-failing')
  })

  it('reports a version whose artifact could not be read', () => {
    expect(reverifyOutcome({ ok: true }, null)).toBe('unverifiable')
  })
})

describe('regressionNeedsStaff (AGL-1086)', () => {
  const entry = (overrides: Partial<ReverifyEntry> = {}): ReverifyEntry => ({
    listingId: 'l1',
    listingName: 'Thing',
    version: '1.0.0',
    outcome: 'regressed',
    reviewStatus: 'verified',
    activeInstalls: 3,
    problems: ['eval() is not allowed'],
    ...overrides,
  })

  it('wakes staff for a live version people are actually running', () => {
    expect(regressionNeedsStaff(entry())).toBe(true)
    expect(regressionNeedsStaff(entry({ reviewStatus: 'listed' }))).toBe(true)
  })

  it('stays quiet when nothing is installed or nothing is live', () => {
    expect(regressionNeedsStaff(entry({ activeInstalls: 0 }))).toBe(false)
    expect(regressionNeedsStaff(entry({ reviewStatus: 'rejected' }))).toBe(false)
    expect(regressionNeedsStaff(entry({ reviewStatus: 'in_review' }))).toBe(false)
  })

  it('never fires for anything but a regression', () => {
    expect(regressionNeedsStaff(entry({ outcome: 'still-failing' }))).toBe(false)
    expect(regressionNeedsStaff(entry({ outcome: 'unchanged' }))).toBe(false)
  })
})

describe('summariseReverify (AGL-1086)', () => {
  const make = (
    version: string,
    outcome: ReverifyEntry['outcome'],
    overrides: Partial<ReverifyEntry> = {},
  ): ReverifyEntry => ({
    listingId: 'l1',
    listingName: 'Thing',
    version,
    outcome,
    reviewStatus: 'verified',
    activeInstalls: 1,
    problems: [],
    ...overrides,
  })

  it('counts every outcome and leads with the regressions', () => {
    const summary = summariseReverify([
      make('1.0.0', 'unchanged'),
      make('1.0.1', 'fixed'),
      make('1.0.2', 'regressed'),
      make('1.0.3', 'still-failing'),
      make('1.0.4', 'unverifiable'),
    ])
    expect(summary.scanned).toBe(5)
    expect(summary.regressed).toBe(1)
    expect(summary.unchanged).toBe(1)
    // Unchanged versions are the bulk of any sweep and are not the report.
    expect(summary.notable.map((entry) => entry.version)).toEqual([
      '1.0.2',
      '1.0.3',
      '1.0.4',
      '1.0.1',
    ])
    expect(summary.needsStaff.map((entry) => entry.version)).toEqual(['1.0.2'])
  })
})

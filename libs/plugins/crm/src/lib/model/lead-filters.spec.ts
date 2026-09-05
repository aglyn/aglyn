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

import { LEAD_FILTER_LABELS, LEAD_FILTERS, leadMatchesFilter } from './lead-filters'

/**
 * The Leads section's `Show` control (AGL-2608), and the one property that
 * makes the section useful on day one: a lead the capture door wrote — which
 * carries no status — is OPEN and NEW.
 */
describe('leadMatchesFilter', () => {
  it('opens on the leads that still need working, statusless ones included', () => {
    expect(leadMatchesFilter({}, 'open')).toBe(true)
    expect(leadMatchesFilter({ status: 'new' }, 'open')).toBe(true)
    expect(leadMatchesFilter({ status: 'working' }, 'open')).toBe(true)
    expect(leadMatchesFilter({ status: 'qualified' }, 'open')).toBe(false)
    expect(leadMatchesFilter({ status: 'unqualified' }, 'open')).toBe(false)
  })

  it('reads a statusless lead as new under the New view', () => {
    expect(leadMatchesFilter({}, 'new')).toBe(true)
    expect(leadMatchesFilter({ status: 'working' }, 'new')).toBe(false)
  })

  it('matches a single status exactly', () => {
    expect(leadMatchesFilter({ status: 'unqualified' }, 'unqualified')).toBe(true)
    expect(leadMatchesFilter({ status: 'qualified' }, 'unqualified')).toBe(false)
  })

  it('keeps everything under All', () => {
    for (const status of ['new', 'working', 'qualified', 'unqualified'] as const) {
      expect(leadMatchesFilter({ status }, 'all')).toBe(true)
    }
    expect(leadMatchesFilter({}, 'all')).toBe(true)
  })

  it('labels every option, open first and all last', () => {
    expect(LEAD_FILTERS[0]).toBe('open')
    expect(LEAD_FILTERS[LEAD_FILTERS.length - 1]).toBe('all')
    for (const filter of LEAD_FILTERS) {
      expect(LEAD_FILTER_LABELS[filter]).toBeTruthy()
    }
  })
})

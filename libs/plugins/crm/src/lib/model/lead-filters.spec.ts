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
  LEAD_EMAIL_FILTER_LABELS,
  LEAD_EMAIL_FILTERS,
  LEAD_FILTER_LABELS,
  LEAD_FILTERS,
  leadMatchesEmailFilter,
  leadMatchesFilter,
  leadMatchesSearch,
} from './lead-filters'

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

/**
 * The Leads section's search box (AGL-3246): the fields it reads, and that
 * every word must land somewhere.
 */
describe('leadMatchesSearch', () => {
  const morgan = {
    name: 'Morgan Lamphere',
    email: 'morgan@lamphere.coffee',
    company: 'Lamphere Coffee',
    jobTitle: 'Head Roaster',
    tags: ['sal-15', 'trade-show'],
  }

  it('reads name, email, company, title and tags, whatever the case', () => {
    expect(leadMatchesSearch(morgan, 'LAMPHERE')).toBe(true)
    expect(leadMatchesSearch(morgan, '@lamphere.coffee')).toBe(true)
    expect(leadMatchesSearch(morgan, 'coffee')).toBe(true)
    expect(leadMatchesSearch(morgan, 'roaster')).toBe(true)
    expect(leadMatchesSearch(morgan, 'SAL-15')).toBe(true)
    expect(leadMatchesSearch(morgan, 'smith')).toBe(false)
  })

  it('needs every word, in any field', () => {
    expect(leadMatchesSearch(morgan, 'morgan lamphere')).toBe(true)
    expect(leadMatchesSearch(morgan, 'lamphere sal-15')).toBe(true)
    expect(leadMatchesSearch(morgan, 'morgan smith')).toBe(false)
  })

  it('matches everything on a blank term and nothing on a bare lead', () => {
    expect(leadMatchesSearch(morgan, '')).toBe(true)
    expect(leadMatchesSearch(morgan, '   ')).toBe(true)
    expect(leadMatchesSearch({}, '')).toBe(true)
    expect(leadMatchesSearch({ name: null, tags: 'sal-15' }, 'sal')).toBe(false)
  })
})

/**
 * The `Email` control (AGL-3245): every verdict on its own, the ones a
 * member must not email together, and the ones nothing has been said about.
 */
describe('leadMatchesEmailFilter', () => {
  const bounced = { emailState: { status: 'bounced', atMs: 1, source: 'sequence', detail: null } }
  const ok = { emailState: { status: 'ok', atMs: 1, source: 'member', detail: null } }

  it('keeps everyone under Any, and only the unemailable under Cannot be emailed', () => {
    expect(leadMatchesEmailFilter(bounced, 'any')).toBe(true)
    expect(leadMatchesEmailFilter({}, 'any')).toBe(true)
    expect(leadMatchesEmailFilter(bounced, 'problem')).toBe(true)
    expect(leadMatchesEmailFilter(ok, 'problem')).toBe(false)
    expect(leadMatchesEmailFilter({}, 'problem')).toBe(false)
  })

  it('matches one verdict exactly, and Nothing known only when nothing is', () => {
    expect(leadMatchesEmailFilter(bounced, 'bounced')).toBe(true)
    expect(leadMatchesEmailFilter(bounced, 'blocked')).toBe(false)
    expect(leadMatchesEmailFilter({}, 'none')).toBe(true)
    expect(leadMatchesEmailFilter({ emailState: { status: 'whim' } }, 'none')).toBe(true)
    expect(leadMatchesEmailFilter(ok, 'none')).toBe(false)
  })

  it('labels every option, Any first and Nothing known last', () => {
    expect(LEAD_EMAIL_FILTERS[0]).toBe('any')
    expect(LEAD_EMAIL_FILTERS.at(-1)).toBe('none')
    for (const option of LEAD_EMAIL_FILTERS) expect(LEAD_EMAIL_FILTER_LABELS[option]).toBeTruthy()
  })
})

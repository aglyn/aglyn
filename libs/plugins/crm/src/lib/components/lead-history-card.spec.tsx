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
 * How a lead's captured sources read on screen (AGL-2608, AGL-2631).
 *
 * The door writes `signup`, `booking` and `form:{formId}`; the lifecycle
 * backfill also writes the bare kind `form` for a person whose timeline
 * kept no form id, and the label must read it as the kind rather than echo
 * the token beside a `Form <id>` chip.
 */

import { leadSourceLabel, leadSources } from './lead-history-card'

describe('leadSourceLabel', () => {
  it('labels the surfaces the capture doors write', () => {
    expect(leadSourceLabel('signup')).toBe('Sign-up')
    expect(leadSourceLabel('booking')).toBe('Booking')
    expect(leadSourceLabel('form:form-wholesale')).toBe('Form form-wholesale')
  })

  it('labels the bare form kind the lifecycle backfill writes when no form id survived', () => {
    expect(leadSourceLabel('form')).toBe('Form')
  })

  it('passes a source it does not know through unchanged', () => {
    expect(leadSourceLabel('walk-in')).toBe('walk-in')
  })
})

describe('leadSources', () => {
  it('reads the array, and the older single field when the array is absent', () => {
    expect(leadSources({ sources: ['form:f1', 'booking'] })).toEqual(['form:f1', 'booking'])
    expect(leadSources({ source: 'signup' })).toEqual(['signup'])
    expect(leadSources({ sources: [], source: 'signup' })).toEqual(['signup'])
    expect(leadSources({})).toEqual([])
  })
})

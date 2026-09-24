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

import { readOutreachStepOverrides, readStoredOutreachEnrollment } from './stored-records'

/**
 * A stored enrollment's curated steps (AGL-3324), read a field at a time:
 * what is read here is what gets sent in place of the step.
 */

describe('readOutreachStepOverrides', () => {
  it('reads a copy with a body or a subject, and every audit field it carries', () => {
    expect(
      readOutreachStepOverrides({
        '0': { subject: 'Hi Casey', body: 'Hi', source: 'ai', draftedAtMs: 5, draftedByUid: 'u', edited: true, prompt: 'P', model: 'm' },
        '2': { body: 'Again', source: 'member', draftedAtMs: 6 },
      }),
    ).toEqual({
      '0': { subject: 'Hi Casey', body: 'Hi', source: 'ai', draftedAtMs: 5, draftedByUid: 'u', edited: true, prompt: 'P', model: 'm' },
      '2': { body: 'Again', source: 'member', draftedAtMs: 6 },
    })
  })

  it('drops an entry with no words, one keyed by something that is not a step index, and reads an unknown source as the member’s', () => {
    expect(
      readOutreachStepOverrides({
        '0': { source: 'ai', draftedAtMs: 5 },
        first: { body: 'x', source: 'ai' },
        '-1': { body: 'x', source: 'ai' },
        '3': { body: 'Hand-written', source: 'robot', draftedAtMs: 'soon' },
        '4': 'not an object',
      }),
    ).toEqual({ '3': { body: 'Hand-written', source: 'member', draftedAtMs: 0 } })
    expect(readOutreachStepOverrides(undefined)).toBeUndefined()
    expect(readOutreachStepOverrides([])).toBeUndefined()
    expect(readOutreachStepOverrides({ '0': { source: 'ai' } })).toBeUndefined()
  })

  it('rides on the stored enrollment, and is absent rather than empty when nobody curated', () => {
    const base = { sequenceId: 'seq-1', contactId: 'c-1', email: 'casey@example.com', status: 'active', stepIndex: 0 }
    expect(readStoredOutreachEnrollment('e-1', base)).not.toHaveProperty('stepOverrides')
    expect(readStoredOutreachEnrollment('e-1', { ...base, stepOverrides: {} })).not.toHaveProperty('stepOverrides')
    expect(
      readStoredOutreachEnrollment('e-1', { ...base, stepOverrides: { '0': { body: 'Hi', source: 'ai', draftedAtMs: 1 } } })
        ?.stepOverrides,
    ).toEqual({ '0': { body: 'Hi', source: 'ai', draftedAtMs: 1 } })
  })
})

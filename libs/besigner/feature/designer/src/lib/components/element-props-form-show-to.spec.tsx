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

import { buildAudienceFields } from './element-props-form.component'

/** "Show to" in the Attributes panel (AGL-4231), offered on every element. */
describe('the Show to field (AGL-4231)', () => {
  it('offers everyone, signed-in and signed-out visitors as real values', () => {
    const [field] = buildAudienceFields() as Array<Record<string, any>>
    expect(field.name).toBe('showTo')
    expect(field.label).toBe('Show to')
    expect(field.options.map((option: any) => [option.value, option.label])).toEqual([
      ['everyone', 'Everyone'],
      ['signedIn', 'Signed-in visitors'],
      ['signedOut', 'Signed-out visitors'],
    ])
  })

  it('says it decides what shows, not what is private', () => {
    const [field] = buildAudienceFields() as Array<Record<string, any>>
    expect(field.description).toMatch(/not what is private/)
    expect(field.description).toMatch(/members-only page/)
  })
})

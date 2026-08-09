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

import { stripUndefinedDeep } from './strip-undefined'

describe('stripUndefinedDeep (AGL-1334)', () => {
  it('drops the key rather than emitting undefined', () => {
    const props = stripUndefinedDeep({
      children: 'Get started',
      startIconPath: undefined,
    })
    expect('startIconPath' in props).toBe(false)
    expect(props).toEqual({ children: 'Get started' })
  })

  it('keeps null, 0, empty string and false — those are values', () => {
    const props: Record<string, unknown> = {
      color: null,
      elevation: 0,
      label: '',
      disabled: false,
    }
    expect(stripUndefinedDeep(props)).toEqual(props)
  })

  it('reaches nested prop bags, like an instance overrides map', () => {
    const props = stripUndefinedDeep({
      propValues: { label: undefined, link: 'https://example.com' },
    })
    expect(props.propValues).toEqual({ link: 'https://example.com' })
  })

  it('drops undefined array members instead of leaving a hole', () => {
    expect(stripUndefinedDeep(['a', undefined, 'b'])).toEqual(['a', 'b'])
    expect(
      stripUndefinedDeep([{ color: 'red', size: undefined }]),
    ).toEqual([{ color: 'red' }])
  })

  it('returns the input by reference when there is nothing to strip', () => {
    const props = { children: 'Get started', sx: { color: 'red' } }
    expect(stripUndefinedDeep(props)).toBe(props)
  })

  it('leaves class instances alone rather than shredding them', () => {
    // Firestore Timestamps, Bytes and Dates travel inside documents and are
    // not maps to walk — a recursive copy would strip their prototype.
    const stamp = new Date(0)
    const value = stripUndefinedDeep({ stamp, gone: undefined })
    expect(value.stamp).toBe(stamp)
    expect('gone' in value).toBe(false)
  })

  it('passes a bare undefined through for the caller to decide', () => {
    expect(stripUndefinedDeep(undefined)).toBeUndefined()
    expect(stripUndefinedDeep(null)).toBeNull()
  })
})

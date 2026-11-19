/**
 * @jest-environment node
 *
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

import { Timestamp } from 'firebase-admin/firestore'
import { serialize } from './api-v1-kit'

const ISO = '2026-11-19T12:00:00.000Z'

describe('serialize (AGL-4235)', () => {
  it('gives a Timestamp as its ISO string', () => {
    expect(serialize(Timestamp.fromDate(new Date(ISO)))).toBe(ISO)
  })

  it('gives a plain Date as its ISO string, never an empty object', () => {
    expect(serialize(new Date(ISO))).toBe(ISO)
  })

  it('gives a Date nested in an object or an array as its ISO string', () => {
    expect(serialize({ updatedAt: new Date(ISO), seo: { at: new Date(ISO) } })).toEqual({ updatedAt: ISO, seo: { at: ISO } })
    expect(serialize([new Date(ISO), { at: new Date(ISO) }])).toEqual([ISO, { at: ISO }])
  })

  it('gives an invalid Date as null rather than throwing', () => {
    expect(serialize(new Date('not a date'))).toBeNull()
    expect(serialize({ at: new Date(Number.NaN) })).toEqual({ at: null })
  })

  it('leaves plain values as they are', () => {
    expect(serialize({ name: 'About', order: 2, live: true, none: null })).toEqual({ name: 'About', order: 2, live: true, none: null })
    expect(serialize(undefined)).toBeUndefined()
  })
})

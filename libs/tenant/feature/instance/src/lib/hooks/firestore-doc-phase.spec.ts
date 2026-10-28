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
 * Where a document read stands (AGL-4089). The staff site page stated a
 * loading site's empty values as facts ("Not published", 0 published pages)
 * for the half minute another tab held the shared cache; a document is
 * loading until it arrives, and missing only once the server says so.
 */

import { firestoreDocPhase } from './use-firestore-doc'

describe('firestoreDocPhase', () => {
  it('is loading before any answer, and while only the cache has said "missing"', () => {
    expect(firestoreDocPhase({ data: undefined, status: 'loading', fromCache: true })).toBe('loading')
    expect(firestoreDocPhase({ data: undefined, status: 'success', fromCache: true })).toBe('loading')
  })

  it('is missing only once the server has answered with nothing', () => {
    expect(firestoreDocPhase({ data: undefined, status: 'success', fromCache: false })).toBe('missing')
  })

  it('is ready with data, cached or confirmed, and an error without it', () => {
    expect(firestoreDocPhase({ data: { name: 'Site' }, status: 'success', fromCache: true })).toBe('ready')
    expect(firestoreDocPhase({ data: { name: 'Site' }, status: 'error', fromCache: true })).toBe('ready')
    expect(firestoreDocPhase({ data: undefined, status: 'error', fromCache: true })).toBe('error')
  })
})

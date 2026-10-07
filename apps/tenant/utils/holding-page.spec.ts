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

import { isHoldingPageRequest } from './holding-page'

describe('the holding page (AGL-3594)', () => {
  it('answers the root of a site that routes no page at all', () => {
    expect(isHoldingPageRequest('/', {})).toBe(true)
    expect(isHoldingPageRequest('/', undefined)).toBe(true)
  })

  it('never answers another path, or the root of a site with any routed page — those stay the 404', () => {
    expect(isHoldingPageRequest('about', {})).toBe(false)
    expect(isHoldingPageRequest('/', { scrAbout: 'about' })).toBe(false)
    expect(isHoldingPageRequest('/', { scrHome: '/' })).toBe(false)
  })
})

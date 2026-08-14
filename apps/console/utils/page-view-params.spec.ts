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

import { buildConsolePageViewParams } from './page-view-params'

describe('console page_view params (AGL-1643)', () => {
  it('sends an absolute URL, so GA4 can derive the Hostname dimension', () => {
    const params = buildConsolePageViewParams(
      'https://app.aglyn.com/acme/hosts',
    )
    expect(params.page_location).toBe('https://app.aglyn.com/acme/hosts')
    // The bug: a bare pathname names no host at all, and Hostname is what
    // separates aglyn.com from app.aglyn.com inside the one property.
    expect(params.page_location).not.toBe('/acme/hosts')
    expect(String(params.page_location)).toContain('app.aglyn.com')
  })

  it('keeps marketing and console distinguishable', () => {
    expect(
      buildConsolePageViewParams('https://aglyn.com/pricing').page_location,
    ).toContain('aglyn.com/pricing')
    expect(
      buildConsolePageViewParams('https://app.aglyn.com/pricing')
        .page_location,
    ).toContain('app.aglyn.com/pricing')
  })

  it('drops the query string, which is where an address turns up', () => {
    const params = buildConsolePageViewParams(
      'https://app.aglyn.com/signup?email=someone@example.com&plan=pro',
    )
    expect(params.page_location).toBe('https://app.aglyn.com/signup')
    expect(String(params.page_location)).not.toContain('someone@example.com')
    expect(String(params.page_location)).not.toContain('plan=pro')
  })

  it('drops the param entirely rather than sending an address in the PATH', () => {
    // The reduction keeps the path, so the sanitizer's email test still has
    // to catch one embedded there.
    const params = buildConsolePageViewParams(
      'https://app.aglyn.com/invite/someone@example.com',
    )
    expect(params).not.toHaveProperty('page_location')
  })
})

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

jest.mock('firebase/firestore', () => ({}))

import { getMobileDeepLinks, getMobileQuickActions, getMobileScreen, resetMobileRegistry, resolveMobileLink } from '@aglyn/mobile-plugin-host'
import { registerRedirectsMobile } from './index'
import { inEvaluationOrder, type RedirectRow } from './use-host-redirects'

describe('the Redirects mobile registration', () => {
  beforeEach(() => {
    resetMobileRegistry()
    registerRedirectsMobile()
  })

  it('registers a site screen and its quick action', () => {
    expect(getMobileScreen('redirects.list')?.requiresSite).toBe(true)
    expect(getMobileQuickActions().map((action) => action.id)).toEqual(['redirects.open'])
  })

  it("opens the console's Redirects page natively", () => {
    expect(resolveMobileLink('https://app.aglyn.com/acme/hosts/shop/redirects', getMobileDeepLinks())).toEqual({
      kind: 'screen',
      screen: 'redirects.list',
      params: { orgSlug: 'acme', hostSlug: 'shop' },
    })
  })
})

describe('inEvaluationOrder', () => {
  it('orders by priority, then source, and drops soft-deleted rules', () => {
    const row = (id: string, source: string, priority?: number, deletedAt?: number) =>
      ({ id, source, destination: '/x', statusCode: 301, priority, deletedAt }) as unknown as RedirectRow
    expect(inEvaluationOrder([row('a', '/b'), row('b', '/a'), row('c', '/z', 1), row('d', '/c', 1, 5)]).map((r) => r.id)).toEqual([
      'c',
      'b',
      'a',
    ])
  })
})

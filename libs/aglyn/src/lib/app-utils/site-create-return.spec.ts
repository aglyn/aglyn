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
  readSiteCreateRequest,
  SITE_CREATE_PARAM,
  SITE_CREATE_STARTER_PARAM,
  siteCreateReturnQuery,
} from './site-create-return'

/**
 * The way back to Create site (AGL-3761, AGL-4049 lane 3): what the payment
 * is told to send the buyer back to, and how the sites page reads it. One
 * module writes and reads it, so the two cannot drift apart.
 */
describe('site create return', () => {
  it('writes the way back in one order, with the payment’s ending when given', () => {
    expect(siteCreateReturnQuery('northwind-studio')?.toString()).toBe('create=site&starter=northwind-studio')
    expect(siteCreateReturnQuery(' l-1 ', 'success')?.toString()).toBe('create=site&starter=l-1&purchase=success')
  })

  it('writes nothing for an id no listing can have', () => {
    for (const id of ['', 'a/b', 'a b', 'x'.repeat(129), '../hosts']) {
      expect(siteCreateReturnQuery(id)).toBeNull()
    }
  })

  it('reads back exactly what it wrote', () => {
    expect(readSiteCreateRequest(siteCreateReturnQuery('l-1', 'canceled'))).toEqual({
      asked: true,
      starter: { listingId: 'l-1', purchase: 'canceled' },
    })
  })

  it('reads ?create=site alone as an ordinary open, with no starter', () => {
    expect(readSiteCreateRequest(new URLSearchParams('create=site'))).toEqual({ asked: true, starter: null })
  })

  it('reads a starter only with create=site, and only a well-formed one', () => {
    expect(readSiteCreateRequest(new URLSearchParams('starter=l-1'))).toEqual({ asked: false, starter: null })
    expect(readSiteCreateRequest(new URLSearchParams('create=site&starter=a%2Fb'))).toEqual({ asked: true, starter: null })
    expect(readSiteCreateRequest(null)).toEqual({ asked: false, starter: null })
  })

  it('reads a payment ending it does not know as no answer', () => {
    expect(
      readSiteCreateRequest(new URLSearchParams(`${SITE_CREATE_PARAM}=site&${SITE_CREATE_STARTER_PARAM}=l-1&purchase=maybe`)),
    ).toEqual({ asked: true, starter: { listingId: 'l-1', purchase: null } })
  })
})

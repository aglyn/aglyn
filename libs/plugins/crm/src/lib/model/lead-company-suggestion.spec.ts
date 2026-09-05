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

import { dollarsToCents, suggestCompanyForLead } from './lead-company-suggestion'

/** The convert dialog's company proposal (AGL-2608). */
describe('suggestCompanyForLead', () => {
  const companies = [
    { $id: 'co-acme', domain: 'acme.com' },
    { $id: 'co-none' },
    { $id: 'co-upper', domain: 'Globex.com' },
  ]

  it('proposes nothing for a public mailbox or a malformed address', () => {
    expect(suggestCompanyForLead('ann@gmail.com', companies)).toEqual({ mode: 'none' })
    expect(suggestCompanyForLead('not-an-address', companies)).toEqual({ mode: 'none' })
    expect(suggestCompanyForLead(undefined, companies)).toEqual({ mode: 'none' })
  })

  it('links the company already at that domain, whatever case it was stored in', () => {
    expect(suggestCompanyForLead('Ann@Acme.com', companies)).toEqual({
      mode: 'existing',
      companyId: 'co-acme',
    })
    expect(suggestCompanyForLead('bo@globex.com', companies)).toEqual({
      mode: 'existing',
      companyId: 'co-upper',
    })
  })

  it('proposes a new company named after the domain when none matches', () => {
    expect(suggestCompanyForLead('cy@initech.co.uk', companies)).toEqual({
      mode: 'new',
      name: 'Initech',
      domain: 'initech.co.uk',
    })
  })
})

describe('dollarsToCents', () => {
  it('tells an empty field from an amount from a mistake', () => {
    expect(dollarsToCents('')).toBeNull()
    expect(dollarsToCents('   ')).toBeNull()
    expect(dollarsToCents('1,200.50')).toBe(120_050)
    expect(dollarsToCents('$99')).toBe(9_900)
    expect(dollarsToCents('abc')).toBeUndefined()
    expect(dollarsToCents('-5')).toBeUndefined()
  })
})

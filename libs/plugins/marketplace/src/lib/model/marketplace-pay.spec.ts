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

import { formatPayCents, payCardLabel, payPrerequisiteOf } from './marketplace-pay'

describe('payPrerequisiteOf', () => {
  it.each(['card_required', 'billing_address_required'])('reads a 412 %s', (code) => {
    expect(payPrerequisiteOf(412, { code })).toBe(code)
  })

  it('reads nothing else as a prerequisite', () => {
    expect(payPrerequisiteOf(409, { code: 'card_required' })).toBeNull()
    expect(payPrerequisiteOf(412, { code: 'something_else' })).toBeNull()
    expect(payPrerequisiteOf(412, null)).toBeNull()
  })
})

describe('formatPayCents', () => {
  it('states dollars and cents', () => {
    expect(formatPayCents(1066)).toBe('$10.66')
    expect(formatPayCents(1000)).toBe('$10.00')
    expect(formatPayCents(123456)).toBe('$1,234.56')
  })
})

describe('payCardLabel', () => {
  it('names a card by brand and last four', () => {
    expect(payCardLabel({ type: 'card', brand: 'visa', last4: '4242' })).toBe('VISA •••• 4242')
  })

  it('names a wallet by its email', () => {
    expect(payCardLabel({ type: 'link', email: 'pay@example.com' })).toBe('link · pay@example.com')
  })

  it('says only "the card on file" to someone who may not see it', () => {
    expect(payCardLabel(null)).toBe('the card on file')
  })
})

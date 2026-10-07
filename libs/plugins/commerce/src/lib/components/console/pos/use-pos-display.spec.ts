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

import { posDisplayTipCents } from './use-pos-display'

describe('the tip the customer display shows (AGL-3608)', () => {
  const open = { status: 'pending', tipCents: 0 }

  it('adds a tip chosen for the next payment to the ones already taken', () => {
    expect(posDisplayTipCents(open, 146)).toBe(146)
    expect(posDisplayTipCents({ status: 'pending', tipCents: 200 }, 146)).toBe(346)
  })

  it('shows only the ledger once the sale is paid, and nothing before a sale', () => {
    expect(posDisplayTipCents({ status: 'paid', tipCents: 200 }, 146)).toBe(200)
    expect(posDisplayTipCents(null, 146)).toBe(0)
  })

  it('never shows a negative or fractional tip', () => {
    expect(posDisplayTipCents(open, -50)).toBe(0)
    expect(posDisplayTipCents(open, 99.6)).toBe(100)
  })
})

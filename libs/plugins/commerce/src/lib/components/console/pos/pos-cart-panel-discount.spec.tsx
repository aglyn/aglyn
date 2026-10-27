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
 * The basket's discount field for a member refused the register's discount
 * key (AGL-4047): on screen, disabled, with the reason — never a field that
 * only fails at the sale.
 */

import { render, screen } from '@testing-library/react'
import { posPermissionRefusal } from '../../../model/plugin-permissions'
import { PosCartPanel } from './pos-cart-panel.component'

const base = {
  lines: [],
  shortfalls: [],
  onQuantity: () => undefined,
  onRemove: () => undefined,
  discountPct: 0,
  onDiscountPct: () => undefined,
  locked: false,
}

describe('the basket discount and the discount key (AGL-4047)', () => {
  it('is open to a member who holds the key', () => {
    render(<PosCartPanel {...base} />)
    expect((screen.getByLabelText('Discount %') as HTMLInputElement).disabled).toBe(false)
  })

  it('is disabled with the reason for a member refused it', () => {
    const reason = posPermissionRefusal('posDiscount')
    render(<PosCartPanel {...base} discountBlocked={reason} />)
    expect((screen.getByRole('textbox', { name: 'Discount %' }) as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByLabelText(reason)).toBeTruthy()
    expect(reason).toContain('Give discounts at the register')
  })
})

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
 *
 * @jest-environment jsdom
 */

/**
 * THE MONEY RENDERERS, on their own.
 *
 * The report cards prove these are wired correctly. This proves the contracts
 * they carry hold for inputs no card produces TODAY — an absent amount and an
 * unrecognised currency code — because a shared renderer's guarantees are the
 * reason the next card does not have to think about them, and a guarantee
 * only the current caller exercises is a guarantee that quietly stops holding
 * the first time somebody else calls it.
 */

import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { money, MoneyFigure, MoneyPerMessageRow } from './report-figures'

const draw = (node: unknown) => render(node as ReactNode as never)

describe('money', () => {
  it('formats minor units in the currency they were recorded in', () => {
    expect(money(45_000, 'usd')).toBe('$450.00')
    expect(money(45_000, 'eur')).toBe('€450.00')
  })

  it('prints a well-formed code nobody has a glyph for as its own symbol', () => {
    // The separator `Intl` puts between a code and its digits is a
    // NON-BREAKING space, and asserting on a plain one fails against output
    // that is character-for-character right on screen.
    expect(money(45_000, 'zzz').replace(/\u00a0/g, ' ')).toBe('ZZZ 450.00')
  })

  it('falls back rather than throwing on a MALFORMED code', () => {
    // These are the ones that throw a `RangeError`, and a report card that
    // throws in render takes every figure on the page down with it —
    // including the ones that were fine.
    expect(money(45_000, '')).toBe('450.00 ')
    expect(money(45_000, 'us')).toBe('450.00 US')
    expect(money(45_000, 'usdd')).toBe('450.00 USDD')
  })
})

describe('MoneyFigure', () => {
  it('draws a dash for an absent amount, and never a zero', () => {
    draw(<MoneyFigure label="Net revenue" cents={null} currency="usd" note="after refunds" />)
    // "We have no record" and "this earned nothing" lead a merchant to
    // opposite conclusions about whether to send another campaign.
    expect(screen.getByText('—')).toBeTruthy()
    expect(screen.getByText('not recorded')).toBeTruthy()
    expect(screen.queryByText('$0.00')).toBeNull()
  })

  it('draws a real zero as a zero', () => {
    draw(<MoneyFigure label="Refunded" cents={0} currency="usd" note="handed back" />)
    expect(screen.getByText('$0.00')).toBeTruthy()
    expect(screen.getByText('handed back')).toBeTruthy()
  })
})

describe('MoneyPerMessageRow', () => {
  it('prints the denominator on the same line as the money', () => {
    draw(
      <MoneyPerMessageRow
        label="Net revenue per delivered message"
        figure={{
          cents: 50,
          numeratorCents: 45_000,
          denominator: 900,
          denominatorLabel: 'delivered',
          currency: 'usd',
        }}
      />,
    )
    expect(screen.getByText('$0.50')).toBeTruthy()
    expect(screen.getByText('$450.00 over 900 delivered')).toBeTruthy()
  })

  it('draws the dash and no number at all for an absent figure', () => {
    draw(<MoneyPerMessageRow label="Net revenue per delivered message" figure={null} />)
    expect(screen.getByText('— not enough recorded to compute')).toBeTruthy()
  })
})

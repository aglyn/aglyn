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
 * The revenue charts at ZERO, ONE and MANY (AGL-2486).
 *
 * These were built before there is real data to plot, so the low-data cases
 * are the specification rather than an edge: at launch the page has $25.00 and
 * one paying org, and a chart that reads as a broken widget there is worse
 * than no chart.
 */

import { render, screen } from '@testing-library/react'
import {
  CompositionBar,
  RankedBars,
} from './revenue-charts.component'

describe('CompositionBar', () => {
  it('draws NOTHING at zero and says what it is waiting for', () => {
    render(
      <CompositionBar
        slices={[{ key: 'subs', label: 'Subscriptions', cents: 0 }]}
        emptyMessage="Nothing settled yet."
      />,
    )
    expect(screen.getByText('Nothing settled yet.')).toBeTruthy()
    // No shape at all — a zero-total bar renders as either an empty frame or
    // a fabricated full block, and both read as broken.
    expect(document.querySelector('[data-slice]')).toBeNull()
  })

  it('DRAWS a single source and states that it is one, not a comparison', () => {
    // The important difference from a trend chart: a composition of one
    // source is a true statement about proportion, so hiding it would
    // withhold a real fact.
    render(
      <CompositionBar
        slices={[
          { key: 'subs', label: 'Subscriptions', cents: 2500 },
          { key: 'mkt', label: 'Marketplace', cents: 0 },
        ]}
        emptyMessage="Nothing settled yet."
      />,
    )
    expect(document.querySelectorAll('[data-slice]')).toHaveLength(1)
    expect(screen.getByText(/All of it came from Subscriptions/i)).toBeTruthy()
    expect(screen.getByText(/one source, so this is a statement/i)).toBeTruthy()
  })

  it('divides many sources by share, largest first', () => {
    render(
      <CompositionBar
        slices={[
          { key: 'a', label: 'Small', cents: 2500 },
          { key: 'b', label: 'Big', cents: 7500 },
        ]}
        emptyMessage="Nothing settled yet."
      />,
    )
    const slices = [...document.querySelectorAll('[data-slice]')]
    expect(slices.map((node) => node.getAttribute('data-slice'))).toEqual([
      'b',
      'a',
    ])
    expect(screen.getByText(/Big \$75\.00 \(75\.0%\)/)).toBeTruthy()
    // A single-source note must NOT appear once there is a real comparison.
    expect(screen.queryByText(/All of it came from/i)).toBeNull()
  })

  it('excludes a negative slice from the division rather than rescaling', () => {
    // A proportional chart cannot express a negative share, and quietly
    // rescaling to fit one would misstate every other segment.
    render(
      <CompositionBar
        slices={[
          { key: 'a', label: 'Earned', cents: 10_000 },
          { key: 'b', label: 'Reversed', cents: -4_000 },
        ]}
        emptyMessage="Nothing settled yet."
      />,
    )
    expect(document.querySelectorAll('[data-slice]')).toHaveLength(1)
    expect(screen.getByText(/Earned \$100\.00 \(100\.0%\)/)).toBeTruthy()
  })
})

describe('RankedBars', () => {
  it('draws nothing at zero rows', () => {
    render(<RankedBars rows={[]} emptyMessage="No sources yet." />)
    expect(screen.getByText('No sources yet.')).toBeTruthy()
    expect(document.querySelector('[data-bar]')).toBeNull()
  })

  it('draws a single row — a magnitude implies no comparison', () => {
    render(
      <RankedBars
        rows={[{ key: 'o1', label: 'Test Org', cents: 2500 }]}
        emptyMessage="No sources yet."
      />,
    )
    expect(document.querySelectorAll('[data-bar]')).toHaveLength(1)
    expect(screen.getByText('Test Org')).toBeTruthy()
    expect(screen.getByText('$25.00')).toBeTruthy()
  })

  it('renders a ZERO row as a hairline, never a floor-height bar', () => {
    // "Earned nothing" and "earned a little" must not look the same.
    render(
      <RankedBars
        rows={[
          { key: 'a', label: 'Earned', cents: 5_000 },
          { key: 'b', label: 'Nothing', cents: 0 },
        ]}
        emptyMessage="No sources yet."
      />,
    )
    // Asserted on the RENDERED GEOMETRY, not on a label beside it. A version
    // that tagged the row `data-zero` and still drew it at floor height would
    // pass an attribute check while showing the reader a bar that is not
    // there — which is exactly the fabricated measurement being guarded.
    const zero = document.querySelector('[data-bar="b"]') as HTMLElement
    const earning = document.querySelector('[data-bar="a"]') as HTMLElement
    expect(zero.getAttribute('data-zero')).toBe('true')
    expect(earning.getAttribute('data-zero')).toBe('false')
    const zeroWidth = getComputedStyle(zero).width
    const earningWidth = getComputedStyle(earning).width
    expect(zeroWidth).toBe('2px')
    expect(earningWidth).toMatch(/%$/)
    expect(zeroWidth).not.toBe(earningWidth)
  })

  it('sorts descending so the largest contributor reads first', () => {
    render(
      <RankedBars
        rows={[
          { key: 'small', label: 'Small', cents: 100 },
          { key: 'big', label: 'Big', cents: 9_000 },
        ]}
        emptyMessage="No sources yet."
      />,
    )
    const bars = [...document.querySelectorAll('[data-bar]')]
    expect(bars.map((node) => node.getAttribute('data-bar'))).toEqual([
      'big',
      'small',
    ])
  })
})

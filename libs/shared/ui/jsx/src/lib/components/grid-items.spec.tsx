/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import React from 'react'
import {render, screen} from '@testing-library/react'

import GridItems from './grid-items'


describe('GridItems', () => {
  it('should render successfully', () => {
    const {baseElement} = render(<GridItems />)
    expect(baseElement).toBeTruthy()
  })
})

/**
 * Masonry mode is a LAYOUT, and jsdom computes none of it — so these assert the
 * one thing that is real in jsdom and that the layout entirely follows from:
 * which cards were bucketed into which column. Every reported symptom (the dead
 * space under `Current plan`, the sidebar stranded below the fold) is a
 * consequence of that grouping, and the geometry itself was verified in a
 * browser against the two live pages.
 */
describe('GridItems masonry', () => {
  const card = (name: string) => <div data-card={name} />

  /** [column index] → the cards in it, in order. */
  const columns = () =>
    [...screen.getByTestId('grid').children].map((column) =>
      [...column.querySelectorAll('[data-card]')].map((el) =>
        el.getAttribute('data-card'),
      ),
    )

  /** The billing page's real shape: 4, 8, 4, then a full-width card. */
  const billingItems = [
    {size: {xs: 12, md: 4}, children: card('current-plan')},
    {size: {xs: 12, md: 8}, children: card('usage')},
    {size: {xs: 12, md: 4}, children: card('metered-estimate')},
    {size: {xs: 12}, children: card('storage-cap')},
  ]

  it('leaves the plain row layout alone when `masonry` is not set', () => {
    const {baseElement} = render(<GridItems items={billingItems} spacing={3} />)
    // The untouched path is still MUI's flex Grid container, and every item is
    // a direct child of it rather than being wrapped in a column.
    const container = baseElement.querySelector('.MuiGrid-container')
    expect(container).toBeTruthy()
    expect(container?.querySelectorAll('[data-card]')).toHaveLength(4)
    expect(container?.children).toHaveLength(4)
  })

  it('buckets same-width cards into one column so the short one stops leaving a hole', () => {
    render(<GridItems data-testid="grid" masonry items={billingItems} spacing={3} />)
    expect(columns()).toEqual([
      // `Metered usage estimate` now sits UNDER `Current plan` instead of on a
      // row of its own — this grouping is the fix for the dead space.
      ['current-plan', 'metered-estimate'],
      ['usage'],
      ['storage-cap'],
    ])
  })

  /**
   * THE RED THAT ALREADY HAPPENED.
   *
   * Bucketing keys off the width at the WIDEST declared breakpoint. The first
   * implementation used `Math.max` over the breakpoint object instead — and
   * since every item in this codebase is written `{ xs: 12, md: 4 }`, the
   * maximum is 12 for all of them, every card read as full width, and masonry
   * silently degraded to the exact stack it was meant to replace. It still
   * rendered, still looked plausible, and fixed nothing.
   */
  it('does NOT read `{ xs: 12, md: 4 }` as a full-width card', () => {
    render(
      <GridItems
        data-testid="grid"
        masonry
        spacing={3}
        items={[
          {size: {xs: 12, md: 4}, children: card('a')},
          {size: {xs: 12, md: 4}, children: card('b')},
        ]}
      />,
    )
    // One shared column. Under the `Math.max` bug this was two, because both
    // cards looked full width and each took a band of its own.
    expect(columns()).toEqual([['a', 'b']])
  })

  it('THE CONTROL: a genuinely full-width card DOES get its own column', () => {
    // Without this the case above is satisfied by a build that never treats
    // anything as full width, which would break billing's five wide cards.
    render(
      <GridItems
        data-testid="grid"
        masonry
        spacing={3}
        items={[
          {size: {xs: 12}, children: card('a')},
          {size: {xs: 12}, children: card('b')},
        ]}
      />,
    )
    expect(columns()).toEqual([['a'], ['b']])
  })

  it('keeps the marketplace sidebar beside the body instead of behind it', () => {
    // body(8), changelog(8), sidebar(4) — the shape that made `Install` open
    // below the fold, because the sidebar followed the wrapped changelog.
    render(
      <GridItems
        data-testid="grid"
        masonry
        spacing={3}
        items={[
          {size: {xs: 12, md: 8}, children: card('body')},
          {size: {xs: 12, md: 8}, children: card('changelog')},
          {size: {xs: 12, md: 4}, children: card('sidebar')},
        ]}
      />,
    )
    expect(columns()).toEqual([['body', 'changelog'], ['sidebar']])
  })

  it('hides an item whose children rendered NOTHING', () => {
    // A plugin widget slot renders an empty fragment when no plugin is
    // entitled for it. The item wrapper survives, and a column is a flex
    // stack with a `gap` — so an empty wrapper draws the gutter on BOTH
    // sides of a zero-height box, a hole exactly where the absent card was.
    render(
      <GridItems
        data-testid="grid"
        masonry
        spacing={3}
        items={[
          {size: {xs: 12, md: 4}, children: card('a')},
          {size: {xs: 12, md: 4}, children: null},
        ]}
      />,
    )
    const column = screen.getByTestId('grid').firstElementChild as HTMLElement
    const generated = column.className
      .split(' ')
      .find((name) => name.startsWith('css-') || name.startsWith('mui-'))
    // Guard the guard: with no generated class the search below would run
    // over the whole document's CSS, or over nothing at all.
    expect(generated).toBeTruthy()
    const stylesheet = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText)
        } catch {
          return []
        }
      })
      .join('\n')
    const rule = stylesheet
      .split('\n')
      .find((line) => line.includes(generated as string) && line.includes(':empty'))
    expect(rule).toContain('display: none')
    // THE CONTROL: it must be `:empty` that hides them and not a blanket
    // rule — a real card still lays out.
    const plain = stylesheet
      .split('\n')
      .find((line) => line.includes(generated as string) && !line.includes(':empty'))
    expect(plain).not.toContain('display: none')
  })

  it('does not let a full-width card reorder the page around it', () => {
    // A full-width item ends the band, so the cards after it cannot be pulled
    // up into a column beside cards from before it.
    render(
      <GridItems
        data-testid="grid"
        masonry
        spacing={3}
        items={[
          {size: {xs: 12, md: 4}, children: card('before')},
          {size: {xs: 12}, children: card('divider')},
          {size: {xs: 12, md: 4}, children: card('after')},
        ]}
      />,
    )
    expect(columns()).toEqual([['before'], ['divider'], ['after']])
  })
})

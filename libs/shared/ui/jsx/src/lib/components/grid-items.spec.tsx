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

import GridItems, {ABSENT_WHEN_EMPTY, EMPTY_FRAME_SELECTOR} from './grid-items'


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

  /*
   * Cards of unequal height are the common case, so masonry is what a caller
   * gets without asking. A ROW is now the deliberate choice — tiles, buttons,
   * a navigation column beside its content — and it is spelled out.
   */
  it('gives masonry to a caller that asks for nothing', () => {
    const {baseElement} = render(<GridItems items={billingItems} spacing={3} />)
    expect(baseElement.querySelector('.MuiGrid-container')).toBeNull()
    expect(baseElement.querySelectorAll('[data-card]')).toHaveLength(4)
  })

  it('leaves the plain row layout alone when `masonry` is switched off', () => {
    const {baseElement} = render(
      <GridItems items={billingItems} spacing={3} masonry={false} />,
    )
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
          {size: {xs: 12, md: 4}, children: card('c')},
          {size: {xs: 12, md: 4}, children: card('d')},
        ]}
      />,
    )
    /*
     * FOUR cards, because two cannot tell the two failures apart: under the
     * `Math.max` bug each 4-wide card was its own full-width band, and with
     * only two cards that renders as two columns — exactly what a correct
     * fan-out also produces.
     *
     * At four the shapes separate. Twelve columns divided by a span of four is
     * three columns, so a correct build wraps `d` back under `a`; the bug
     * gives four columns of one card each, every one of them full width.
     */
    expect(columns()).toEqual([['a', 'd'], ['b'], ['c']])
  })

  it('a band of ONE width fans out instead of queueing in one column', () => {
    /*
     * The health page's shape: eight equal probe cards. Bucketing same-width
     * items together is right when something else occupies the rest of the row
     * — billing, above — and wrong when the band is all of that width, which
     * left six of twelve columns empty and read as a single stacked column.
     *
     * Round-robin rather than filling each column in turn, so reading order
     * stays left-to-right: first card top-left, second top-right.
     */
    render(
      <GridItems
        data-testid="grid"
        masonry
        spacing={3}
        items={['a', 'b', 'c', 'd', 'e'].map((name) => ({
          size: {xs: 12, md: 6},
          children: card(name),
        }))}
      />,
    )
    expect(columns()).toEqual([
      ['a', 'c', 'e'],
      ['b', 'd'],
    ])
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

/**
 * AGL-3050: an absent band leaves no gap where it would have been.
 *
 * jsdom applies no `@media` rule a page's breakpoints emit and performs no
 * layout, so these pin the rules the grid EMITS and the elements their
 * selectors pick out. The geometry was measured in headless Chrome against
 * exactly these declarations: 48px between the cards around an empty
 * full-width band without the column rules, 24px with them, at 400, 700, 1000
 * and 1300px.
 */
describe('GridItems masonry · an empty band', () => {
  const card = (name: string) => <div data-card={name}>{name}</div>

  /** The column's two empty shapes, and the item that holds an empty frame. */
  const ITEM_EMPTY = ':has(> :only-child:empty)'
  const ONLY_AN_EMPTY_FRAME = `:has(> :only-child > ${EMPTY_FRAME_SELECTOR})`
  const ITEM_HOLDS_AN_EMPTY_FRAME = `:has(> ${EMPTY_FRAME_SELECTOR})`

  /** Every emitted rule that names the element's generated class. */
  const rulesNaming = (element: Element) => {
    const generated = element.className
      .split(' ')
      .find((name) => name.startsWith('css-') || name.startsWith('mui-'))
    // Guard the guard: with no generated class the search runs over nothing.
    expect(generated).toBeTruthy()
    return Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText)
        } catch {
          return []
        }
      })
      .filter((rule) => rule.includes(generated as string))
  }

  /** The column's own rules for a selector, not the item rules beside them. */
  const columnRules = (column: Element, selector: string) =>
    rulesNaming(column).filter((rule) => rule.includes(selector) && !rule.includes('>*'))

  const draw = (items: Array<{size: Record<string, number>; children: React.ReactNode}>) => {
    render(<GridItems data-testid="grid" masonry spacing={3} items={items} />)
    return [...screen.getByTestId('grid').children] as HTMLElement[]
  }

  it('hides a full-width column whose item rendered nothing, at every width', () => {
    const [, absent] = draw([
      {size: {xs: 12}, children: card('traffic')},
      {size: {xs: 12}, children: null},
      {size: {xs: 12}, children: card('raw-json')},
    ])
    expect(absent.matches(ITEM_EMPTY)).toBe(true)
    const [rule] = columnRules(absent, ITEM_EMPTY)
    expect(rule).toContain('min-width:0px')
    expect(rule).toContain('display: none')
    expect(rule).not.toContain('display: flex')
  })

  it('hides a full-width column whose one item holds only a marked frame that drew nothing', () => {
    // A widget zone whose widgets all rendered nothing: the item is not
    // `:empty`, the frame in it is.
    const [, absent] = draw([
      {size: {xs: 12}, children: card('plans')},
      {size: {xs: 12}, children: <div {...ABSENT_WHEN_EMPTY} data-widget-zone="orgBillingOverview" />},
      {size: {xs: 12}, children: card('after')},
    ])
    expect(absent.matches(ONLY_AN_EMPTY_FRAME)).toBe(true)
    expect(columnRules(absent, ONLY_AN_EMPTY_FRAME)[0]).toContain('display: none')
    // And the item itself, which is what hides it inside a column of several.
    const item = absent.firstElementChild as HTMLElement
    expect(item.matches(ITEM_HOLDS_AN_EMPTY_FRAME)).toBe(true)
    expect(
      rulesNaming(absent).find((rule) => rule.includes(`>*${ITEM_HOLDS_AN_EMPTY_FRAME}`)),
    ).toContain('display: none')
  })

  it('never hides an item whose one element draws something with no children of its own', () => {
    // A chart's canvas, a divider, a loading skeleton and a bare box are all
    // `:empty` in CSS terms. Only the mark says an element is a frame, so none
    // of these may be taken for an absent card.
    const [chart, divider, skeleton, bare] = draw([
      {size: {xs: 12}, children: <canvas />},
      {size: {xs: 12}, children: <hr />},
      {size: {xs: 12}, children: <span className="MuiSkeleton-root" />},
      {size: {xs: 12}, children: <div />},
    ])
    for (const column of [chart, divider, skeleton, bare]) {
      expect(column.matches(ONLY_AN_EMPTY_FRAME)).toBe(false)
      expect(column.matches(ITEM_EMPTY)).toBe(false)
      expect((column.firstElementChild as HTMLElement).matches(ITEM_HOLDS_AN_EMPTY_FRAME)).toBe(false)
    }
  })

  it('CONTROL: a marked frame with a card drawn in it is not empty', () => {
    const [drawn] = draw([
      {size: {xs: 12}, children: <div {...ABSENT_WHEN_EMPTY}>{card('ai-credits')}</div>},
    ])
    expect(drawn.matches(ONLY_AN_EMPTY_FRAME)).toBe(false)
    expect((drawn.firstElementChild as HTMLElement).matches(ITEM_HOLDS_AN_EMPTY_FRAME)).toBe(false)
  })

  it('keeps a column that still has a card to draw beside an item that rendered nothing', () => {
    // Two 4-wide items share a column beside an 8-wide one. The empty item
    // hides on its own; the column stays for the card.
    const [shared] = draw([
      {size: {xs: 12, md: 4}, children: null},
      {size: {xs: 12, md: 8}, children: card('usage')},
      {size: {xs: 12, md: 4}, children: card('estimate')},
    ])
    expect(shared.children).toHaveLength(2)
    expect(shared.matches(ITEM_EMPTY)).toBe(false)
    expect((shared.firstElementChild as HTMLElement).matches(':empty')).toBe(true)
  })

  it('hides a narrower column only where it spans the row, so the next column never slides into its tracks', () => {
    const [empty] = draw([
      {size: {xs: 12, md: 4}, children: null},
      {size: {xs: 12, md: 8}, children: card('usage')},
    ])
    for (const selector of [ITEM_EMPTY, ONLY_AN_EMPTY_FRAME]) {
      const rules = columnRules(empty, selector)
      expect(rules.find((rule) => rule.includes('min-width:0px'))).toContain('display: none')
      expect(rules.find((rule) => rule.includes('min-width:900px'))).toContain('display: flex')
    }
  })

  it('CONTROL: a column with a card to draw is laid out', () => {
    const [drawn] = draw([{size: {xs: 12}, children: card('drawn')}])
    // No media rule reaches jsdom; the base declaration is what it computes,
    // and the column holds a card, so no `:has()` rule may match it either.
    expect(getComputedStyle(drawn).display).toBe('flex')
    expect(drawn.matches(ITEM_EMPTY)).toBe(false)
    expect(drawn.matches(ONLY_AN_EMPTY_FRAME)).toBe(false)
  })
})

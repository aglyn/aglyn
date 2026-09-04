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

import { render } from '@testing-library/react'
import DataTable from './data-table'
import Markdown from './markdown'

/**
 * Wide tables crushed instead of scrolling (AGL-2568).
 *
 * Both wrappers already carried `overflow-x: auto`, and neither ever
 * overflowed: the table inside was `width: 100%`, and a table that cannot
 * exceed its wrapper never triggers the wrapper's overflow — the browser
 * compresses its columns to min-content instead. Measured on the live
 * `/alternatives/alternativeswebflow` at 375px: wrapper 343px, table 343px,
 * `scrollWidth - clientWidth` 0, columns 118/107/117, the table 1022px tall
 * with a six-line cell. At 320px the same table exceeded its box by 33px
 * behind an overlay scrollbar of zero visible height, cutting the competitor
 * column mid-word.
 *
 * These assert the CSS the components emit, because jsdom has no layout —
 * the widths above came from a real browser and re-deriving them is a
 * browser's job, not this file's. What this file holds onto is that the
 * rules exist, that they are the pair that makes scrolling possible, and
 * that the two components have not drifted apart again.
 */
describe('a wide table scrolls rather than crushing (AGL-2568)', () => {
  /**
   * Every CSS rule the render produced. Emotion inserts through
   * `CSSOM.insertRule` under jest, so the `<style>` tags are EMPTY and only
   * `document.styleSheets` has the rules — reading `textContent` returns ""
   * and every assertion below would pass for the wrong reason.
   */
  const allCss = (): string[] => {
    const rules: string[] = []
    for (const sheet of [...(document.styleSheets as any)]) {
      try {
        for (const rule of [...(sheet.cssRules as any)]) {
          rules.push(rule.cssText)
        }
      } catch {
        /* a sheet jsdom cannot read has nothing to say */
      }
    }
    return rules
  }

  const squash = (text: string) => text.replace(/\s+/g, '')

  const emotionClass = (el: Element) =>
    [...el.classList].find((name) => /^(css|mui)-/.test(name)) as string

  const ruleFor = (el: Element) => {
    const cls = emotionClass(el)
    return squash(allCss().find((rule) => rule.startsWith(`.${cls} {`)) ?? '')
  }

  /** Emotion hoists an `@supports` block out into a rule of its own. */
  const supportsRuleFor = (el: Element) => {
    const cls = emotionClass(el)
    return squash(
      allCss().find(
        (rule) => rule.startsWith('@supports') && rule.includes(`.${cls} `),
      ) ?? '',
    )
  }

  const MATRIX = [
    '| Feature | Aglyn | Webflow |',
    '| --- | :---: | ---: |',
    '| Team seats | Band included, 2 to 100 by plan | Core $19 per seat |',
    '| Source available | Apache 2.0 | Proprietary |',
  ].join('\n')

  /** The Markdown route: a table authored as pipe syntax in a document. */
  const renderMarkdownTable = () => {
    const { container } = render(<Markdown content={MATRIX} />)
    const table = container.querySelector('table') as HTMLElement
    return { table, wrapper: table.parentElement as HTMLElement }
  }

  /** The Table element, drawing the same block from the same syntax. */
  const renderTableElement = () => {
    const { container } = render(<DataTable rows={MATRIX} />)
    const table = container.querySelector('table') as HTMLElement
    return { table, wrapper: container.firstElementChild as HTMLElement }
  }

  const routes = [
    ['the Markdown table', renderMarkdownTable],
    ['the Table element', renderTableElement],
  ] as const

  describe.each(routes)('%s', (_name, renderRoute) => {
    it('lets the table exceed its wrapper, which is what makes it scroll', () => {
      const { table, wrapper } = renderRoute()
      // Positive control: an empty string would satisfy every `toContain`.
      expect(ruleFor(table)).toContain('width:')
      // The wrapper's half of the pair, which is all either component had.
      expect(ruleFor(wrapper)).toContain('overflow-x:auto')
      // The table's half, which neither had: `max-content` asks for the
      // width the content wants, so there is finally something to overflow.
      expect(ruleFor(table)).toContain('width:max-content')
      expect(ruleFor(table)).toContain('min-width:100%')
      // Bounded, or a long cell would push the table to 1010px and take the
      // row label off-screen — measured at 375px on the live Webflow table.
      expect(ruleFor(table)).toContain('max-width:560px')
    })

    it('never forces a table NARROWER than its box to scroll', () => {
      // `min-width: 100%` is what protects the short "Yes / No" grid this
      // element ships as its own preset: measured at 375px it stays 343px
      // wide and gains no scrollbar, where a flat `min-width: 560px` would
      // have handed it 217px of sideways travel it never needed. And
      // `min-width` beats `max-width` in the CSS used-width rules, so a
      // desktop table still fills a container wider than the cap.
      const { table } = renderRoute()
      expect(ruleFor(table)).toContain('min-width:100%')
      expect(ruleFor(table)).not.toMatch(/[;{]width:100%/)
    })

    it('can be reached and named — a scroll box no keyboard can move is not scrollable', () => {
      // WCAG 2.1.1: a scrollable region with no focusable descendant cannot
      // be scrolled from the keyboard at all; the arrow keys move the page
      // behind it. A table's cells are not focusable, so the box needs a tab
      // stop of its own, and a name so the stop is announced rather than
      // silent.
      const { wrapper } = renderRoute()
      expect(wrapper.tabIndex).toBe(0)
      expect(wrapper.getAttribute('role')).toBe('region')
      expect(wrapper.getAttribute('aria-label')).toBe('Table')
    })

    it('says that it scrolls, on a platform that draws no scrollbar', () => {
      // Measured at 320px: `offsetHeight - clientHeight` on the wrapper is 0
      // — an overlay scrollbar, invisible until you have already guessed to
      // scroll. So the cut has to stop reading as the end of the table. The
      // fade rides a scroll-driven animation because a `scroll()` timeline on
      // a box with nothing to scroll is INACTIVE and applies no styles, which
      // is how "only when it overflows" is said in CSS with no measuring.
      const { wrapper } = renderRoute()
      expect(ruleFor(wrapper)).toContain('overflow-x:auto')
      expect(supportsRuleFor(wrapper)).toMatch(
        /@supports\(animation-timeline:scroll\(\)\)\{[^}]*scroll\(selfinline\)/,
      )
      const keyframes = squash(
        allCss().find((rule) =>
          rule.startsWith('@keyframes aglyn-overflow-fade-inline'),
        ) ?? '',
      )
      // To the RIGHT: this box scrolls on the inline axis, and the fade that
      // ships for the table of contents fades the bottom.
      expect(keyframes).toContain(
        'mask-image:linear-gradient(toright,#000calc(100%-28px),transparent)',
      )
      // …and it lets go before the end, so the last column is never the one
      // the affordance obscures.
      expect(keyframes).toMatch(/100%\{[^}]*mask-image:none/)
    })
  })

  it('gives both routes the SAME sizing, because they draw the same block', () => {
    // The defect was two components solving one problem separately and
    // drifting: the Markdown route grew a scroll fade for its table of
    // contents that the Table element never got, and the Table element
    // carried a comment claiming a responsive behaviour neither delivered.
    // They share one module now, and this is what says so next time.
    const markdown = renderMarkdownTable()
    const element = renderTableElement()
    const sizing = (rule: string) =>
      ['width:max-content', 'min-width:100%', 'max-width:560px'].filter(
        (declaration) => rule.includes(declaration),
      )
    expect(sizing(ruleFor(markdown.table))).toHaveLength(3)
    expect(sizing(ruleFor(element.table))).toEqual(
      sizing(ruleFor(markdown.table)),
    )
    expect(element.wrapper.getAttribute('aria-label')).toBe(
      markdown.wrapper.getAttribute('aria-label'),
    )
  })
})

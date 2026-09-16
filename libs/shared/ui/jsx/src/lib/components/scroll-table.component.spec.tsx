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
 * A table wider than its card scrolls inside the card (AGL-3045).
 *
 * jsdom has no layout, so nothing here can measure a column past a card's
 * edge — that is the browser's half. What this file holds is the CSS that
 * makes the difference: the box around the table scrolls on the inline axis,
 * says so while it does, and leaves a table that fits exactly as wide as its
 * card.
 */

import { TableBody, TableCell, TableHead, TableRow } from '@mui/material'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { ScrollTable } from './scroll-table.component'

/**
 * Every CSS rule the render produced. Emotion inserts through
 * `CSSOM.insertRule` under jest, so the `<style>` tags are EMPTY and only
 * `document.styleSheets` holds the rules.
 */
const allCss = (): string[] => {
  const rules: string[] = []
  for (const sheet of [...(document.styleSheets as any)]) {
    try {
      for (const rule of [...(sheet.cssRules as any)]) rules.push(rule.cssText)
    } catch {
      /* a sheet jsdom cannot read has nothing to say */
    }
  }
  return rules
}

const squash = (text: string) => text.replace(/\s+/g, '')

/** The emotion rule for one element, whitespace removed. */
const ruleFor = (el: Element) => {
  const cls = [...el.classList].find((name) => /^css-/.test(name)) as string
  return squash(allCss().find((rule) => rule.startsWith(`.${cls} {`)) ?? '')
}

function Jobs(props: Partial<Omit<Parameters<typeof ScrollTable>[0], 'nested'>>) {
  return (
    <ScrollTable size="small" aria-label="Generation jobs" {...props}>
      <TableHead>
        <TableRow>
          <TableCell>{'Job'}</TableCell>
          <TableCell>{'Started'}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow>
          <TableCell>{'2fQx8Yw1LzP0mDk3Rj7a'}</TableCell>
          <TableCell>{'9/16/2026 Hn4tE2aBq9WcX5sLr8ZkY1uVp3oM'}</TableCell>
        </TableRow>
      </TableBody>
    </ScrollTable>
  )
}

describe('ScrollTable (AGL-3045)', () => {
  it('puts the table in a box that scrolls sideways', () => {
    const { container } = render(<Jobs />)
    const box = container.firstElementChild as HTMLElement
    const table = screen.getByRole('table', { name: 'Generation jobs' })
    // The table is the box's own child: nothing between them can clip it.
    expect(table.parentElement).toBe(box)
    expect(getComputedStyle(box).overflowX).toBe('auto')
    expect(getComputedStyle(box).width).toBe('100%')
  })

  it('leaves the table as wide as its card, so a table that fits gains no scrollbar', () => {
    render(<Jobs />)
    const rule = ruleFor(screen.getByRole('table'))
    // Positive control: an empty rule would pass every negative below.
    expect(rule).toContain('display:table')
    expect(rule).toContain('width:100%')
    expect(rule).not.toContain('max-content')
  })

  it('says that it scrolls, on a platform whose scrollbar is invisible at rest', () => {
    const { container } = render(<Jobs />)
    const box = container.firstElementChild as HTMLElement
    const cls = [...box.classList].find((name) => /^css-/.test(name)) as string
    // Emotion hoists the `@supports` block into a rule of its own. A
    // `scroll()` timeline on a box with nothing to scroll is inactive, which
    // is what keeps the fade off a table that fits.
    const supports = squash(
      allCss().find(
        (rule) => rule.startsWith('@supports') && rule.includes(`.${cls} `),
      ) ?? '',
    )
    expect(supports).toMatch(
      /@supports\(animation-timeline:scroll\(\)\)\{[^}]*scroll\(selfinline\)/,
    )
    const keyframes = squash(
      allCss().find((rule) =>
        rule.startsWith('@keyframes aglyn-overflow-fade-inline'),
      ) ?? '',
    )
    expect(keyframes).toContain(
      'mask-image:linear-gradient(toright,#000calc(100%-28px),transparent)',
    )
    // It lets go before the end, so the last column is never the one hidden.
    expect(keyframes).toMatch(/100%\{[^}]*mask-image:none/)
  })

  it('hands Table props to the table and ContainerProps to the box', () => {
    const { container } = render(
      <Jobs
        stickyHeader
        ContainerProps={{
          role: 'region',
          'aria-label': 'Jobs, scrollable',
          tabIndex: 0,
          'data-testid': 'jobs-box',
          sx: { maxHeight: 320 },
        }}
      />,
    )
    const box = container.firstElementChild as HTMLElement
    expect(box.getAttribute('role')).toBe('region')
    expect(box.getAttribute('aria-label')).toBe('Jobs, scrollable')
    expect(box.tabIndex).toBe(0)
    expect(screen.getByTestId('jobs-box')).toBe(box)
    const table = screen.getByRole('table', { name: 'Generation jobs' })
    expect(table.className).toContain('MuiTable-stickyHeader')
    expect(
      screen.getAllByRole('cell')[0].className,
    ).toContain('MuiTableCell-sizeSmall')
    // The caller's `sx` lands on the box beside the box's own rules, never
    // instead of them: a bounded box that stopped scrolling would be the
    // defect again.
    expect(getComputedStyle(box).maxHeight).toBe('320px')
    expect(getComputedStyle(box).overflowX).toBe('auto')
  })

  it('points its ref at the box, the element that holds the table’s place', () => {
    const ref = createRef<HTMLDivElement>()
    const { container } = render(<Jobs ref={ref} />)
    expect(ref.current).toBe(container.firstElementChild)
  })

  it('draws a table nested in another one’s cell inside the outer box, with none of its own', () => {
    const { container } = render(
      <ScrollTable size="small" aria-label="Screens">
        <TableBody>
          <TableRow>
            <TableCell>{'Home'}</TableCell>
          </TableRow>
          <TableRow>
            <TableCell padding="none">
              <ScrollTable nested size="small" aria-label="Under Home">
                <TableBody>
                  <TableRow>
                    <TableCell>{'About'}</TableCell>
                  </TableRow>
                </TableBody>
              </ScrollTable>
            </TableCell>
          </TableRow>
        </TableBody>
      </ScrollTable>,
    )
    const box = container.firstElementChild as HTMLElement
    const outer = screen.getByRole('table', { name: 'Screens' })
    const inner = screen.getByRole('table', { name: 'Under Home' })
    // Positive control: the outer table has its box.
    expect(outer.parentElement).toBe(box)
    expect(getComputedStyle(box).overflowX).toBe('auto')
    // The nested table sits straight in its cell, so the one box scrolls both.
    expect(inner.parentElement?.tagName).toBe('TD')
    expect(inner.className).toContain('MuiTable-root')
    expect(
      [...box.querySelectorAll('*')].filter(
        (element) => getComputedStyle(element).overflowX === 'auto',
      ),
    ).toHaveLength(0)
  })
})

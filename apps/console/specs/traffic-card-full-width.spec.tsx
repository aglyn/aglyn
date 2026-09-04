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
 * The Traffic card takes the dashboard row, and reads across it.
 *
 * At `md: 6` it had half a page for six figures, a bar per day of the
 * selected range, and four ranked breakdowns: the figures wrapped into a
 * ragged block, ninety bars shared one column's width, and the breakdowns
 * became a scroll with `Top pages` at the bottom — furthest from the tile
 * naming the top page.
 *
 * jsdom performs no layout, so this asserts the CSS the card EMITS rather
 * than the geometry, the same way `card-columns` does: the mechanism is the
 * part a later change can undo.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import type { ReactNode } from 'react'

const REPO = `${__dirname}/../../..`
const read = (path: string) => readFileSync(`${REPO}/${path}`, 'utf8')

const DASHBOARD = 'apps/console/app/(app)/[orgSlug]/hosts/[host]/page.tsx'
const CARD = 'apps/console/components/analytics/host-analytics-card.component.tsx'

interface SeededDay {
  day: string
  total: number
  visitors: number
  paths: Record<string, number>
  referrers: Record<string, number>
  devices: Record<string, number>
  utm: Record<string, Record<string, number>>
}

/** One day of counters, with everything the card can break down. */
const day = (id: string, total: number): SeededDay => ({
  day: id,
  total,
  visitors: Math.round(total / 2),
  paths: { '/pricing': total, '/': Math.round(total / 2) },
  referrers: { 'news.example': total },
  devices: { mobile: total, desktop: Math.round(total / 2) },
  utm: {
    source: { newsletter: total },
    campaign: { 'launch-week': total },
  },
})

let mockDays: SeededDay[] = []

jest.mock('../utils/analytics-day-cache', () => ({
  __esModule: true,
  recentDayIds: (_now: number, count: number) =>
    Array.from({ length: count }, (_unused, index) => `d${index}`),
  readAnalyticsDays: async () => mockDays,
}))

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: () => ({}),
  getDoc: async () => ({ get: () => undefined }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({}),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  AppLink: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

import HostAnalyticsCard from '../components/analytics/host-analytics-card.component'

/** Every rule emotion emitted for the rendered tree, as text. */
const stylesheet = () =>
  Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((rule) => rule.cssText)
      } catch {
        return []
      }
    })
    .join('\n')

const rulesFor = (element: HTMLElement) => {
  const generated = element.className
    .split(' ')
    .find((name) => name.startsWith('css-'))
  // Guard the guard: with no generated class every assertion below would be
  // reading the whole document's CSS, or nothing at all.
  expect(generated).toBeTruthy()
  return stylesheet()
    .split('\n')
    .filter((line) => line.includes(generated as string))
}

/** The element that holds all of the given headings. */
const containerOf = (...titles: string[]) => {
  const [first, ...rest] = titles.map((title) => screen.getByText(title))
  let node = first.parentElement
  while (node && !rest.every((other) => node?.contains(other))) {
    node = node.parentElement
  }
  expect(node).toBeTruthy()
  return node as HTMLElement
}

beforeEach(() => {
  mockDays = Array.from({ length: 28 }, (_unused, index) =>
    day(`d${index}`, 100 + index),
  )
})

describe('the Traffic card reads across the full width', () => {
  it('lays its figures out in grid tracks, not a wrapping row', async () => {
    render(<HostAnalyticsCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Page views')).toBeTruthy())
    const tiles = containerOf('Page views', 'Avg / day')
    const rules = rulesFor(tiles).join('\n')
    // A wrap leaves the tiles wherever their own text lengths put them, so
    // nothing lines up and the last row ends ragged. Tracks are the same
    // width whatever is in them.
    expect(rules).toContain('display: grid')
    expect(rules).not.toContain('flex-wrap: wrap')
    // Two across on a phone, six across where the card has the room.
    expect(rules).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(rules).toContain('grid-template-columns: repeat(6, minmax(0, 1fr))')
  })

  it('puts the four breakdowns side by side instead of stacking them', async () => {
    render(<HostAnalyticsCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Top pages')).toBeTruthy())
    const lists = containerOf(
      'Top pages',
      'Top referrers',
      'Top campaign sources (UTM)',
      'Top campaigns (UTM)',
    )
    const rules = rulesFor(lists).join('\n')
    expect(rules).toContain('display: grid')
    expect(rules).toContain('grid-template-columns: repeat(2, minmax(0, 1fr))')
    // `start`, not the grid default: a short breakdown beside a long one
    // must not be stretched to its neighbour's height.
    expect(rules).toContain('align-items: start')
  })

  it('leads with Top pages, beside the tile that names the top page', async () => {
    render(<HostAnalyticsCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Top pages')).toBeTruthy())
    const order = ['Top pages', 'Top referrers', 'Top campaign sources (UTM)']
      .map((title) => screen.getByText(title))
      .map((node) => node.compareDocumentPosition(screen.getByText('Top pages')))
    // Every later heading follows `Top pages` in document order. It used to
    // be last, under three other lists and a caption.
    expect(order.slice(1)).toEqual([
      Node.DOCUMENT_POSITION_PRECEDING,
      Node.DOCUMENT_POSITION_PRECEDING,
    ])
  })

  it('draws no heading for a breakdown that has no rows', async () => {
    // An empty `Top campaigns (UTM)` heading reads as a list that failed to
    // load rather than as a site that has run no campaigns.
    mockDays = Array.from({ length: 28 }, (_unused, index) => ({
      ...day(`d${index}`, 100 + index),
      utm: {},
    }))
    render(<HostAnalyticsCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Top pages')).toBeTruthy())
    expect(screen.queryByText('Top campaigns (UTM)')).toBeNull()
    expect(screen.queryByText('Top campaign sources (UTM)')).toBeNull()
  })

  it('THE CONTROL: the stylesheet reader finds the card’s own rules', async () => {
    // A reader that returned nothing would let every `toContain` above pass
    // by asserting over an empty string.
    render(<HostAnalyticsCard hostId="host-1" />)
    await waitFor(() => expect(screen.getByText('Page views')).toBeTruthy())
    expect(rulesFor(containerOf('Page views', 'Avg / day')).length).toBeGreaterThan(
      0,
    )
    expect(stylesheet()).toContain('display: grid')
  })
})

describe('the dashboard gives Traffic the row', () => {
  /**
   * A card the page gives a WIDTH to, in either grammar the console uses: a
   * `GridItems` item that declares `md: 6`, or a grid track that halves the
   * row. Traffic is neither — it is a direct child of the page's stack, so
   * the container's width is its width.
   */
  const HALF_WIDTH = /md:\s*6|md:\s*'repeat\(2/

  it('places the card at full width', () => {
    const source = read(DASHBOARD)
    expect(source).toContain('<HostAnalyticsCard')
    // Not inside the capability grid, and not in a half-width grid item:
    // both of those are how a card ends up with half the row.
    const beforeCard = source.slice(0, source.indexOf('<HostAnalyticsCard'))
    expect(beforeCard).not.toMatch(HALF_WIDTH)
    expect(source).not.toContain('GridItems')
  })

  it('THE CONTROL: the width pattern catches what it is meant to catch', () => {
    // A pattern that matched nothing would pass on the page that put the
    // card back beside another one.
    expect('size: { xs: 12, md: 6 }').toMatch(HALF_WIDTH)
    expect(
      "gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }",
    ).toMatch(HALF_WIDTH)
    expect('size: { xs: 12 }').not.toMatch(HALF_WIDTH)
  })

  it('hand-writes no type weight — the theme owns those', () => {
    // The growth badge carried `fontWeight: 600`. A hand-written weight is a
    // missing token, and the token is `bold`.
    expect(read(CARD)).not.toMatch(/fontWeight:\s*\d/)
  })
})

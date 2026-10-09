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
 * A site's activity log is a record list in the shared grid (AGL-3045).
 *
 * The grid scrolls its own columns inside the card, which a bare table in a
 * card cannot. What the grid has to keep from the table it replaced: a
 * target is a link into the console, the actor is the address the entry
 * recorded, and the pager under the grid still turns a cursor feed — the
 * grid holds one page, so its Filters panel and its search box reach the
 * feed's query (AGL-3317, AGL-3321) rather than narrowing that page and
 * calling it the whole log.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  __esModule: true,
  CardDisplay: ({ header, children }: { header: string; children?: ReactNode }) => (
    <section aria-label={header}>{children}</section>
  ),
  AppLink: ({ href, children }: { href: string; children?: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}))

jest.mock('../constants/docs-links', () => ({
  __esModule: true,
  docsHelp: () => undefined,
}))

/** Held, so the route params keep one identity across renders. */
const mockParams = { orgSlug: 'acme', host: 'wag' }
jest.mock('next/navigation', () => ({
  __esModule: true,
  useParams: () => mockParams,
  usePathname: () => '/acme/hosts/wag/setup',
}))

/** Held: a Firestore handle minted per render would re-run every read. */
const mockFirestore = {}
// The resolver has its own spec; here it passes rows through untouched.
jest.mock('@aglyn/tenant-feature-instance/hooks/use-resolved-activity-actors', () => ({
  __esModule: true,
  useResolvedActivityActors: (_hostId: unknown, rows: unknown) => rows,
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => mockFirestore,
}))

/** The rows the log holds, newest first, and the document each read resumed after. */
let mockEntries: Array<Record<string, unknown>> = []
const mockCursors: unknown[] = []
/** The `where` clauses each read carried, and its order. */
const mockWheres: unknown[][] = []
const mockOrders: unknown[][] = []
jest.mock('firebase/firestore', () => ({
  __esModule: true,
  collection: (...path: unknown[]) => ({ path }),
  orderBy: (field: string, direction: string) => ({ kind: 'orderBy', field, direction }),
  limit: (count: number) => ({ kind: 'limit', count }),
  startAfter: (cursor: unknown) => ({ kind: 'startAfter', cursor }),
  // What the served-filter translator builds on; unused unless a clause is set.
  where: (field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value }),
  documentId: () => '__name__',
  startAt: (value: unknown) => ({ kind: 'startAt', value }),
  endAt: (value: unknown) => ({ kind: 'endAt', value }),
  Timestamp: { fromDate: (date: Date) => ({ toDate: () => date }) },
  query: (_ref: unknown, ...constraints: Array<Record<string, unknown>>) => constraints,
  getDocs: async (constraints: Array<Record<string, unknown>>) => {
    const after = (constraints.find((entry) => entry.kind === 'startAfter')?.cursor ?? null) as {
      id: string
    } | null
    mockCursors.push(after?.id)
    mockWheres.push(constraints.filter((entry) => entry.kind === 'where'))
    mockOrders.push(constraints.filter((entry) => entry.kind === 'orderBy'))
    const count = Number(constraints.find((entry) => entry.kind === 'limit')?.count)
    const start = after ? mockEntries.findIndex((entry) => entry['$id'] === after.id) + 1 : 0
    return {
      docs: mockEntries.slice(start, start + count).map((entry) => {
        const { $id, ...data } = entry
        return { id: $id, data: () => data }
      }),
    }
  },
}))

import { HostActivityTable } from '../components/host-activity-table.component'
import { registerPluginDeclarations } from '../constants/plugins.declarations.generated'

// The AI codes' labels are the AI plugin's declaration, loaded the way the
// console shell loads it.
beforeAll(() => registerPluginDeclarations())

const at = (iso: string) => ({ toDate: () => new Date(iso) })

const entry = (index: number): Record<string, unknown> => ({
  $id: `entry-${index}`,
  action: `Saved the screen ${index}`,
  target: { type: 'component', id: `component-${index}`, name: `Hero ${index}` },
  actorEmail: `editor${index}@example.com`,
  createdAt: at(`2026-09-${String(16 - (index % 15)).padStart(2, '0')}T12:00:00Z`),
})

beforeEach(() => {
  mockCursors.length = 0
  mockWheres.length = 0
  mockOrders.length = 0
  mockEntries = Array.from({ length: 12 }, (_, index) => entry(index + 1))
})

describe('HostActivityTable (AGL-3045)', () => {
  it('lists the log in the shared grid, not a bare table', async () => {
    const { container } = render(<HostActivityTable hostId="host-1" />)
    await screen.findByText('Saved the screen 1')
    const grid = screen.getByRole('grid')
    expect(container.querySelectorAll('table')).toHaveLength(0)
    const headers = within(grid)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
    expect(headers).toEqual(expect.arrayContaining(['Action', 'Target', 'Who (then)', 'When']))
    const row = within(grid).getByText('Saved the screen 1').closest('[role="row"]') as HTMLElement
    expect(within(row).getByText('Hero 1').closest('a')?.getAttribute('href')).toBe(
      '/acme/hosts/wag/components/component-1',
    )
    expect(within(row).getByText('editor1@example.com')).toBeTruthy()
  })

  it('filters through the grid’s own panel, and searches the whole log on its query (AGL-3321)', async () => {
    render(<HostActivityTable hostId="host-1" />)
    await screen.findByText('Saved the screen 1')
    expect(screen.getByRole('button', { name: 'Columns' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Filters/ })).toBeTruthy()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Editor7' } })
    await waitFor(() =>
      expect(mockWheres.at(-1)).toEqual([
        { kind: 'where', field: 'searchTokens', op: 'array-contains', value: 'editor7' },
      ]),
    )
    // The feed's one order stays; a new query starts again at the top.
    expect(mockOrders.at(-1)).toEqual([{ kind: 'orderBy', field: 'createdAt', direction: 'desc' }])
    expect(mockCursors.at(-1)).toBeUndefined()
  })

  it('puts an action filter onto the feed’s query, not onto the page on screen (AGL-3317)', async () => {
    render(<HostActivityTable hostId="host-1" />)
    await screen.findByText('Saved the screen 1')
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }))
    const value = await screen.findByRole('textbox', { name: 'Value' })
    fireEvent.change(value, { target: { value: 'Saved the screen 7' } })
    await waitFor(() =>
      expect(mockWheres.at(-1)).toEqual([
        { kind: 'where', field: 'action', op: '==', value: 'Saved the screen 7' },
      ]),
    )
  })

  it('turns the cursor feed with the pager under the grid', async () => {
    render(<HostActivityTable hostId="host-1" />)
    await screen.findByText('Saved the screen 1')
    fireEvent.click(screen.getByLabelText('Go to next page'))
    await waitFor(() => expect(screen.getByText('Saved the screen 11')).toBeTruthy())
    expect(screen.queryByText('Saved the screen 1')).toBeNull()
    // The second read resumed after the last row of the first page.
    expect(mockCursors).toEqual([undefined, 'entry-10'])
  })
})

describe('HostActivityTable reads a plugin’s code as its label (AGL-3065)', () => {
  it('draws the label a coded entry’s plugin declared, and a prose entry as written', async () => {
    mockEntries = [
      { ...entry(1), action: 'ai.job.output' },
      { ...entry(2), action: 'Saved the screen' },
    ]
    const { container } = render(<HostActivityTable hostId="host-1" />)
    const grid = await screen.findByRole('grid')
    expect(await within(grid).findByText('Created component Hero 1 with Aglyn AI')).toBeTruthy()
    expect(within(grid).getByText('Saved the screen')).toBeTruthy()
    expect(container.textContent).not.toContain('ai.job.output')
  })
})

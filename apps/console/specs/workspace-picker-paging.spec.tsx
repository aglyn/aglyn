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
 * The workspace pickers page on the console's footer (AGL-2501).
 *
 * Both of them — the console root and the billing entry page — rendered every
 * loaded membership in one wall and ended in "Load more workspaces". That
 * button only ever grew: a reader who opened a hundred workspaces could not
 * get back to the first five without remounting the page, it could not say
 * where in the list they were, and it was the console's last bespoke pager
 * outside the two documented grids.
 *
 * The window it grows is NOT this control's to re-key — `useOrgScope` holds
 * one live listen over `users/{uid}/orgs` and it is what resolves which
 * workspace the console is in. So the picker slices, and reaching the end of
 * what is loaded grows the listen. Both halves are asserted below: without
 * the slice there is no paging, and without the growth page eleven is a wall
 * for an agency at its fiftieth client (AGL-2336).
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useState } from 'react'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  useWorkspacePage,
  WORKSPACE_PAGE_SIZE,
} from '../hooks/use-workspace-page'

const REPO = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO, path), 'utf8')

/** How many memberships one listen holds before it has to be grown. */
const WINDOW = 12

const workspace = (index: number) => ({
  $id: `org-${String(index).padStart(3, '0')}`,
  orgName: `Workspace ${String(index).padStart(3, '0')}`,
})

/**
 * A picker, reduced to what is being asserted: the hook, the rows it exposes,
 * and the real shared footer. The `grow` callback stands in for
 * `loadMoreOrgs`, and `loaded` for the window it widens.
 */
function Picker(props: {
  total: number
  initialWindow: number
  onGrow?: () => void
}) {
  const { total, initialWindow, onGrow } = props
  const [loaded, setLoaded] = useState(initialWindow)
  const rows = Array.from({ length: Math.min(loaded, total) }, (_x, index) =>
    workspace(index),
  )
  const { visible, page, setPage, pageSize, hasMore } = useWorkspacePage(rows, {
    hasMoreRows: loaded < total,
    loadMoreRows: () => {
      onGrow?.()
      setLoaded((size) => size + WINDOW)
    },
  })
  return (
    <div>
      <ul>
        {visible.map((row) => (
          <li key={row.$id}>{row.orgName}</li>
        ))}
      </ul>
      <ListPagination
        page={page}
        pageSize={pageSize}
        rowCount={visible.length}
        hasMore={hasMore}
        onPageChange={setPage}
      />
    </div>
  )
}

const visibleNames = () =>
  Array.from(document.querySelectorAll('li')).map(
    (node) => node.textContent ?? '',
  )

const nextButton = () =>
  screen.getByRole('button', { name: /go to next page/i }) as HTMLButtonElement

const nextPage = () => fireEvent.click(nextButton())

const previousPage = () =>
  fireEvent.click(screen.getByRole('button', { name: /go to previous page/i }))

describe('the workspace picker pages instead of growing (AGL-2501)', () => {
  it('renders one page of five, not every workspace it has loaded', () => {
    render(<Picker total={WINDOW} initialWindow={WINDOW} />)
    expect(WORKSPACE_PAGE_SIZE).toBe(5)
    expect(visibleNames()).toEqual([
      'Workspace 000',
      'Workspace 001',
      'Workspace 002',
      'Workspace 003',
      'Workspace 004',
    ])
  })

  it('goes BACK, which the button it replaces could not', () => {
    // The whole defect in one assertion: "Load more" appended, so the only
    // way back to the first workspaces was to reload the page.
    render(<Picker total={WINDOW} initialWindow={WINDOW} />)
    nextPage()
    expect(visibleNames()).toEqual([
      'Workspace 005',
      'Workspace 006',
      'Workspace 007',
      'Workspace 008',
      'Workspace 009',
    ])
    previousPage()
    expect(visibleNames()[0]).toBe('Workspace 000')
  })

  it('says how much of the list is on screen, and stops guessing at the end', () => {
    render(<Picker total={WINDOW} initialWindow={WINDOW} />)
    // A membership listen cannot state a total without reading it, so MUI is
    // handed `-1` while a further page exists — and the REAL total on the
    // last page, which is what disables Next.
    expect(screen.getByText(/1–5 of more than 5/)).toBeTruthy()
    nextPage()
    nextPage()
    expect(visibleNames()).toEqual(['Workspace 010', 'Workspace 011'])
    expect(screen.getByText('11–12 of 12')).toBeTruthy()
    expect(nextButton().disabled).toBe(true)
  })

  it('grows the membership window when the reader walks to its end', () => {
    // AGL-2336 in its new clothes: the window is a page of the listen, and an
    // agency past it must not meet a wall dressed as the end of the list.
    const grow = jest.fn()
    render(<Picker total={WINDOW * 3} initialWindow={WINDOW} onGrow={grow} />)
    // Pages one and two sit inside the window: nothing to grow yet.
    expect(grow).not.toHaveBeenCalled()
    nextPage()
    expect(grow).not.toHaveBeenCalled()
    // Page three is the last one the window can serve, so the listen widens
    // and the rows behind it arrive without the reader asking twice.
    nextPage()
    expect(grow).toHaveBeenCalled()
    nextPage()
    expect(visibleNames()).toEqual([
      'Workspace 015',
      'Workspace 016',
      'Workspace 017',
      'Workspace 018',
      'Workspace 019',
    ])
  })

  it('offers no size menu — the page size belongs to the card grid', () => {
    render(<Picker total={WINDOW} initialWindow={WINDOW} />)
    expect(screen.queryByText(/rows per page/i)).toBeNull()
  })

  it('THE CONTROL: the harness pages the rows the hook returns', () => {
    // Guard the guard. A harness that rendered its own array would page a
    // list the hook never sliced, and every assertion above would hold with
    // the hook deleted.
    render(<Picker total={3} initialWindow={WINDOW} />)
    expect(visibleNames()).toHaveLength(3)
    expect(nextButton().disabled).toBe(true)
  })
})

describe('both pickers render the page, not the window (AGL-2501)', () => {
  // The footer is asserted by `table-footer-consistency`; what it cannot see
  // is a page that added the footer and kept mapping the whole list — which
  // renders every workspace above a control claiming to show five.
  it.each([
    ['the console root', 'apps/console/app/(app)/(home)/page.tsx', 'visibleOrgs'],
    [
      'the billing entry page',
      'apps/console/app/(app)/billing/page.tsx',
      'visibleChoices',
    ],
  ])('%s maps the paged rows', (_label, path, rows) => {
    const source = read(path)
    expect(source).toContain(`items={${rows}.map(`)
    expect(source).toContain('useWorkspacePage(')
  })

  it.each([
    ['the console root', 'apps/console/app/(app)/(home)/page.tsx'],
    ['the billing entry page', 'apps/console/app/(app)/billing/page.tsx'],
  ])('%s keeps no button of its own', (_label, path) => {
    expect(read(path)).not.toContain('Load more workspaces')
  })
})

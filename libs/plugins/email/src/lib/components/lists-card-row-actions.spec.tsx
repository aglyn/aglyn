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
 * A LIST ROW IS A RESOURCE, on the same terms a screen row is.
 *
 * Three properties, none of which is visible in a screenshot:
 *
 * 1. The row OPENS the list, and the list's name is a real `<a href>` as well.
 *    A click handler that calls `router.push` looks and behaves identically to
 *    a left click and offers nothing to a middle click, a ⌘-click, "Open link
 *    in new tab", or "Copy link address".
 * 2. The secondary actions live in the shared overflow menu rather than as
 *    text buttons in the row — the same component the screens table uses, so
 *    the two surfaces cannot come to disagree about what a row's actions look
 *    like. Delete in particular is IN the menu: a destructive action beside a
 *    row you can click is a destructive action next to the click that opens
 *    it.
 * 3. Clicking the menu does not open the list. The menu button sits inside a
 *    clickable row, so without the propagation guards the row would navigate
 *    out from under the menu it just opened.
 *
 * The overflow menu is imported from its own module path and is therefore the
 * REAL shared component here, with the real `AppLink` inside it. Stubbing it
 * would leave the link assertions testing the stub.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { OrgListsCard } from './lists-card'

const BASE_PATH = '/acme/hosts/site/emails'

const listDocs = [
  { $id: 'list-manual', name: 'Newsletter', kind: 'manual' },
  { $id: 'list-rule', name: 'VIPs', kind: 'dynamic' },
]

const mockPush = jest.fn()
const mockConfirm = jest.fn(() => Promise.resolve())

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: () => undefined }),
  usePathname: () => `${BASE_PATH}/audiences`,
}))

/*
 * Every mocked hook answers the SAME object every call.
 *
 * A fresh identity per render is not a harmless detail: the card puts
 * `firestore` and `scope` in the dependency list of the effect that takes the
 * subscriber aggregates, so a new one each render re-runs the effect, which
 * sets state, which re-renders. The suite does not fail — it hangs.
 */
const FIRESTORE = {}
const SCOPE = { scope: ['orgs', 'org-1'] }
const USER = { data: { uid: 'uid-test' } }
const NO_SEGMENTS = { data: [] }
const PAGE = {
  rows: listDocs,
  hasMore: false,
  page: 0,
  setPage: () => undefined,
  pageSize: 10,
  setPageSize: () => undefined,
  status: 'success',
  fromCache: false,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => SCOPE,
  useUser: () => USER,
  useFirestoreCollection: () => NO_SEGMENTS,
  usePagedCollection: () => PAGE,
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  query: (base: any) => base,
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: string) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  getCountFromServer: async () => ({ data: () => ({ count: 3 }) }),
  setDoc: jest.fn().mockResolvedValue(undefined),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  deleteDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return {
    ...actual,
    createResourceUid: () => 'uid-new',
    pluginDocsHelp: () => undefined,
  }
})
jest.mock('@aglyn/shared-util-timestamp', () => ({
  Timestamp: { now: () => ({ seconds: 0 }) },
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
/*
 * The barrel, stubbed for the CARD's own use — plus the two primitives the
 * shared create drawer reaches for through it. The drawer itself is imported
 * from its own module path and is therefore real, which is the point: what is
 * under test is that this surface opens THE shared drawer rather than one of
 * its own.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({
    children,
    HeaderProps,
  }: {
    children: ReactNode
    HeaderProps?: { action?: ReactNode }
  }) => (
    <div>
      {HeaderProps?.action}
      {children}
    </div>
  ),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  AppLink: ({ href, children, onClick }: any) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
  MdiIcon: () => null,
  Container: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SrOnly: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}))

const mountCard = async () => {
  mockPush.mockClear()
  mockConfirm.mockClear()
  render(<OrgListsCard hostId="host-1" basePath={BASE_PATH} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const rowFor = (name: string) =>
  Array.from(document.querySelectorAll('tbody tr')).find((row) =>
    row.textContent?.includes(name),
  ) as HTMLElement

const openMenuFor = (name: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: `More actions for ${name}` }),
  )

describe('a list row opens the list', () => {
  it('clicking the row navigates to that list’s own route', async () => {
    await mountCard()
    fireEvent.click(rowFor('Newsletter'))
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/audiences/list-manual`)
  })

  it('the row navigates to ITS OWN id, not the first one', async () => {
    // THE CONTROL for the assertion above: a handler closed over the wrong
    // row would send every row to the same place, and a fixture of one list
    // cannot tell the difference.
    await mountCard()
    fireEvent.click(rowFor('VIPs'))
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/audiences/list-rule`)
  })

  it('the list name is a real link, and does not double-push', async () => {
    await mountCard()
    const link = rowFor('Newsletter').querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      `${BASE_PATH}/audiences/list-manual`,
    )
    // The row's own handler would fire too and push the same route twice —
    // one history entry per back press.
    fireEvent.click(link)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('the row’s actions are in the shared overflow menu', () => {
  it('offers exactly Open details, Edit list and Delete', async () => {
    await mountCard()
    openMenuFor('Newsletter')
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Open details', 'Edit list', 'Delete'])
  })

  it('the two navigating items are anchors carrying real hrefs', async () => {
    await mountCard()
    openMenuFor('VIPs')
    const details = screen.getByRole('menuitem', { name: 'Open details' })
    const edit = screen.getByRole('menuitem', { name: 'Edit list' })
    expect(details.tagName).toBe('A')
    expect(details.getAttribute('href')).toBe(
      `${BASE_PATH}/audiences/list-rule`,
    )
    expect(edit.tagName).toBe('A')
    expect(edit.getAttribute('href')).toBe(
      `${BASE_PATH}/audiences/list-rule/edit`,
    )
  })

  it('Delete is in the MENU and nowhere in the row', async () => {
    await mountCard()
    // The affordance it replaced: a bare `Delete` text button sitting in the
    // row, one mis-click from the click that opens the list.
    expect(rowFor('Newsletter').textContent).not.toContain('Delete')
    openMenuFor('Newsletter')
    const remove = screen.getByRole('menuitem', { name: 'Delete' })
    // A handler, not a link — it opens a confirmation rather than navigating.
    expect(remove.tagName).not.toBe('A')
    fireEvent.click(remove)
    expect(mockConfirm).toHaveBeenCalled()
  })

  it('opening the menu does not open the list', async () => {
    await mountCard()
    openMenuFor('Newsletter')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('and neither does clicking the actions column beside it', async () => {
    /*
     * The menu BUTTON guards itself, so the assertion above passes with or
     * without the cell's own guard — and the cell is bigger than the button.
     * A click on the padding around it is a click inside a row whose handler
     * opens the list, which is a list opening from a press aimed at a menu.
     */
    await mountCard()
    const actions = rowFor('Newsletter').querySelectorAll('td')
    fireEvent.click(actions[actions.length - 1])
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('there is no inline MEMBERS expander left in the row', async () => {
    // The affordance the detail route replaced. A row that still expanded in
    // place would open a membership listener on the table of tables.
    await mountCard()
    expect(screen.queryByText('Members')).toBeNull()
    expect(screen.queryByText('Close')).toBeNull()
  })
})

/**
 * CREATING IS A DRAWER, and the drawer is the shared one.
 *
 * A create form stacked above a list has nowhere to grow, which is how the
 * rule behind an audience came to be authored through four controls out of
 * nine: the form could not hold the rest. Naming happens in the drawer; what
 * the audience IS happens on its edit page, which has the room.
 */
describe('creating an audience', () => {
  it('shows no create FORM above the table', async () => {
    await mountCard()
    expect(screen.queryByLabelText('New list name')).toBeNull()
    // And the membership choice is not asked before the rule that it decides
    // the fate of can be seen.
    expect(screen.queryByLabelText('Membership')).toBeNull()
  })

  it('opens a drawer instead, and nothing is written until it is', async () => {
    const { setDoc } = require('firebase/firestore')
    setDoc.mockClear()
    await mountCard()
    expect(screen.queryByText('Create new audience')).toBeNull()
    fireEvent.click(screen.getByText('Create audience'))
    await waitFor(() =>
      expect(screen.getByText('Create new audience')).toBeTruthy(),
    )
    expect(setDoc).not.toHaveBeenCalled()
  })

  it('the drawer asks for a name and nothing the document cannot store', async () => {
    // A list document holds a name. A description box whose contents the write
    // discards is worse than a box that was never offered.
    await mountCard()
    fireEvent.click(screen.getByText('Create audience'))
    await waitFor(() => expect(screen.getByLabelText(/Display name/)).toBeTruthy())
    expect(screen.queryByLabelText(/Description/)).toBeNull()
  })
})

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
 * THE TEMPLATES LIST IS A TABLE, on the surface's own row grammar.
 *
 * It was a stack of `Stack`s: a link, a chip, an `Edit` button and a red
 * `Delete` button on each line, with no footer under any of it and an
 * unordered `limit(200)` behind it. Four things this file holds:
 *
 * 1. The row OPENS the template and the name is a real `<a href>` as well.
 * 2. Edit and Delete are in the shared overflow menu. Delete in particular:
 *    it sat inline, one mis-click from the name beside it.
 * 3. The list IS its query (AGL-3321): `kind == 'email'`, by `nameLower`,
 *    paged by the query, with every Filters clause and search word a
 *    predicate on it — so a match past the first page is found, and a
 *    deleted template (whose name keys the delete clears) is left out by the
 *    order rather than dropped in the browser.
 * 4. The list has the console's one footer under it, which is what took this
 *    file off `OWES_A_FOOTER`.
 *
 * The overflow menu comes in by its own module path, so the anchor assertions
 * read the real shared component rather than a stub.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { displayNameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import { EmailScreensCard } from './email-screens-card'

const BASE_PATH = '/acme/hosts/site/emails'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: () => undefined }),
  usePathname: () => `${BASE_PATH}/templates`,
}))

const FIRESTORE = {}
/** The site's screens, as the query double answers its plan over them. */
let screenDocs: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  // Duplicate (AGL-2936) is a door of its own; these specs exercise the
  // rest of the card, so the flow is a stub and its dialog is not mounted.
  DUPLICATE_MENU_LABEL: 'Duplicate…',
  useDuplicateResource: () => ({ request: jest.fn(), dialog: null }),
  useFirestore: () => FIRESTORE,
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useHostResourceApi: () => jest.fn(),
  useHostVersionApi: () => jest.fn(),
}))

/*
 * The card's REAL plan, answered the way Firestore would answer it: every
 * predicate applied, `orderBy` sorting AND dropping a row without the field,
 * and the answer paged (AGL-3321).
 */
jest.mock('@aglyn/tenant-feature-instance/hooks/use-list-query', () =>
  jest
    .requireActual('@aglyn/tenant-feature-instance/testing/list-query-double')
    .listQueryModule(
      () => screenDocs,
      jest.requireActual('@aglyn/tenant-feature-instance/hooks/use-list-query'),
    ),
)
const lastPlan = () =>
  jest.requireActual('@aglyn/tenant-feature-instance/testing/list-query-double').lastListQueryPlan()

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  Timestamp: { now: () => ({ seconds: 0 }) },
  deleteField: () => '__deleteField',
  updateDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/** Resolves, or REJECTS — `confirm` rejects on cancel (AGL-950). */
let confirmAccepts = true
const mockConfirm = jest.fn(() =>
  confirmAccepts ? Promise.resolve(undefined) : Promise.reject(new Error('no')),
)

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  useConfirmationContext: () => ({ confirm: mockConfirm }),
  AppLink: ({ href, children, onClick }: any) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
  MdiIcon: () => null,
}))

/** A screen as its writers store it: the name keys beside `displayName`. */
const stamped = (screen: Record<string, unknown>) => ({
  ...screen,
  ...displayNameSearchFields(screen['displayName']),
})

const mountCard = async () => {
  render(<EmailScreensCard hostId="host-1" basePath={BASE_PATH} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const rowFor = (name: string) =>
  Array.from(document.querySelectorAll('[role="row"][data-id]')).find((row) =>
    row.textContent?.includes(name),
  ) as HTMLElement

const openMenuFor = (name: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: `More actions for ${name}` }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockPush.mockClear()
  mockConfirm.mockClear()
  confirmAccepts = true
  screenDocs = [
    stamped({
      $id: 'scr-welcome',
      kind: 'email',
      displayName: 'Welcome',
      versionId: 'ver-1',
    }),
    stamped({
      $id: 'scr-promo',
      kind: 'email',
      displayName: 'Promo',
      versionId: 'ver-2',
    }),
    // Not a template: the site's ordinary screens share this collection.
    stamped({ $id: 'scr-home', kind: 'page', displayName: 'Home', versionId: 'ver-3' }),
    // Deleted: the delete cleared its name keys, and it stays in the
    // collection for the reports sent from it.
    {
      $id: 'scr-old',
      kind: 'email',
      displayName: 'Retired promo',
      versionId: 'ver-4',
      deletedAt: { seconds: 1 },
    },
  ]
})

describe('the templates list draws the site’s email templates', () => {
  it('lists the email screens and nothing else in the collection', async () => {
    await mountCard()
    const names = Array.from(document.querySelectorAll('[role="row"][data-id]')).map((row) =>
      row.querySelector('[data-field="displayName"]')?.textContent?.trim(),
    )
    expect(names).toEqual(['Promo', 'Welcome'])
    // THE CONTROL for the filter: a card that drew every screen would list
    // these two as well.
    expect(names).not.toContain('Home')
    expect(names).not.toContain('Retired promo')
  })

  it('asks its query for the email scope, by name', async () => {
    await mountCard()
    expect(lastPlan()?.filters).toEqual([{ path: 'kind', op: '==', value: 'email' }])
    expect(lastPlan()?.orderBy).toMatchObject({ path: 'nameLower', direction: 'asc' })
  })

  it('finds a template past the first page, because the search is on the query', async () => {
    screenDocs = [
      ...Array.from({ length: 12 }, (_, index) =>
        stamped({
          $id: `scr-${String(index).padStart(2, '0')}`,
          kind: 'email',
          displayName: `Alpha ${String(index).padStart(2, '0')}`,
          versionId: 'ver-1',
        }),
      ),
      stamped({ $id: 'scr-zulu', kind: 'email', displayName: 'Zulu digest', versionId: 'ver-1' }),
    ]
    await mountCard()
    // THE CONTROL: the unfiltered first page does not hold it.
    expect(rowFor('Zulu digest')).toBeUndefined()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'digest' } })
    await waitFor(() => expect(rowFor('Zulu digest')).toBeTruthy())
    expect(lastPlan()?.filters).toEqual([
      { path: 'kind', op: '==', value: 'email' },
      { path: 'nameTokens', op: 'array-contains', value: 'digest' },
    ])
  })

  it('pages its query on the console’s one footer', async () => {
    // The property that took this file off `OWES_A_FOOTER`: a table with rows
    // under it has a footer under those.
    await mountCard()
    expect(screen.getByText(/Rows per page/i)).toBeTruthy()
  })
})

describe('a template row opens the template', () => {
  it('clicking the row navigates to that template’s own page', async () => {
    await mountCard()
    fireEvent.click(rowFor('Welcome'))
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/templates/scr-welcome`)
  })

  it('the row navigates to ITS OWN id, not the first one', async () => {
    await mountCard()
    fireEvent.click(rowFor('Promo'))
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/templates/scr-promo`)
  })

  it('the name is a real link, and does not double-push', async () => {
    await mountCard()
    const link = rowFor('Welcome').querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`${BASE_PATH}/templates/scr-welcome`)
    fireEvent.click(link)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('the template row’s actions are in the shared overflow menu', () => {
  it('offers exactly Open details, Edit in besigner, Duplicate and Delete', async () => {
    await mountCard()
    openMenuFor('Welcome')
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Open details', 'Edit in besigner', 'Duplicate…', 'Delete'])
  })

  it('the besigner item points at the screen’s own version', async () => {
    // The editor's route is `/[orgSlug]/hosts/[host]/screens/[screenId]/
    // versions/[versionId]/besigner`, and a link built from a host DOC ID
    // instead of the resolved slug and subdomain lands on a 404 (AGL-685).
    await mountCard()
    openMenuFor('Promo')
    const edit = screen.getByRole('menuitem', { name: 'Edit in besigner' })
    expect(edit.tagName).toBe('A')
    expect(edit.getAttribute('href')).toBe(
      '/acme/hosts/site/screens/scr-promo/versions/ver-2/besigner',
    )
  })

  it('Delete is in the MENU and nowhere in the row', async () => {
    await mountCard()
    // The affordance it replaced: a red `Delete` text button on the end of the
    // line, beside the link that opens the template.
    expect(rowFor('Welcome').textContent).not.toContain('Delete')
    openMenuFor('Welcome')
    const remove = screen.getByRole('menuitem', { name: 'Delete' })
    // A handler, not a link — it opens a confirmation rather than navigating.
    expect(remove.tagName).not.toBe('A')
    fireEvent.click(remove)
    expect(mockConfirm).toHaveBeenCalled()
  })

  it('deletes NOTHING when the operator cancels', async () => {
    // `confirm` resolves with no value and REJECTS on cancel, so a handler
    // that gated on the resolved value alone would delete on both paths.
    const { updateDoc } = require('firebase/firestore')
    await mountCard()
    confirmAccepts = false
    openMenuFor('Welcome')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(updateDoc).not.toHaveBeenCalled()
  })

  it('soft-deletes the row the operator chose', async () => {
    const { updateDoc } = require('firebase/firestore')
    await mountCard()
    openMenuFor('Promo')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(updateDoc.mock.calls[0][0]).toEqual({
      path: 'hosts/host-1/screens/scr-promo',
    })
    // The name keys go with the delete, which is what takes the tombstone
    // off a list ordered by `nameLower` (AGL-3321).
    expect(updateDoc.mock.calls[0][1]).toEqual({
      deletedAt: { seconds: 0 },
      nameLower: '__deleteField',
      nameTokens: '__deleteField',
      nameReversed: '__deleteField',
    })
  })

  it('opening the menu does not open the template', async () => {
    await mountCard()
    openMenuFor('Welcome')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('and neither does clicking the actions column beside it', async () => {
    await mountCard()
    fireEvent.click(rowFor('Welcome').querySelector('[data-field="actions"]') as HTMLElement)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('the templates list filters through the grid toolbar (AGL-3317)', () => {
  it('searches on the query', async () => {
    await mountCard()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'promo' } })
    await waitFor(() => {
      expect(rowFor('Promo')).toBeTruthy()
      expect(rowFor('Welcome')).toBeUndefined()
    })
  })
})

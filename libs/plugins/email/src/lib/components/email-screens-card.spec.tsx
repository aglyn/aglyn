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
 * 3. The read NAMES ITS ORDER and probes one past its ceiling. `screens` holds
 *    every kind of screen and the email ones are picked out in the browser, so
 *    the cap is a ceiling rather than a page — and a ceiling with no probe is
 *    a partial site rendered as a whole one.
 * 4. The list has the console's one footer under it, which is what took this
 *    file off `OWES_A_FOOTER`.
 *
 * The overflow menu comes in by its own module path, so the anchor assertions
 * read the real shared component rather than a stub.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { EmailScreensCard } from './email-screens-card'

const BASE_PATH = '/acme/hosts/site/emails'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: () => undefined }),
  usePathname: () => `${BASE_PATH}/templates`,
}))

const FIRESTORE = {}
/** Screens the ceilinged read answers with, staged per case. */
let screenDocs: Array<Record<string, unknown>> = []
/** Every ceiling the card asked the query builder for. */
let ceilingsAsked: number[] = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useHostResourceApi: () => jest.fn(),
  useHostVersionApi: () => jest.fn(),
  // The builder is CALLED, not ignored: the ceiling this card asks for is
  // recorded by the query-builder double below, and a hook that never invoked
  // the builder would leave that assertion reading an empty array forever.
  useFirestoreCollection: (build: () => unknown) => {
    build()
    return { data: screenDocs, status: 'success', fromCache: false }
  },
}))

/*
 * The shared query builder, RECORDED rather than stubbed away.
 *
 * `collectionCeiling` is what carries the `orderBy(documentId())` for this
 * card, and `ceilingedWindow` is what turns its answer into a window plus the
 * fact that it was cut short. Recording the ceiling is how "reads one past it"
 * becomes a claim rather than a comment.
 */
jest.mock(
  '@aglyn/tenant-feature-instance/hooks/host-collection-queries',
  () => ({
    collectionCeiling: (ref: unknown, ceiling: number) => {
      ceilingsAsked.push(ceiling)
      return ref
    },
    ceilingedWindow: (rows: unknown[] | undefined, ceiling: number) => ({
      rows: (rows ?? []).slice(0, ceiling),
      truncated: (rows ?? []).length > ceiling,
    }),
  }),
)

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  Timestamp: { now: () => ({ seconds: 0 }) },
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

const mountCard = async () => {
  render(<EmailScreensCard hostId="host-1" basePath={BASE_PATH} />)
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

beforeEach(() => {
  jest.clearAllMocks()
  mockPush.mockClear()
  mockConfirm.mockClear()
  confirmAccepts = true
  ceilingsAsked = []
  screenDocs = [
    {
      $id: 'scr-welcome',
      kind: 'email',
      displayName: 'Welcome',
      versionId: 'ver-1',
    },
    {
      $id: 'scr-promo',
      kind: 'email',
      displayName: 'Promo',
      versionId: 'ver-2',
    },
    // Not a template: the site's ordinary screens share this collection.
    { $id: 'scr-home', kind: 'page', displayName: 'Home', versionId: 'ver-3' },
    // Deleted, and still in the collection until it is swept.
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
    const names = Array.from(document.querySelectorAll('tbody tr')).map((row) =>
      row.querySelector('td')?.textContent?.trim(),
    )
    expect(names).toEqual(['Promo', 'Welcome'])
    // THE CONTROL for the filter: a card that drew every screen would list
    // these two as well.
    expect(names).not.toContain('Home')
    expect(names).not.toContain('Retired promo')
  })

  it('asks the shared builder for a ceiling, which names the order', async () => {
    // `orderBy('displayName')` matches only documents that HAVE the field, so
    // a screen created without a name would vanish rather than sort oddly.
    // `collectionCeiling` orders on the document name instead.
    await mountCard()
    // The builder runs per render, so the claim is about the CEILING asked
    // for rather than about how many times the query was rebuilt.
    expect(ceilingsAsked.length).toBeGreaterThan(0)
    expect([...new Set(ceilingsAsked)]).toEqual([200])
  })

  it('says when the ceiling bit, and stays quiet when it did not', async () => {
    await mountCard()
    expect(screen.queryByText(/more than 200 screens/)).toBeNull()
  })

  it('owns up to a window that was cut short', async () => {
    screenDocs = Array.from({ length: 201 }, (_, index) => ({
      $id: `scr-${String(index).padStart(3, '0')}`,
      kind: 'email',
      displayName: `Template ${index}`,
      versionId: 'ver-1',
    }))
    await mountCard()
    expect(screen.getByText(/more than 200 screens/)).toBeTruthy()
  })

  it('pages the window it holds, on the console’s one footer', async () => {
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
  it('offers exactly Open details, Edit in besigner and Delete', async () => {
    await mountCard()
    openMenuFor('Welcome')
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Open details', 'Edit in besigner', 'Delete'])
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
  })

  it('opening the menu does not open the template', async () => {
    await mountCard()
    openMenuFor('Welcome')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('and neither does clicking the actions column beside it', async () => {
    await mountCard()
    const cells = rowFor('Welcome').querySelectorAll('td')
    fireEvent.click(cells[cells.length - 1])
    expect(mockPush).not.toHaveBeenCalled()
  })
})

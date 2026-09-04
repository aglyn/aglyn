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
 * A TOPIC ROW IS A RESOURCE, on the same terms an audience row is.
 *
 * The topics table listed rows nothing could click and put an `Edit` text
 * button on the end of each — so the one table on this surface whose rows lead
 * somewhere was the one that did not say so, and the way in was a button
 * rather than a link. Four properties, none of which is visible in a
 * screenshot:
 *
 * 1. The row OPENS the topic, and the topic's name is a real `<a href>` as
 *    well. A handler that calls `router.push` looks identical to a left click
 *    and offers nothing to a middle click, a ⌘-click, "Open link in new tab",
 *    or "Copy link address".
 * 2. The secondary actions live in the shared overflow menu — the same
 *    component the audiences and screens tables use — rather than as a text
 *    button in the row.
 * 3. Opening the menu does not open the topic. The button sits inside a
 *    clickable row, so without the propagation guards the row would navigate
 *    out from under the menu it just opened.
 * 4. RETIRE writes a complete statement of the topic. `archived` is not the
 *    only field on the write: a merge that omitted the name and description
 *    would be fine for a stored topic and would create a NAMELESS override
 *    document for one of the four built-ins, which have no document until
 *    somebody changes one.
 *
 * The overflow menu is imported from its own module path and is therefore the
 * REAL shared component here, with the real `AppLink` inside it. Stubbing it
 * would leave the link assertions testing the stub.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ConfirmFunctionOptions } from '@aglyn/shared-ui-jsx'
import { EmailTopicsCard } from './email-topics-card'

const BASE_PATH = '/acme/hosts/site/emails'

const mockPush = jest.fn()
/** Resolves, or REJECTS — `confirm` rejects on cancel (AGL-950). */
let confirmAccepts = true
/*
 * The options parameter is DECLARED even though the double ignores it.
 *
 * `jest.fn(() => …)` takes its call signature from the implementation, so an
 * implementation with no parameters records every call as an empty tuple and
 * `mock.calls[0][0]` — the whole point of spying on this — has no type. The
 * assertions below read the description the card passes, so the double has to
 * admit that a description is passed.
 */
const mockConfirm = jest.fn((_options?: ConfirmFunctionOptions) =>
  confirmAccepts ? Promise.resolve(undefined) : Promise.reject(new Error('no')),
)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: () => undefined }),
  usePathname: () => `${BASE_PATH}/topics`,
}))

const FIRESTORE = {}
const SCOPE = ['orgs', 'org-1'] as const

/**
 * The catalog, staged per case.
 *
 * `useOrgEmailTopics` is stubbed rather than its Firestore read, because what
 * this file is about is the ROW — and the hook's own merge of the four
 * built-ins with the stored overrides is covered where it lives.
 */
let topics: Array<Record<string, unknown>> = []
jest.mock('./use-org-email-topics', () => ({
  useOrgEmailTopics: () => ({ topics, scope: SCOPE }),
  writeEmailTopic: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
}))

jest.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))
jest.mock('@aglyn/shared-ui-jsx-forms', () => ({
  CreateArtifactDrawer: ({ open }: { open: boolean }) =>
    open ? <div>{'New email topic'}</div> : null,
}))

/*
 * The barrel, stubbed for the CARD's own use. The overflow menu is NOT stubbed
 * — it comes in by its own module path, so the anchor assertions below read
 * the real component.
 */
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
  mockPush.mockClear()
  mockConfirm.mockClear()
  confirmAccepts = true
  render(<EmailTopicsCard hostId="host-1" basePath={BASE_PATH} />)
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
  topics = [
    {
      id: 'marketing',
      name: 'Promotions and offers',
      description: 'Sales, discounts and seasonal campaigns.',
    },
    {
      id: 'insiders',
      name: 'Insiders',
      description: 'Early access.',
      archived: true,
    },
  ]
})

describe('a topic row opens the topic', () => {
  it('clicking the row navigates to that topic’s own route', async () => {
    await mountCard()
    fireEvent.click(rowFor('Promotions and offers'))
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/topics/marketing`)
  })

  it('the row navigates to ITS OWN id, not the first one', async () => {
    // THE CONTROL for the assertion above: a handler closed over the wrong row
    // would send every row to the same place, and a fixture of one topic
    // cannot tell the difference.
    await mountCard()
    fireEvent.click(rowFor('Insiders'))
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/topics/insiders`)
  })

  it('the topic name is a real link, and does not double-push', async () => {
    await mountCard()
    const link = rowFor('Insiders').querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`${BASE_PATH}/topics/insiders`)
    // The row's own handler would fire too and push the same route twice —
    // one history entry per back press.
    fireEvent.click(link)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('the topic row’s actions are in the shared overflow menu', () => {
  it('Edit is in the MENU and nowhere in the row', async () => {
    await mountCard()
    // The affordance it replaced: a bare `Edit` text button in the row, on the
    // one table whose rows nothing could click.
    expect(rowFor('Promotions and offers').textContent).not.toContain('Edit')
    openMenuFor('Promotions and offers')
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Edit topic', 'Retire'])
  })

  it('Edit topic is an anchor carrying the topic’s real href', async () => {
    await mountCard()
    openMenuFor('Promotions and offers')
    const edit = screen.getByRole('menuitem', { name: 'Edit topic' })
    expect(edit.tagName).toBe('A')
    expect(edit.getAttribute('href')).toBe(`${BASE_PATH}/topics/marketing`)
  })

  it('a retired topic offers Restore rather than Retire', async () => {
    await mountCard()
    openMenuFor('Insiders')
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Edit topic', 'Restore'])
  })

  it('opening the menu does not open the topic', async () => {
    await mountCard()
    openMenuFor('Promotions and offers')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('and neither does clicking the actions column beside it', async () => {
    /*
     * The menu BUTTON guards itself, so the assertion above passes with or
     * without the cell's own guard — and the cell is bigger than the button.
     * A click on the padding around it is a click inside a row whose handler
     * opens the topic.
     */
    await mountCard()
    const cells = rowFor('Promotions and offers').querySelectorAll('td')
    fireEvent.click(cells[cells.length - 1])
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('retiring a topic from the row', () => {
  it('asks first, and names what retiring costs', async () => {
    await mountCard()
    openMenuFor('Promotions and offers')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retire' }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mockConfirm).toHaveBeenCalled()
    const options = mockConfirm.mock.calls[0][0]
    expect(String(options?.description)).toMatch(/preference page/i)
    // Campaigns already sent under it keep resolving — the reason there is no
    // delete here at all.
    expect(String(options?.description)).toMatch(/keep working/i)
  })

  it('writes NOTHING when the operator cancels', async () => {
    // `confirm` resolves with no value and REJECTS on cancel, so a handler
    // that gated on the resolved value alone would retire on both paths.
    const { writeEmailTopic } = require('./use-org-email-topics')
    await mountCard()
    confirmAccepts = false
    openMenuFor('Promotions and offers')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retire' }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(writeEmailTopic).not.toHaveBeenCalled()
  })

  it('writes the whole topic, not just the flag', async () => {
    /*
     * The four built-ins have NO stored document until somebody changes one,
     * so this write creates it. A patch of `{archived: true}` alone would
     * leave a nameless override at a built-in's id — which the catalog merge
     * then reads as a topic with no name, on the recipient's own preference
     * page.
     */
    const { writeEmailTopic } = require('./use-org-email-topics')
    await mountCard()
    openMenuFor('Promotions and offers')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Retire' }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(writeEmailTopic).toHaveBeenCalledWith(FIRESTORE, SCOPE, {
      id: 'marketing',
      name: 'Promotions and offers',
      description: 'Sales, discounts and seasonal campaigns.',
      archived: true,
    })
  })

  it('restoring does not ask — it puts a choice back', async () => {
    const { writeEmailTopic } = require('./use-org-email-topics')
    await mountCard()
    openMenuFor('Insiders')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore' }))

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(writeEmailTopic).toHaveBeenCalledWith(
      FIRESTORE,
      SCOPE,
      expect.objectContaining({ id: 'insiders', archived: false }),
    )
  })
})

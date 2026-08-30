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
 * A MESSAGE ROW IS A RESOURCE, on the same terms an audience row is.
 *
 * The emails table already had a link in its first column and nothing else: no
 * whole-row target, and no way to reach anything the message is related to
 * without opening it first. What this file holds:
 *
 * 1. The ROW opens the message, and the subject stays a real `<a href>`. Two
 *    affordances rather than one — an anchor cannot be a whole-row target, and
 *    a click handler offers nothing to a middle click or "Copy link address".
 * 2. The menu carries the message's OTHER destinations — its campaign and its
 *    template — which are the two links the message's own report page draws,
 *    one screen earlier.
 * 3. A message with neither shows both items DISABLED with the reason. An
 *    absent control and an inapplicable one look identical, and only one of
 *    them tells the reader which case they are in. This matters here more than
 *    most: every message sent before campaigns grouped their emails belongs to
 *    no campaign, and there are thousands of them.
 * 4. A disabled item is NOT an anchor. A link whose destination is refused
 *    still navigates on a middle click, which is the one route around the
 *    disabled state that `pointer-events: none` misses.
 * 5. The numeric columns are right-aligned in the head AND the body.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { EmailsListCard } from './emails-list-card'

const BASE_PATH = '/acme/hosts/site/emails'

const mockPush = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: () => undefined }),
  usePathname: () => `${BASE_PATH}/emails`,
}))

const FIRESTORE = {}
/** The messages the ceilinged read answers with, staged per case. */
let emailDocs: Array<Record<string, unknown>> = []

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useFirestoreCollection: () => ({
    data: emailDocs,
    status: 'success',
    fromCache: false,
  }),
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
  }),
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))

/*
 * The barrel, stubbed for the CARD's own use. The overflow menu arrives by its
 * own module path and is therefore the real shared component — a stub would
 * leave every anchor assertion below testing the stub.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AppLink: ({ href, children, onClick }: any) => (
    <a href={href} onClick={onClick}>
      {children}
    </a>
  ),
  MdiIcon: () => null,
}))

const mountCard = async () => {
  mockPush.mockClear()
  render(<EmailsListCard hostId="host-1" basePath={BASE_PATH} />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const rowFor = (subject: string) =>
  Array.from(document.querySelectorAll('tbody tr')).find((row) =>
    row.textContent?.includes(subject),
  ) as HTMLElement

const openMenuFor = (subject: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: `More actions for ${subject}` }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  emailDocs = [
    {
      $id: 'msg-modern',
      subject: 'Spring sale',
      status: 'sent',
      sentAt: { seconds: 1_770_000_000 },
      emailCampaignId: 'camp-1',
      templateScreenId: 'screen-9',
      stats: { recipients: 100, opens: 40, clicks: 12 },
    },
    {
      // Written before campaigns grouped their emails, and composed inline.
      $id: 'msg-legacy',
      subject: 'Last week’s news',
      status: 'sent',
      sentAt: { seconds: 1_760_000_000 },
      stats: { recipients: 50, opens: 5, clicks: 1 },
    },
  ]
})

describe('a message row opens the message', () => {
  it('clicking the row navigates to that message’s own route', async () => {
    await mountCard()
    fireEvent.click(rowFor('Spring sale'))
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/emails/msg-modern`)
  })

  it('the row navigates to ITS OWN id, not the first one', async () => {
    // THE CONTROL: a handler closed over the wrong row would send every row to
    // the same place, and a fixture of one message could not tell.
    await mountCard()
    fireEvent.click(rowFor('Last week’s news'))
    expect(mockPush).toHaveBeenCalledWith(`${BASE_PATH}/emails/msg-legacy`)
  })

  it('the subject is a real link, and does not double-push', async () => {
    await mountCard()
    const link = rowFor('Spring sale').querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(`${BASE_PATH}/emails/msg-modern`)
    fireEvent.click(link)
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('the message row’s other destinations are in the menu', () => {
  it('offers the report, the campaign and the template', async () => {
    await mountCard()
    openMenuFor('Spring sale')
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Open report', 'Open its campaign', 'Open its template'])
  })

  it('all three are anchors carrying real hrefs', async () => {
    await mountCard()
    openMenuFor('Spring sale')
    const hrefs = screen
      .getAllByRole('menuitem')
      .map((item) => [item.tagName, item.getAttribute('href')])
    expect(hrefs).toEqual([
      ['A', `${BASE_PATH}/emails/msg-modern`],
      ['A', `${BASE_PATH}/campaigns/camp-1`],
      ['A', `${BASE_PATH}/templates/screen-9`],
    ])
  })

  it('a message with no campaign and no template says so, item by item', async () => {
    await mountCard()
    openMenuFor('Last week’s news')
    const items = screen.getAllByRole('menuitem')
    // The report is always reachable — it is the message itself.
    expect(items[0].getAttribute('aria-disabled')).toBeNull()
    for (const item of [items[1], items[2]]) {
      expect(item.getAttribute('aria-disabled')).toBe('true')
      // Never an anchor while refused: a middle click on one would navigate
      // past the disabled state.
      expect(item.tagName).not.toBe('A')
    }
  })

  it('opening the menu does not open the message', async () => {
    await mountCard()
    openMenuFor('Spring sale')
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('and neither does clicking the actions column beside it', async () => {
    // The menu button guards itself; the cell around it is bigger than the
    // button, and a press landing on that padding is a press inside a row
    // whose handler opens the message.
    await mountCard()
    const cells = rowFor('Spring sale').querySelectorAll('td')
    fireEvent.click(cells[cells.length - 1])
    expect(mockPush).not.toHaveBeenCalled()
  })
})

describe('the figures line up', () => {
  it('the numeric columns are right-aligned in the head AND the body', async () => {
    await mountCard()
    const headers = Array.from(document.querySelectorAll('thead th'))
    const cells = Array.from(rowFor('Spring sale').querySelectorAll('td'))
    // Addressed, Opens, Clicks.
    for (const index of [3, 4, 5]) {
      expect(headers[index].className).toMatch(/alignRight/)
      expect(cells[index].className).toMatch(/alignRight/)
    }
    // THE CONTROL: the text columns are not right-aligned, so the assertion
    // above is about alignment and not about every cell in the table.
    expect(headers[0].className).not.toMatch(/alignRight/)
    expect(cells[0].className).not.toMatch(/alignRight/)
  })
})

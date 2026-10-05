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
 *
 * @jest-environment jsdom
 */

/**
 * WHAT ONE TEMPLATE'S EMAILS DID, AS A READER SEES IT (AGL-3080).
 *
 * `template-report.spec.ts` proves the arithmetic; this file proves the
 * arithmetic is what a reader sees on the card this plugin draws in the
 * Email plugin's template page, and that the card reads only this site's
 * sends of that one template.
 */

import { registerPluginRecordRoute } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import type { SendStats } from '@aglyn/shared-ui-email-campaigns/model/send-report'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'

/** What each `useFirestoreDoc` call answers, keyed by document path. */
const mockDocs = new Map<string, unknown>()
/** What each `useFirestoreCollection` call answers, keyed by path. */
const mockCollections = new Map<string, unknown[]>()

/** Every `where` a query was built with, as its arguments. */
const mockWheres: unknown[][] = []

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  collection: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  query: (ref: { __path: string }) => ref,
  where: (...args: unknown[]) => {
    mockWheres.push(args)
    return {}
  },
  orderBy: () => ({}),
  limit: () => ({}),
  documentId: () => ({}),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  useOrgDataScope: () => ({ orgId: 'org1', scope: ['orgs', 'org1'], ready: true }),
  useFirestoreDoc: (build: () => { __path?: string } | null) => {
    const path = build()?.__path ?? ''
    const data = mockDocs.get(path)
    return { data, status: data === undefined ? 'error' : 'success' }
  },
  useFirestoreCollection: (build: () => { __path?: string } | null) => ({
    data: mockCollections.get(build()?.__path ?? '') ?? [],
  }),
}))

/** Every route the page pushed, so a row click is a claim this file checks. */
const pushed: string[] = []
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: (href: string) => pushed.push(href) }),
  useParams: () => ({ orgSlug: 'acme', host: 'site' }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

/**
 * Measured: 100 sent, 90 delivered. The two differ, so an assertion reading a
 * denominator off the screen can tell which one was divided by.
 */
const MEASURED: SendStats = {
  recipients: 100,
  sent: 100,
  delivered: 90,
  opens: 60,
  uniqueOpens: 45,
  clicks: 12,
  uniqueClicks: 9,
  bounced: 10,
  clickTracked: true,
}

/** From before the delivery webhook: real opens, no delivery denominator. */
const UNMEASURED: SendStats = { recipients: 200, sent: 200, opens: 30 }

/**
 * The MESSAGES table, found by its own first column.
 *
 * The page draws two: the audiences breakdown comes first, and an index into
 * `document.querySelectorAll('table')` would silently move to it the next time
 * a section is added above.
 */
const messagesTable = (): HTMLTableElement =>
  Array.from(document.querySelectorAll('table')).find((table) =>
    table.querySelector('thead')?.textContent?.startsWith('Subject'),
  ) as HTMLTableElement

/** The org's sends — each one sent as a single site. */
const CAMPAIGNS_PATH = 'orgs/org1/campaigns'

async function renderCard(options?: { messages?: Record<string, unknown>[] }): Promise<void> {
  mockCollections.clear()
  mockWheres.length = 0
  mockCollections.set(
    CAMPAIGNS_PATH,
    options?.messages ?? [
      {
        $id: 'msg_1',
        subject: 'Spring sale',
        status: 'sent',
        audience: 'list',
        listId: 'list_1',
        listName: 'Newsletter',
        sentAt: { toMillis: () => 1_700_000_000_000 },
        stats: MEASURED,
      },
    ],
  )
  const { EmailTemplateReportCard } = await import('./email-template-report-card')
  render(
    (
      <EmailTemplateReportCard
        hostId="site1"
        screenId="scr_1"
        basePath="/acme/hosts/site/emails"
      />
    ) as ReactNode as never,
  )
}

/**
 * A campaign's page is published on the record-route seam, as this plugin's
 * registrar publishes it; the row menu builds its link from there.
 */
beforeAll(() => {
  registerPluginRecordRoute(
    'campaign',
    {
      list: () => null,
      record: (context, id) =>
        context.host
          ? `/${context.orgSlug}/hosts/${context.host}/marketing/campaigns/${id}`
          : null,
    },
    { pluginId: 'marketing' },
  )
})

describe('the sends it reports on', () => {
  it("reads the org's sends of this design that were sent as this site", async () => {
    await renderCard()
    // The site clause is what keeps a sibling site's sends out and makes the
    // list provable for a collaborator scoped to this site.
    expect(mockWheres).toEqual(
      expect.arrayContaining([
        ['visibleTo', 'array-contains-any', ['host:site1']],
        ['templateScreenId', '==', 'scr_1'],
      ]),
    )
    expect(messagesTable().textContent).toContain('Spring sale')
  })
})

describe('the template report names its denominators on screen', () => {
  it('renders the open rate beside the campaigns it covers', async () => {
    await renderCard({
      messages: [
        { $id: 'a', status: 'sent', audience: 'leads', sentAt: { toMillis: () => 2 }, stats: MEASURED },
        { $id: 'b', status: 'sent', audience: 'leads', sentAt: { toMillis: () => 1 }, stats: UNMEASURED },
      ],
    })
    expect(screen.getByText('Open rate')).toBeTruthy()
    // The subset is on the screen, not only in the model: 45 of 90 taken over
    // the one campaign that recorded a delivery, out of the two that exist.
    expect(
      screen.getByText('45 of 90 delivered across 1 of 2 campaigns'),
    ).toBeTruthy()
  })

  it('shows an unrecorded delivered count as a dash, never as zero', async () => {
    await renderCard({
      messages: [
        { $id: 'b', status: 'sent', audience: 'leads', sentAt: { toMillis: () => 1 }, stats: UNMEASURED },
      ],
    })
    expect(screen.getByText('Delivered')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  it('names the list a message went to as the send recorded it', async () => {
    await renderCard()
    expect(screen.getByText('Newsletter')).toBeTruthy()
  })

  it('links each message to its own page', async () => {
    await renderCard()
    const link = screen.getByText('Spring sale').closest('a')
    expect(link?.getAttribute('href')).toBe('/acme/hosts/site/emails/messages/msg_1')
  })

  it('the message ROW opens it too, and the link does not double-push', async () => {
    pushed.length = 0
    await renderCard()

    fireEvent.click(messagesTable().querySelectorAll('tbody tr')[0])
    expect(pushed).toContain('/acme/hosts/site/emails/messages/msg_1')

    // The row's own handler would fire again and push the same route twice —
    // one history entry per back press.
    pushed.length = 0
    fireEvent.click(screen.getByText('Spring sale').closest('a') as Element)
    expect(pushed).toEqual([])
  })

  it('the message’s other destinations are in the overflow menu', async () => {
    pushed.length = 0
    await renderCard({
      messages: [
        {
          $id: 'msg_1',
          subject: 'Spring sale',
          status: 'sent',
          emailCampaignId: 'camp_7',
          sentAt: { toMillis: () => 1_700_000_000_000 },
          stats: MEASURED,
        },
      ],
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for Spring sale' }),
    )
    // Opening the menu must not open the message underneath it.
    expect(pushed).toEqual([])
    const campaign = screen.getByRole('menuitem', {
      name: 'Open its campaign',
    })
    expect(campaign.tagName).toBe('A')
    // Not under this surface's own base path: a campaign's page is another
    // plugin's, and the address is the one its owner publishes.
    expect(campaign.getAttribute('href')).toBe(
      '/acme/hosts/site/marketing/campaigns/camp_7',
    )
  })

  it('clicking the actions column does not open the message', async () => {
    /*
     * The menu BUTTON guards itself, so an assertion that only opened the menu
     * would pass with or without the cell's own guard — and the cell is bigger
     * than the button. A press landing on the padding around it is a press
     * inside a row whose handler opens the message.
     */
    pushed.length = 0
    await renderCard()

    const cells = messagesTable()
      .querySelectorAll('tbody tr')[0]
      .querySelectorAll('td')
    fireEvent.click(cells[cells.length - 1])
    expect(pushed).toEqual([])
  })

  it('a message that belongs to NO campaign says so rather than guessing', async () => {
    // Every message written before campaigns grouped their emails names no
    // container. Defaulting to the message's own id would give the row a menu
    // item that navigates to the page the reader is already on.
    await renderCard({
      messages: [
        {
          $id: 'msg_1',
          subject: 'Spring sale',
          status: 'sent',
          sentAt: { toMillis: () => 1_700_000_000_000 },
          stats: MEASURED,
        },
      ],
    })

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for Spring sale' }),
    )
    const campaign = screen.getByRole('menuitem', {
      name: 'Open its campaign',
    })
    expect(campaign.getAttribute('aria-disabled')).toBe('true')
    expect(campaign.tagName).not.toBe('A')
  })

  it('the numeric columns are right-aligned in the head AND the body', async () => {
    // A header aligned one way over cells aligned another is exactly the
    // defect this surface's tables were reported for.
    await renderCard()
    const messages = messagesTable()
    const headers = Array.from(messages.querySelectorAll('thead th'))
    const cells = Array.from(
      messages.querySelectorAll('tbody tr')[0].querySelectorAll('td'),
    )
    for (const index of [3, 4, 5]) {
      expect(headers[index].className).toMatch(/alignRight/)
      expect(cells[index].className).toMatch(/alignRight/)
    }
    // THE CONTROL: the text columns are not right-aligned, so the assertion
    // above is about alignment rather than about every cell in the table.
    expect(headers[0].className).not.toMatch(/alignRight/)
    expect(cells[0].className).not.toMatch(/alignRight/)
  })
})

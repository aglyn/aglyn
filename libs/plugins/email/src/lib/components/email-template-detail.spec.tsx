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
 * WHAT REACHES THE SCREEN, AND WHAT IT IS ALLOWED TO DO THERE.
 *
 * `template-report.spec.ts` proves the arithmetic; this file proves the
 * arithmetic is what a reader sees, and that the preview beside it cannot
 * reach the console it is drawn in.
 *
 * The sandbox assertion is the one worth stating plainly. The preview renders
 * markup written outside this console — by a site's own editors, or by a
 * marketplace publisher — and an iframe with NO `sandbox` attribute is
 * same-origin by default, which would put tenant HTML on the console's origin
 * with the reader's session in it. `sandbox=""` is the maximally restrictive
 * form; a `sandbox` that merely EXISTS is not enough, because
 * `sandbox="allow-scripts allow-same-origin"` is the combination that escapes
 * the sandbox entirely. So the assertion reads the attribute's VALUE.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type {
  CampaignStats,
} from '@aglyn/shared-ui-email-campaigns/model/campaign-report'

/** What each `useFirestoreDoc` call answers, keyed by document path. */
const mockDocs = new Map<string, unknown>()
/** What each `useFirestoreCollection` call answers, keyed by path. */
const mockCollections = new Map<string, unknown[]>()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  collection: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
  query: (ref: { __path: string }) => ref,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  documentId: () => ({}),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'site' }),
  // Nobody signed in, so the recipients card never issues its request. This
  // file is about the page above it.
  useUser: () => ({ data: null }),
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

const SCREEN_PATH = 'hosts/site1/screens/scr_1'
const VERSION_PATH = 'hosts/site1/screens/scr_1/versions/ver_1'
const CAMPAIGNS_PATH = 'hosts/site1/campaigns'

/**
 * A besigner node map, rooted at `_@_` — the id the besigner really writes.
 * A map rooted at `'root'` renders as an empty shell, so a fixture using it
 * would pass every assertion below for the wrong reason.
 */
const NODES = {
  '_@_': { componentId: 'emailSection', nodes: ['t1', 't2'] },
  t1: { componentId: 'emailText', props: { children: 'Spring is here' } },
  // Left standing on purpose: the preview passes no merge map, so this is
  // what a reader should see where personalization lands.
  t2: { componentId: 'emailText', props: { children: 'Hi {{contact.name}}' } },
}

/**
 * Measured: 100 sent, 90 delivered. The two differ, so an assertion reading a
 * denominator off the screen can tell which one was divided by.
 */
const MEASURED: CampaignStats = {
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
const UNMEASURED: CampaignStats = { recipients: 200, sent: 200, opens: 30 }

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

async function renderDetail(options?: {
  screen?: Record<string, unknown>
  version?: Record<string, unknown> | null
  messages?: Record<string, unknown>[]
}): Promise<void> {
  mockDocs.clear()
  mockCollections.clear()
  mockDocs.set(SCREEN_PATH, {
    $id: 'scr_1',
    displayName: 'Spring promo',
    kind: 'email',
    versionId: 'ver_1',
    emailSubject: 'Spring sale',
    ...options?.screen,
  })
  if (options?.version !== null) {
    mockDocs.set(VERSION_PATH, options?.version ?? { nodes: NODES })
  }
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
  const { EmailTemplateDetail } = await import('./email-template-detail')
  render(
    (
      <EmailTemplateDetail
        hostId="site1"
        screenId="scr_1"
        basePath="/acme/hosts/site/emails"
      />
    ) as ReactNode as never,
  )
}

describe('the template preview cannot reach the console it is drawn in', () => {
  it('renders the email into an iframe sandboxed with no permissions', async () => {
    await renderDetail()
    const frame = document.querySelector('iframe[title="Email preview"]')
    expect(frame).toBeTruthy()
    // The VALUE, not merely the attribute: `allow-scripts allow-same-origin`
    // together is an escape, so "has a sandbox" is not the property worth
    // holding.
    expect(frame?.getAttribute('sandbox')).toBe('')
  })

  it('never lets the markup be served from the console origin', async () => {
    await renderDetail()
    const frame = document.querySelector('iframe[title="Email preview"]')
    // `srcdoc`, never `src`: a URL would be fetched from this origin, where
    // the sandbox attribute is the only thing between tenant HTML and a live
    // session.
    expect(frame?.getAttribute('srcdoc')).toBeTruthy()
    expect(frame?.getAttribute('src')).toBeNull()
  })

  it('draws the send path’s own HTML, not a second rendering', async () => {
    await renderDetail()
    const html =
      document
        .querySelector('iframe[title="Email preview"]')
        ?.getAttribute('srcdoc') ?? ''
    expect(html).toContain('Spring is here')
    // Table layout with inline styles — the mail pipeline's output, which is
    // what makes this a preview of the message rather than of the editor.
    expect(html).toContain('role="presentation"')
  })

  it('leaves merge tokens standing so a reader can see where they land', async () => {
    await renderDetail()
    const html =
      document
        .querySelector('iframe[title="Email preview"]')
        ?.getAttribute('srcdoc') ?? ''
    expect(html).toContain('{{contact.name}}')
  })

  it('says a template with nothing in it is empty rather than drawing one', async () => {
    await renderDetail({ version: { nodes: {} } })
    expect(document.querySelector('iframe[title="Email preview"]')).toBeNull()
    expect(screen.getByText(/nothing in it yet/i)).toBeTruthy()
  })
})

describe('the template header carries the way into the besigner', () => {
  it('links Edit in besigner at the screen’s own version', async () => {
    await renderDetail()
    const link = screen.getByText('Edit in besigner').closest('a')
    expect(link?.getAttribute('href')).toBe(
      '/acme/hosts/site/screens/scr_1/versions/ver_1/besigner',
    )
  })

  it('withholds it from a template that has no version to open', async () => {
    await renderDetail({ screen: { versionId: undefined }, version: null })
    const button = screen.getByText('Edit in besigner').closest('button')
    // A half-formed besigner URL lands on a 404, which reads as a broken
    // console rather than as a template that has never been saved.
    expect(button?.hasAttribute('disabled')).toBe(true)
  })
})

describe('the template report names its denominators on screen', () => {
  it('renders the open rate beside the campaigns it covers', async () => {
    await renderDetail({
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
    await renderDetail({
      messages: [
        { $id: 'b', status: 'sent', audience: 'leads', sentAt: { toMillis: () => 1 }, stats: UNMEASURED },
      ],
    })
    expect(screen.getByText('Delivered')).toBeTruthy()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  it('names the list a message went to as the send recorded it', async () => {
    await renderDetail()
    expect(screen.getByText('Newsletter')).toBeTruthy()
  })

  it('links each message to its own page', async () => {
    await renderDetail()
    const link = screen.getByText('Spring sale').closest('a')
    expect(link?.getAttribute('href')).toBe('/acme/hosts/site/emails/emails/msg_1')
  })

  it('the message ROW opens it too, and the link does not double-push', async () => {
    pushed.length = 0
    await renderDetail()

    fireEvent.click(messagesTable().querySelectorAll('tbody tr')[0])
    expect(pushed).toContain('/acme/hosts/site/emails/emails/msg_1')

    // The row's own handler would fire again and push the same route twice —
    // one history entry per back press.
    pushed.length = 0
    fireEvent.click(screen.getByText('Spring sale').closest('a') as Element)
    expect(pushed).toEqual([])
  })

  it('the message’s other destinations are in the overflow menu', async () => {
    pushed.length = 0
    await renderDetail({
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
    // The MARKETING hub, not this surface's own: a campaign's page is a
    // section of the Marketing console.
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
    await renderDetail()

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
    await renderDetail({
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
    await renderDetail()
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

describe('a template installed from a marketplace listing', () => {
  it('says so, and says its standing has not been checked', async () => {
    await renderDetail({
      screen: {
        installedFrom: {
          listingId: 'listing_1',
          version: '3',
          sha256: 'a'.repeat(64),
          artifactType: 'emailTemplate',
        },
      },
    })
    expect(screen.getByText(/Installed from a marketplace listing/)).toBeTruthy()
    expect(screen.getByText(/has not been checked/)).toBeTruthy()
  })

  it('CONTROL: a locally authored template claims no publisher', async () => {
    await renderDetail()
    expect(screen.queryByText(/Installed from a marketplace listing/)).toBeNull()
  })
})

describe('the template preview sits at the bottom of the page', () => {
  /*==========================================
   * THE SAME ORDER THE EMAIL'S OWN PAGE USES.
   *
   * The figures are what a reader opens either page for, and the frame is the
   * tallest thing on both — at the top it pushes every number below the fold.
   * Held on both pages so the two cannot drift into disagreeing about what
   * they are for.
   *=========================================*/
  it('renders the preview frame AFTER the delivery figures', async () => {
    await renderDetail()
    const preview = document.querySelector('iframe[title="Email preview"]')
    const delivery = screen.getByText('Delivery')
    expect(preview).toBeTruthy()
    // DOM order, not mere presence: both are on the page whichever way round
    // they sit, so presence alone would pass with nothing moved.
    expect(
      delivery.compareDocumentPosition(preview as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('renders it AFTER the recipients card', async () => {
    await renderDetail()
    const preview = document.querySelector('iframe[title="Email preview"]')
    const recipients = screen.getByText('Recipients')
    expect(
      recipients.compareDocumentPosition(preview as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('gives the preview card a heading rather than a hover tooltip', async () => {
    await renderDetail()
    expect(screen.getByText('Preview')).toBeTruthy()
    expect(document.querySelector('[title="Preview"]')).toBeNull()
  })
})

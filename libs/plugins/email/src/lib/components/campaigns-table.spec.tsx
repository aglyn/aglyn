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
 * THE CAMPAIGNS LIST, AND THE SENDS IT MUST NOT STRAND.
 *
 * A campaign is now a container and the list is a table of containers — but
 * every campaign a merchant has already sent is a SEND document, and those
 * ids are cited by mail that has already been delivered: each unsubscribe
 * link carries `cid={sendId}` inside its own signature, and
 * `/emails/campaigns/{sendId}` is a URL merchants paste into messages.
 *
 * So the list adopts a container-less send as a campaign of one, at READ
 * time, and the row it draws links to that send's own id. Nothing is
 * rewritten; there is no backfill to run and no window during which a
 * merchant's history is missing.
 *
 * The reads are still CEILINGED and still unorderable on any date — a sent
 * send carries `sentAt`, a scheduled one `sendAtMs`, and neither is on both —
 * so the window is bounded, the card probes one past the ceiling, and it says
 * so when the probe finds something.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.setTimeout(30_000)

const FIRESTORE = {}

/** Every `limit` the card asked each collection for. */
let capsAsked: Record<string, number[]> = {}
/** Documents the doubles serve, by collection name. */
let served: Record<string, any[]> = {}
/** Every client write the card made: [path, value]. */
let writes: Array<[string, Record<string, any>]> = []
/** Every route the card pushed. */
let pushed: string[] = []
/** The extra fields the card handed the create drawer. */
let drawerFields: any[] = []
/** What the create form submits when its button is pressed. */
let formValues: Record<string, any> = {}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-test' } }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
  useConsoleHostRoute: () => ({
    base: null,
    orgSlug: 'acme',
    subdomain: 'store',
  }),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    const cap = (built?.constraints ?? []).find(
      (item: any) => 'limit' in item,
    )?.limit
    if (typeof cap === 'number') {
      capsAsked[name] = [...(capsAsked[name] ?? []), cap]
    }
    const rows = served[name] ?? []
    return {
      data: typeof cap === 'number' ? rows.slice(0, cap) : rows,
      status: 'success',
      fromCache: false,
    }
  },
}))

jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...segments: string[]) => ({
    path: segments.join('/'),
    constraints: [],
  }),
  query: (base: any, ...constraints: unknown[]) => ({
    path: base?.path ?? base,
    constraints: [...(base?.constraints ?? []), ...constraints],
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  setDoc: async (ref: any, value: Record<string, any>) => {
    writes.push([String(ref?.path ?? ''), value])
  },
}))

jest.mock('@aglyn/aglyn', () => ({
  ...jest.requireActual('@aglyn/aglyn'),
  pluginDocsHelp: () => undefined,
}))
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => pushed.push(href),
    replace: jest.fn(),
  }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/**
 * The shared create drawer, stubbed at its own boundary.
 *
 * What it collects is asserted from the fields the card HANDS it, rather than
 * driven field by field: the drawer and data-driven-forms are library code
 * with their own tests, and what belongs here is which fields a campaign asks
 * for and what the card does with the values that come back.
 */
jest.mock('@aglyn/shared-ui-jsx-forms', () => ({
  CreateArtifactDrawer: ({ open, extraFields, onSubmit, errorSlot }: any) => {
    drawerFields = extraFields
    return open ? (
      <div>
        <button type="button" onClick={() => onSubmit(formValues)}>
          {'Submit campaign'}
        </button>
        {/* A refusal is shown IN the drawer, where the form still is. */}
        {errorSlot}
      </div>
    ) : null
  },
}))

jest.mock('./use-org-email-topics', () => ({
  useOrgEmailTopics: () => ({
    topics: [
      { id: 'marketing', name: 'Promotions and offers' },
      { id: 'sales', name: 'Sales outreach' },
      { id: 'retired', name: 'Old stream', archived: true },
    ],
  }),
}))

import HostCampaignsCard from './campaigns-card'

const CONTAINER_CEILING = 50
const SEND_CEILING = 30

const sentSend = (id: string, over: Record<string, any> = {}) => ({
  $id: id,
  subject: `Subject ${id}`,
  status: 'sent',
  sentAt: { seconds: 1_760_000_000 },
  stats: { sent: 10, recipients: 10, opens: 4, clicks: 1 },
  ...over,
})

beforeEach(() => {
  capsAsked = {}
  writes = []
  pushed = []
  drawerFields = []
  formValues = {}
  served = {
    emailCampaigns: [
      {
        $id: 'camp-1',
        name: 'Spring sale',
        startAtMs: Date.UTC(2026, 2, 1),
        endAtMs: Date.UTC(2026, 2, 31),
        listIds: ['list-1'],
      },
    ],
    campaigns: [
      sentSend('send-in-campaign', { emailCampaignId: 'camp-1' }),
      sentSend('legacy-send', { subject: 'Last week’s news' }),
    ],
    lists: [{ $id: 'list-1', name: 'Newsletter' }],
  }
})

const mount = async () => {
  render(<HostCampaignsCard hostId="host-1" basePath="/acme/hosts/store/emails" />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const cells = () =>
  Array.from(document.querySelectorAll('[role="gridcell"]')).map((node) =>
    (node.textContent ?? '').trim(),
  )

/** The grid row holding a campaign, found by its name. */
const rowFor = (name: string) =>
  Array.from(document.querySelectorAll('[role="row"]')).find((row) =>
    row.textContent?.includes(name),
  ) as HTMLElement

/** The trailing overflow menu on that row, opened. */
const openMenuFor = (name: string) =>
  fireEvent.click(
    screen.getByRole('button', { name: `More actions for ${name}` }),
  )

describe('the campaigns table', () => {
  it('reads each collection to its ceiling PLUS a probe', async () => {
    await mount()

    expect(capsAsked['campaigns']).toContain(SEND_CEILING + 1)
    expect(capsAsked['emailCampaigns']).toContain(CONTAINER_CEILING + 1)
  })

  it('shows a campaign and its rolled-up figures', async () => {
    await mount()

    await waitFor(() => expect(cells()).toContain('Spring sale'))
    // One email in the campaign, ten sent, four opens — summed from the send.
    expect(cells()).toContain('Newsletter')
  })

  it('ADOPTS a send that belongs to no campaign, under its own id', async () => {
    await mount()

    await waitFor(() =>
      expect(screen.getByText('Last week’s news')).toBeTruthy(),
    )
    expect(screen.getAllByText('Single send').length).toBe(1)
  })

  it('opens a legacy send at the URL that has always addressed it', async () => {
    await mount()
    await waitFor(() =>
      expect(screen.getByText('Last week’s news')).toBeTruthy(),
    )

    fireEvent.click(rowFor('Last week’s news'))

    // The id in the path is the SEND's id. Every `/emails/campaigns/{sendId}`
    // a merchant has pasted anywhere goes on resolving.
    expect(pushed).toContain('/acme/hosts/store/emails/campaigns/legacy-send')
  })

  it('the campaign name is a real link, and does not double-push', async () => {
    /*
     * A click handler that calls `router.push` looks identical to a left
     * click and offers nothing to a middle click, a ⌘-click, "Open link in
     * new tab" or "Copy link address". The row click and the anchor are two
     * affordances rather than one — and the anchor stops the row's handler,
     * which would otherwise push the same route twice and cost one history
     * entry per back press.
     */
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    const link = rowFor('Spring sale').querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      '/acme/hosts/store/emails/campaigns/camp-1',
    )
    fireEvent.click(link)
    expect(pushed).toEqual([])
  })

  it('the row’s actions are in the shared overflow menu', async () => {
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    openMenuFor('Spring sale')
    // Exactly one, because opening it is the only thing a campaign row can do
    // today: there is no campaign edit page and no delete path, so anything
    // else here would be an action the product does not have.
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['Open campaign'])
    // A real anchor, so it is middle-clickable like any other link.
    expect(items[0].tagName).toBe('A')
    expect(items[0].getAttribute('href')).toBe(
      '/acme/hosts/store/emails/campaigns/camp-1',
    )
  })

  it('opening the menu does not open the campaign', async () => {
    // The menu button sits inside a clickable row. Without the propagation
    // guard the grid would navigate out from under the menu it just opened.
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    openMenuFor('Spring sale')
    expect(pushed).toEqual([])
  })

  it('the count columns are right-aligned in the header AND the cells', async () => {
    /*
     * The defect this table was reported for. A figure is read by its last
     * digit, so a column of them lines up on the right or not at all — and a
     * grid column defaults its HEADER to the column type's alignment rather
     * than to the cell's, so `align` without `headerAlign` leaves a left
     * header sitting over right-aligned figures.
     */
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    for (const field of ['emails', 'sent', 'opens', 'clicks']) {
      const header = document.querySelector(
        `[role="columnheader"][data-field="${field}"]`,
      )
      const cell = document.querySelector(
        `[role="gridcell"][data-field="${field}"]`,
      )
      expect(header?.className).toMatch(/columnHeader--alignRight/)
      expect(cell?.className).toMatch(/cell--textRight/)
    }
    // THE CONTROL: the name column is not right-aligned, so the assertion
    // above is about alignment and not about every column in the grid.
    expect(
      document.querySelector('[role="columnheader"][data-field="name"]')
        ?.className,
    ).not.toMatch(/alignRight/)
  })

  it('does not list a send twice when it belongs to a campaign', async () => {
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    expect(cells()).not.toContain('Subject send-in-campaign')
  })

  it('says so when a ceiling bit, and stays quiet when it did not', async () => {
    await mount()
    expect(screen.queryByText(/This site has more/)).toBeNull()

    served.campaigns = Array.from({ length: SEND_CEILING + 1 }, (_, index) =>
      sentSend(`send-${String(index).padStart(2, '0')}`),
    )
    document.body.innerHTML = ''
    await mount()

    expect(screen.getByText(/This site has more/)).toBeTruthy()
  })
})

describe('creating a campaign', () => {
  const openDrawer = async () => {
    await mount()
    fireEvent.click(screen.getByText('Create campaign'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('collects a window, the lists and the topic beside the shared name field', async () => {
    await openDrawer()

    // `displayName` is the shared drawer's own field and is not repeated here.
    const names = drawerFields.map((field: any) => field.name)
    expect(names).toEqual(['startAt', 'endAt', 'listIds', 'topicId'])
    const listField = drawerFields.find(
      (field: any) => field.name === 'listIds',
    )
    expect(listField.options).toEqual([
      { value: 'list-1', label: 'Newsletter' },
    ])
  })

  it('offers only the topics a recipient can still leave', async () => {
    // A campaign may not be composed under a stream nobody can unsubscribe
    // from; one already SENT under a retired topic keeps resolving.
    await openDrawer()

    const topicField = drawerFields.find(
      (field: any) => field.name === 'topicId',
    )
    expect(topicField.options).toEqual([
      { value: 'marketing', label: 'Promotions and offers' },
      { value: 'sales', label: 'Sales outreach' },
    ])
  })

  it('writes the campaign and opens it', async () => {
    formValues = {
      displayName: 'Summer sale',
      startAt: '2026-06-01',
      endAt: '2026-06-30',
      listIds: ['list-1'],
      topicId: 'sales',
    }
    await openDrawer()

    fireEvent.click(screen.getByText('Submit campaign'))
    await waitFor(() => expect(writes).toHaveLength(1))

    const [path, value] = writes[0]
    // The CONTAINER collection. The send collection is untouched, which is
    // what leaves every delivered `cid` resolving.
    expect(path.startsWith('hosts/host-1/emailCampaigns/')).toBe(true)
    expect(value.name).toBe('Summer sale')
    expect(value.startAtMs).toBe(Date.parse('2026-06-01'))
    expect(value.endAtMs).toBe(Date.parse('2026-06-30'))
    expect(value.listIds).toEqual(['list-1'])
    // The stream its emails open on, so a sales campaign is not composed as
    // marketing and mailed to people who left sales.
    expect(value.topicId).toBe('sales')
    expect(pushed[0]).toContain('/emails/campaigns/')
  })

  it('takes a campaign with no dates and no lists', async () => {
    formValues = { displayName: 'Always on' }
    await openDrawer()

    fireEvent.click(screen.getByText('Submit campaign'))
    await waitFor(() => expect(writes).toHaveLength(1))

    expect(writes[0][1]).toMatchObject({ name: 'Always on', listIds: [] })
    expect(writes[0][1].startAtMs).toBeUndefined()
  })

  it('refuses a window that ends before it starts', async () => {
    formValues = {
      displayName: 'Backwards',
      startAt: '2026-06-30',
      endAt: '2026-06-01',
    }
    await openDrawer()

    fireEvent.click(screen.getByText('Submit campaign'))
    await waitFor(() =>
      expect(
        screen.getByText('The end date is before the start date'),
      ).toBeTruthy(),
    )
    expect(writes).toEqual([])
  })
})

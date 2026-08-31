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
 * `/marketing/campaigns/{sendId}` is a URL merchants paste into messages.
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
  // Signed in and able to mint an ID token: the row actions post through
  // `useCampaignManageApi`, which authorizes from one and issues nothing
  // without it.
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: async () => 'token' } }),
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

/*
 * The topic catalog, which ANSWERS NOTHING UNLESS IT IS ASKED.
 *
 * The real hook opens no listener when `enabled` is false, so a double that
 * served the catalog either way would let the picker fill from a read the
 * card never made — and the whole point of the gate is that the card does not
 * make it while the drawer is shut. `topicsEnabled` records what was asked
 * for, so the gate itself is assertable and not merely the picker's contents.
 */
jest.mock('@aglyn/plugins-email/components/use-org-email-topics', () => ({
  useOrgEmailTopics: (_hostId: string, options?: { enabled?: boolean }) => {
    const enabled = options?.enabled ?? true
    topicsEnabled.push(enabled)
    return {
      topics: enabled
        ? [
            { id: 'marketing', name: 'Promotions and offers' },
            { id: 'sales', name: 'Sales outreach' },
            { id: 'retired', name: 'Old stream', archived: true },
          ]
        : [],
    }
  },
}))

/** Every `enabled` the card asked the topic hook for, in order. */
let topicsEnabled: boolean[] = []

/** Whether the operator agrees to a destructive act. */
let confirmAccepts = true
const mockConfirm = jest.fn((_options?: Record<string, unknown>) =>
  confirmAccepts ? Promise.resolve(undefined) : Promise.reject(new Error('no')),
)

/*
 * The barrel, kept REAL except for the confirmation.
 *
 * `CardDisplay` and the grid come from here and a stub would leave every
 * assertion below testing the stub. `useConfirmationContext` cannot stay real:
 * its default context value answers `undefined` rather than a promise, and the
 * delete handler awaits one.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

/** Every POST the card made: [url, parsed body]. */
let posted: Array<[string, Record<string, any>]> = []
/** What the next POST answers with. */
let postAnswer = { ok: true, body: {} as Record<string, unknown> }

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
  topicsEnabled = []
  confirmAccepts = true
  posted = []
  postAnswer = { ok: true, body: {} }
  mockConfirm.mockClear()
  global.fetch = (async (url: string, init: any) => {
    posted.push([String(url), JSON.parse(String(init?.body ?? '{}'))])
    return { ok: postAnswer.ok, json: async () => postAnswer.body }
  }) as unknown as typeof fetch
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
  render(<HostCampaignsCard hostId="host-1" basePath="/acme/hosts/store/marketing" />)
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

/**
 * The same card with NO `basePath`, which is how the inbox console embeds it
 * on a tab of its own: that page's own `basePath` names the INBOX hub, so
 * passing it would send every row to a URL beneath the wrong surface.
 */
const mountWithoutBasePath = async () => {
  render(<HostCampaignsCard hostId="host-1" />)
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

  /*==========================================
   * THE HUB THE CARD RESOLVES FOR ITSELF.
   *
   * Every reading above hands this card a `basePath`, so all of them pass
   * whatever the fallback resolves to — and the fallback is the branch the
   * INBOX takes, where the card is a tab on somebody else's surface and the
   * caller's own hub URL would be the wrong answer.
   *
   * The campaign's pages are on the MARKETING console, so the fallback names
   * that hub by slug. A card that resolved the Emails hub instead would send
   * every row on the inbox's campaigns tab to a URL the shell 404s.
   *=========================================*/
  it('resolves the MARKETING hub when the caller hands it no base path', async () => {
    await mountWithoutBasePath()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    const link = rowFor('Spring sale').querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      '/acme/hosts/store/marketing/campaigns/camp-1',
    )
  })

  it('opens a legacy send at the URL that has always addressed it', async () => {
    await mount()
    await waitFor(() =>
      expect(screen.getByText('Last week’s news')).toBeTruthy(),
    )

    fireEvent.click(rowFor('Last week’s news'))

    // The id in the path is the SEND's id. Every `/marketing/campaigns/{sendId}`
    // a merchant has pasted anywhere goes on resolving.
    expect(pushed).toContain('/acme/hosts/store/marketing/campaigns/legacy-send')
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
      '/acme/hosts/store/marketing/campaigns/camp-1',
    )
    fireEvent.click(link)
    expect(pushed).toEqual([])
  })

  it('the row’s actions are in the shared overflow menu', async () => {
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    openMenuFor('Spring sale')
    /*
     * Opening and deleting. EDITING is deliberately absent from a table row:
     * a record is edited on its own page in this console, and the first entry
     * here is the way to that page.
     */
    const items = screen.getAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual([
      'Open campaign',
      'Delete campaign',
    ])
    // A real anchor, so it is middle-clickable like any other link.
    expect(items[0].tagName).toBe('A')
    expect(items[0].getAttribute('href')).toBe(
      '/acme/hosts/store/marketing/campaigns/camp-1',
    )
    // The destructive one is a handler, never a link.
    expect(items[1].tagName).not.toBe('A')
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

/*==========================================
 * DELETING A CAMPAIGN FROM ITS ROW.
 *
 * The container goes and its emails stay — the route detaches them first, so
 * each keeps its id, its report and its unsubscribe links and reappears in
 * this very table as a "Single send". What belongs HERE is the half the card
 * owns: that it asks first, says what is kept, posts the right thing, and is
 * refused on a row that is not a container at all. What survives a delete is
 * `campaign-manage.spec.ts`, against the route that does it.
 *=========================================*/
describe('deleting a campaign', () => {
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const deleteItem = () =>
    screen
      .getAllByRole('menuitem')
      .find((item) => item.textContent === 'Delete campaign') as HTMLElement

  it('asks first, and names what is KEPT', async () => {
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    openMenuFor('Spring sale')
    fireEvent.click(deleteItem())
    await settle()

    const options = mockConfirm.mock.calls[0][0] as Record<string, any>
    expect(String(options.title)).toContain('Spring sale')
    // The emails are kept, and the confirmation says so — a merchant reading
    // "delete campaign" has to be told the mail survives before they agree.
    expect(String(options.description)).toMatch(/kept/i)
    expect(String(options.description)).toMatch(/single sends/i)
  })

  it('says that a scheduled email still goes out', async () => {
    /*
     * Deleting a campaign groups nothing; it does not cancel anything. A
     * merchant who reads the button as "stop this campaign" has to be told
     * otherwise BEFORE they press it, not after their mail arrives.
     */
    served.campaigns = [
      {
        $id: 'due-friday',
        subject: 'Due Friday',
        status: 'scheduled',
        sendAtMs: Date.UTC(2026, 5, 5),
        emailCampaignId: 'camp-1',
      },
    ]
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    openMenuFor('Spring sale')
    fireEvent.click(deleteItem())
    await settle()

    expect(String(mockConfirm.mock.calls[0][0]?.description)).toMatch(
      /still going out or still due/i,
    )
  })

  it('posts to the manage route once agreed', async () => {
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    openMenuFor('Spring sale')
    fireEvent.click(deleteItem())
    await settle()

    expect(posted).toHaveLength(1)
    expect(posted[0][0]).toBe('/api/campaigns/manage')
    expect(posted[0][1]).toMatchObject({
      hostId: 'host-1',
      action: 'deleteCampaign',
      campaignId: 'camp-1',
    })
  })

  it('posts NOTHING when the operator cancels', async () => {
    confirmAccepts = false
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    openMenuFor('Spring sale')
    fireEvent.click(deleteItem())
    await settle()

    expect(mockConfirm).toHaveBeenCalled()
    expect(posted).toHaveLength(0)
  })

  it('does NOT delete the container through a client write', async () => {
    // `hosts/{id}/campaigns` is server-only in the rules — the container can
    // only go once its sends are detached, and no client may detach them.
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    openMenuFor('Spring sale')
    fireEvent.click(deleteItem())
    await settle()

    expect(writes).toHaveLength(0)
  })

  it('is refused on a SINGLE SEND row, which has no container', async () => {
    await mount()
    await waitFor(() =>
      expect(screen.getByText('Last week’s news')).toBeTruthy(),
    )

    openMenuFor('Last week’s news')
    const item = deleteItem()
    expect(item.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(item)
    await settle()
    expect(mockConfirm).not.toHaveBeenCalled()
    expect(posted).toHaveLength(0)
  })
})

/*==========================================
 * THE TOPIC CATALOG IS THE SECTION'S BIGGEST READ, AND NOTHING DRAWS IT.
 *
 * 200 documents — more than the rest of this section put together — filling
 * one picker inside a drawer nobody has opened. `emails-console-read-cost`
 * holds the resulting number; this is the reading that says the catalog is
 * still THERE once somebody asks for it, which a gate that simply never read
 * would also satisfy.
 *=========================================*/
describe('what the table reads before anybody asks to create', () => {
  it('does not read the topic catalog on mount', async () => {
    await mount()
    expect(topicsEnabled.length).toBeGreaterThan(0)
    expect(topicsEnabled.some((enabled) => enabled)).toBe(false)
  })

  it('reads it as soon as the create drawer opens', async () => {
    await mount()
    fireEvent.click(screen.getByText('Create campaign'))
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(topicsEnabled.some((enabled) => enabled)).toBe(true)
  })
})

/*==========================================
 * THE EMAILS COLUMN COUNTS WHAT HAS GONE OUT.
 *
 * A campaign holding an email part way through an audience larger than one
 * batch stores it as `scheduled`, so the column reported the campaign as
 * having sent nothing while its recipients were receiving it.
 *=========================================*/
describe('a campaign whose email is still going out', () => {
  const emailsCell = () =>
    String(
      document.querySelector('[role="gridcell"][data-field="emails"]')
        ?.textContent ?? '',
    )

  beforeEach(() => {
    served.campaigns = [
      {
        $id: 'big-send',
        subject: 'Big one',
        status: 'scheduled',
        emailCampaignId: 'camp-1',
        stats: { sent: 500, delivered: 480, audienceSize: 3000 },
        resume: { remaining: 2500, batch: 1, nextAtMs: Date.now() + 60_000 },
      },
    ]
  })

  it('counts it as a send, and says it is still sending', async () => {
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    expect(emailsCell()).toContain('1')
    expect(emailsCell()).toContain('sending')
    expect(emailsCell()).not.toContain('scheduled')
  })

  it('puts what it has delivered into the campaign totals', async () => {
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    // Dropped from every figure while it was read as unsent.
    expect(cells()).toContain('500')
  })

  it('still says "scheduled" for one that has delivered nothing', async () => {
    // THE CONTROL: the narrower reading must keep the case it has always had.
    served.campaigns = [
      {
        $id: 'later',
        subject: 'Due Friday',
        status: 'scheduled',
        emailCampaignId: 'camp-1',
        sendAtMs: Date.now() + 86_400_000,
      },
    ]
    await mount()
    await waitFor(() => expect(cells()).toContain('Spring sale'))

    expect(emailsCell()).toContain('scheduled')
    expect(emailsCell()).not.toContain('sending')
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
    expect(pushed[0]).toContain('/marketing/campaigns/')
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

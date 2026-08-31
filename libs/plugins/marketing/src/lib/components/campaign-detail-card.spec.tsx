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
 * ONE URL, TWO KINDS OF ID.
 *
 * `/marketing/campaigns/{id}` addresses a campaign CONTAINER and also a single
 * SEND, and it is linkable by design — the console's own comment says a
 * merchant pastes it into a message about last week's send.
 *
 * The id is answered by READING: a container renders the campaign, and
 * anything else falls through to the send's own report. That fall-through is
 * what keeps a send id addressing a page — no send document is rewritten and
 * no id reassigned, so every unsubscribe link already in an inbox (each
 * carrying `cid={sendId}` inside its signature) resolves untouched.
 *
 * The MESSAGE and TEMPLATE this page links to keep their own pages on the
 * Emails console, so those two hrefs are built from the sibling hub rather
 * than from this surface's `basePath` — the assertions below hold that apart.
 *
 * The other thing this file holds down is the cost the campaign route was
 * split out to avoid: the composer opens listens of its own, and a reader who
 * came for numbers must not pay for one — and neither the edit drawer's topic
 * picker.
 *
 * EDITING and DELETING live here because a record is managed on its own page
 * in this console. The two are written through different doors on purpose:
 * the container is client-writable and the edit uses the same client SDK the
 * create drawer does, while the delete has to detach the campaign's SENDS,
 * which no client may touch, so it is a POST.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  PageHeaderRecordContext,
  type PageHeaderRecordValue,
} from '@aglyn/aglyn'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'

jest.setTimeout(30_000)

const FIRESTORE = {}

/** Container documents by id; anything absent is not a container. */
let containers: Record<string, any> = {}
/** What the container read reports — `loading` until it settles. */
let docStatus = 'success'
/** Sends served for the `emailCampaignId` equality query. */
let sends: any[] = []
/** Every equality filter the sends query carried. */
let filters: any[] = []
/** Every `limit` the sends query asked for. */
let limits: number[] = []
let pushed: string[] = []
/** Every client write the card made: [path, value]. */
let writes: Array<[string, Record<string, any>]> = []
/** Every POST the card made: [url, parsed body]. */
let posted: Array<[string, Record<string, any>]> = []
/** What the next POST answers with. */
let postAnswer = { ok: true, body: {} as Record<string, unknown> }
/** Every `enabled` the card asked the topic hook for, in order. */
let topicsEnabled: boolean[] = []
/** Whether the operator agrees to a destructive act. */
let confirmAccepts = true
const mockConfirm = jest.fn((_options?: Record<string, unknown>) =>
  confirmAccepts ? Promise.resolve(undefined) : Promise.reject(new Error('no')),
)

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/*
 * The barrel, kept REAL except for the confirmation: `CardDisplay` and the
 * overflow menu come from here and a stub would leave the assertions below
 * testing the stub. The default confirmation context answers `undefined`
 * rather than a promise, which the delete handler awaits.
 */
jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

/*
 * The topic catalog ANSWERS NOTHING UNLESS IT IS ASKED, so the gate itself is
 * assertable rather than only the picker's contents.
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
          ]
        : [],
    }
  },
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
  // The console address the assigned-records section links its rows with.
  useConsoleHostRoute: () => ({ orgSlug: 'acme', subdomain: 'store' }),
  // Signed in and able to mint an ID token: the delete posts through
  // `useCampaignManageApi`, which authorizes from one and issues nothing
  // without it.
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: async () => 'token' } }),
  useFirestoreDoc: (build: () => any) => {
    const built = build()
    const id = String(built?.path ?? '').split('/').pop() ?? ''
    return { data: containers[id], status: docStatus }
  },
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    for (const constraint of built?.constraints ?? []) {
      if (constraint?.where) filters.push(constraint)
      if (typeof constraint?.limit === 'number') limits.push(constraint.limit)
    }
    return {
      data:
        name === 'campaigns'
          ? sends
          : name === 'lists'
            ? [{ $id: 'list-1', name: 'Newsletter' }]
            : [],
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
  where: (field: string, op: string, value: unknown) => ({
    where: field,
    op,
    value,
  }),
  limit: (value: number) => ({ limit: value }),
  orderBy: (field: unknown) => ({ orderBy: field }),
  documentId: () => '__name__',
  doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
  updateDoc: async (ref: any, value: Record<string, any>) => {
    writes.push([String(ref?.path ?? ''), value])
  },
  /*
   * The sentinel, kept as a MARKER rather than flattened to undefined.
   * Clearing a topic must REMOVE the field — the model has no null topic and
   * the composer is handed it as `string | undefined` — and a double that
   * lost the distinction would let a write of `null` pass.
   */
  deleteField: () => ({ __delete: true }),
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
  useParams: () => ({ orgSlug: 'acme', host: 'store' }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

/**
 * Both children are stubbed at their module boundary.
 *
 * Their own behavior is covered by their own files; what this one asserts is
 * WHICH of them mounts, which is exactly the question a stub answers best —
 * the report card would otherwise open its two document listens and the
 * composer five more, which is the cost being asserted about.
 */
jest.mock('./campaign-report-card', () => ({
  __esModule: true,
  default: (props: any) => <div>{`send report for ${props.campaignId}`}</div>,
}))
jest.mock('@aglyn/plugins-email/components/campaign-composer', () => ({
  __esModule: true,
  default: (props: any) => (
    <div>{`composer for ${props.emailCampaignId}`}</div>
  ),
}))
/*
 * The two sections that answer for the campaign BEYOND its mail, stubbed at
 * their module boundary for the reason the composer is: they open an
 * aggregation count each and a per-email document read, which is cost this
 * file asserts nothing about. What belongs here is that they mount and are
 * handed the campaign's own send ids — the join both of them depend on.
 */
jest.mock('./campaign-reach-sections', () => ({
  __esModule: true,
  CampaignConversionsSection: (props: any) => (
    <div>{`caused by ${props.sendIds.join('|')}`}</div>
  ),
  CampaignDestinationsSection: (props: any) => (
    <div>{`destinations of ${props.sendIds.join('|')}`}</div>
  ),
  CampaignRevenueSection: (props: any) => (
    <div>{`earned by ${props.sendIds.join('|')}`}</div>
  ),
}))

import CampaignDetailCard from './campaign-detail-card'

beforeEach(() => {
  containers = {
    'camp-1': {
      name: 'Spring sale',
      startAtMs: Date.UTC(2026, 2, 1),
      endAtMs: Date.UTC(2026, 2, 31),
      listIds: ['list-1'],
    },
  }
  sends = [
    {
      $id: 'send-1',
      subject: 'First mailing',
      status: 'sent',
      sentAt: { seconds: 1_760_000_000 },
      stats: { sent: 100, recipients: 100, delivered: 98, uniqueOpens: 40 },
    },
    {
      $id: 'send-2',
      subject: 'Second mailing',
      status: 'sent',
      sentAt: { seconds: 1_770_000_000 },
      stats: { sent: 50, recipients: 50, delivered: 50, uniqueOpens: 5 },
    },
  ]
  filters = []
  limits = []
  pushed = []
  writes = []
  posted = []
  postAnswer = { ok: true, body: {} }
  topicsEnabled = []
  confirmAccepts = true
  mockConfirm.mockClear()
  docStatus = 'success'
  global.fetch = (async (url: string, init: any) => {
    posted.push([String(url), JSON.parse(String(init?.body ?? '{}'))])
    return { ok: postAnswer.ok, json: async () => postAnswer.body }
  }) as unknown as typeof fetch
})

/**
 * The value drawn beside one figure's label, in the shared figure block.
 *
 * `getAllByText`, because the emails table below carries column headers that
 * legitimately share three of these nouns — `Sent`, `Opens`, `Clicks` name a
 * campaign-wide total above and a per-email count below. The figure is the
 * occurrence whose sibling is the value; a column header's parent is a
 * `<tr>`, which has none.
 */
const figure = (label: string): string =>
  screen
    .getAllByText(label)
    .map((node) => node.parentElement?.querySelector('h6')?.textContent)
    .find((text): text is string => typeof text === 'string') ?? ''

/**
 * The page header's record slot, the shape `DashboardLayout` provides.
 *
 * The campaign's NAME is the page heading, not a card title: this surface is
 * mounted by the console shell's plugin route, which owns the heading and the
 * trail, so the name is published upward through `PageHeaderRecord`. A plugin
 * lib may not import console-app code, so the provider here stands in for it
 * and prints what it is handed.
 */
function ChromeHarness(props: { children: ReactNode }) {
  const [record, setRecord] = useState<PageHeaderRecordValue | null>(null)
  const value = useMemo(() => ({ setHeaderRecord: setRecord }), [])
  return (
    <PageHeaderRecordContext.Provider value={value}>
      <h1>{record?.title ?? 'Marketing'}</h1>
      {props.children}
    </PageHeaderRecordContext.Provider>
  )
}

/** The page heading, which on a campaign's page must be the campaign. */
const heading = () => screen.getByRole('heading', { level: 1 }).textContent

const mount = async (campaignId: string) => {
  render(
    <ChromeHarness>
      <div data-testid="surface-body">
        <CampaignDetailCard
          hostId="host-1"
          campaignId={campaignId}
          basePath="/acme/hosts/store/marketing"
        />
      </div>
    </ChromeHarness>,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('an id that names a campaign', () => {
  it('renders the campaign, its window and its lists', async () => {
    await mount('camp-1')

    // The NAME heads the page, not the card. A card titled with the record
    // beneath a page titled with the collection says the collection twice
    // and the record once, in the smaller of the two.
    expect(heading()).toBe('Spring sale')
    expect(screen.getByText('Newsletter')).toBeTruthy()
  })

  it('enumerates the campaign’s emails by the field each send carries', async () => {
    await mount('camp-1')

    expect(filters).toContainEqual({
      where: 'emailCampaignId',
      op: '==',
      value: 'camp-1',
    })
    expect(screen.getByText('First mailing')).toBeTruthy()
    expect(screen.getByText('Second mailing')).toBeTruthy()
  })

  it('rolls the figures up across every email', async () => {
    await mount('camp-1')

    // Read by LABEL, because two of these figures are legitimately equal and
    // a text query would pass while pointing at the wrong one.
    expect(figure('Addressed')).toBe('150')
    expect(figure('Sent')).toBe('150')
    expect(figure('Delivered')).toBe('148')
    // 45 distinct openers over the 148 delivered by the sends that recorded
    // deliveries at all.
    expect(screen.getByText('30.4%')).toBeTruthy()
  })

  it('shows an em dash where no email recorded a figure', async () => {
    sends = [{ $id: 'send-1', subject: 'Only', stats: { sent: 10 } }]
    await mount('camp-1')

    // Clicks were never recorded on any of these sends. A zero here would
    // read as "nobody clicked", which is a different claim.
    expect(figure('Clicks')).toBe('—')
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  it('presents the campaign as more than a list of its emails', async () => {
    /*
     * The emails are ONE section of the body. A campaign runs over a window,
     * against a set of audiences, and the conversions credited to it, the
     * money credited to it and the pages its links landed on are facts about
     * the campaign that no single message holds — so a body that was the
     * email table and nothing else said a campaign is that table.
     */
    await mount('camp-1')

    // All three sections are handed the campaign's own emails, newest first,
    // which is the only handle any of those collections joins on.
    expect(screen.getByText('caused by send-2|send-1')).toBeTruthy()
    /*
     * Revenue included, whatever the number of emails. The single-send report
     * answers the money question, and how many messages a container holds is
     * not a fact about whether its revenue is knowable.
     */
    expect(screen.getByText('earned by send-2|send-1')).toBeTruthy()
    expect(screen.getByText('destinations of send-2|send-1')).toBeTruthy()
    // And the email list is still there, named as one section among them.
    expect(screen.getByText('Emails (2)')).toBeTruthy()
  })

  it('opens each email on the SAME page every other route to it opens', async () => {
    /*
     * One record, one destination. This table used to send a reader to
     * `campaigns/{sendId}` — the aggregate report — while the Emails tab and
     * the template's messages table sent them to `emails/{sendId}`, the page
     * with the message preview, the list it went to and the per-recipient
     * tables. The same row clicked in two places opened two different pages,
     * and the poorer of them was the one reached from the campaign.
     */
    await mount('camp-1')

    // Newest first, so `send-2` is the first row.
    const rows = document.querySelectorAll('tbody tr')
    fireEvent.click(rows[0])

    expect(pushed).toContain('/acme/hosts/store/emails/messages/send-2')
    expect(pushed).not.toContain('/acme/hosts/store/marketing/campaigns/send-2')
  })

  it('the subject is a real link, and does not double-push', async () => {
    // A click handler offers nothing to a middle click, a ⌘-click, "Open link
    // in new tab", or "Copy link address" — so the subject is an anchor as
    // well as the row being clickable, and it stops the row's own handler
    // rather than pushing the same route twice.
    await mount('camp-1')

    const link = document
      .querySelectorAll('tbody tr')[1]
      .querySelector('a') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe(
      '/acme/hosts/store/emails/messages/send-1',
    )
    fireEvent.click(link)
    expect(pushed).toEqual([])
  })

  it('the email’s actions are in the overflow menu, not in the row', async () => {
    await mount('camp-1')

    // The affordance it replaced: a `Report` text button sitting in the row.
    expect(screen.queryByText('Report')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for Second mailing' }),
    )
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Open report', 'Open its template'])
    // And opening it does not open the email underneath it.
    expect(pushed).toEqual([])
  })

  it('nor does clicking the actions column beside the menu', async () => {
    /*
     * The menu BUTTON guards itself, so the assertion above passes with or
     * without the cell's own guard — and the cell is bigger than the button.
     * A press landing on the padding around it is a press inside a row whose
     * handler opens the email's report.
     */
    await mount('camp-1')

    const cells = document.querySelectorAll('tbody tr')[0].querySelectorAll('td')
    fireEvent.click(cells[cells.length - 1])
    expect(pushed).toEqual([])
  })

  it('a message built from a template opens it, as a real anchor', async () => {
    sends = [
      {
        $id: 'send-2',
        subject: 'From a design',
        templateScreenId: 'screen-9',
        stats: { sent: 1 },
      },
    ]
    await mount('camp-1')

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for From a design' }),
    )
    const linked = screen.getByRole('menuitem', { name: 'Open its template' })
    expect(linked.tagName).toBe('A')
    expect(linked.getAttribute('href')).toBe(
      '/acme/hosts/store/emails/templates/screen-9',
    )
  })

  it('a message built from NO template says so rather than hiding the item', async () => {
    // An absent control and an inapplicable one look identical, and only one
    // of them tells the reader which case they are in.
    sends = [{ $id: 'send-1', subject: 'Inline', stats: { sent: 1 } }]
    await mount('camp-1')

    fireEvent.click(
      screen.getByRole('button', { name: 'More actions for Inline' }),
    )
    const inert = screen.getByRole('menuitem', { name: 'Open its template' })
    expect(inert.getAttribute('aria-disabled')).toBe('true')
    // A disabled item is never an anchor: a link whose destination is refused
    // still navigates on a middle click, which is the one route around the
    // disabled state that `pointer-events: none` misses.
    expect(inert.tagName).not.toBe('A')
  })

  it('the numeric columns are right-aligned in the head AND the body', async () => {
    /*
     * A figure is read by its last digit, so a column of them lines up on the
     * right or it does not line up at all — and a header aligned one way over
     * cells aligned another is the defect this table was reported for.
     */
    await mount('camp-1')

    const headers = Array.from(document.querySelectorAll('thead th'))
    const cells = Array.from(
      document.querySelectorAll('tbody tr')[0].querySelectorAll('td'),
    )
    for (const index of [2, 3, 4]) {
      expect(headers[index].className).toMatch(/alignRight/)
      expect(cells[index].className).toMatch(/alignRight/)
    }
    // THE CONTROL: the text columns are not right-aligned, so the assertion
    // above is about alignment rather than about every cell in the table.
    expect(headers[0].className).not.toMatch(/alignRight/)
    expect(cells[0].className).not.toMatch(/alignRight/)
  })

  it('reads one email past the ceiling and says when the ceiling bit', async () => {
    /*
     * The window is bounded and cannot be ordered on any date — a sent send
     * carries `sentAt`, a scheduled one `sendAtMs`, and `orderBy` on either
     * would DROP the other half rather than mis-sort it. So the read is
     * document-name ordered, capped, and probes one past the cap: "this
     * campaign has more emails than are listed" is then a fact, and the
     * figures above the list say what they cover.
     */
    sends = Array.from({ length: 51 }, (_, index) => ({
      $id: `send-${String(index).padStart(2, '0')}`,
      subject: `Mailing ${index}`,
      status: 'sent',
      stats: { sent: 1 },
    }))
    await mount('camp-1')

    expect(limits).toContain(51)
    expect(screen.getByText(/It has sent more/)).toBeTruthy()
    // And the window is PAGED rather than poured onto the screen: the rows
    // drawn are one page of it, not all fifty.
    expect(screen.queryAllByText(/^Mailing \d+$/)).toHaveLength(
      TABLE_PAGE_SIZE_DEFAULT,
    )
  })

  it('does NOT mount the composer until it is asked for', async () => {
    await mount('camp-1')
    expect(screen.queryByText('composer for camp-1')).toBeNull()

    fireEvent.click(screen.getByText('Write an email'))

    await waitFor(() =>
      expect(screen.getByText('composer for camp-1')).toBeTruthy(),
    )
  })
})

describe('an id that names a SEND', () => {
  it('falls through to the send’s own report', async () => {
    /*
     * The URL guarantee. `/marketing/campaigns/{sendId}` is what every report
     * link minted before campaigns became containers points at, and those
     * links live in merchants' own messages.
     */
    await mount('legacy-send')

    expect(screen.getByText('send report for legacy-send')).toBeTruthy()
  })

  it('renders NOTHING while the container read is still settling', async () => {
    /*
     * Falling through the moment the document reads as absent would render
     * the send report on every open of a campaign that exists, and that card
     * says "this campaign could not be loaded" until its own read lands. The
     * fallback is a decision about a settled read.
     */
    docStatus = 'loading'
    containers = {}
    await mount('camp-1')

    expect(screen.queryByText('send report for camp-1')).toBeNull()
    // The SURFACE, not the whole document: the chrome around it belongs to
    // the console shell, and the heading it draws is the surface's own name
    // until this read settles and a campaign can replace it.
    expect(screen.getByTestId('surface-body').textContent).toBe('')
    expect(heading()).toBe('Marketing')
  })

  it('goes on resolving even though nothing in the console links here any more', async () => {
    /*
     * THE URL GUARANTEE, held on its own rather than as a side effect of the
     * test above.
     *
     * Every in-app route to one email now opens `emails/{sendId}` — the
     * campaign's own table converged on it with the Emails tab and the
     * template page. That is a change to the links the console GENERATES, and
     * this asserts it changed nothing about which URLs ANSWER.
     *
     * It has to keep answering forever. `cid={sendId}` is inside the HMAC of
     * every unsubscribe footer already delivered, those messages sit in
     * inboxes indefinitely, and a merchant may have pasted this URL into
     * their own mail about last week's send. There is deliberately no
     * redirect: a redirect is a second thing to be wrong about an id that is
     * inside a signature, and a page that keeps working has nothing to get
     * wrong.
     */
    docStatus = 'success'
    containers = {}
    await mount('legacy-send')

    expect(screen.getByText('send report for legacy-send')).toBeTruthy()
    // And nothing was pushed: the URL RESOLVES, it does not bounce.
    expect(pushed).toEqual([])
  })
})

/*==========================================
 * EDITING A CAMPAIGN, ON THE CAMPAIGN'S OWN PAGE.
 *
 * Everything a container holds is editable, and nothing it holds describes
 * mail that has been delivered — that lives on the SENDS, which record their
 * own subject, audience and topic at send time and are never rewritten. So
 * unlike an email, where only the console-only display name survives the
 * send, a campaign has no field that could come to disagree with an inbox.
 *=========================================*/
describe('editing a campaign', () => {
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const openEditor = async () => {
    await mount('camp-1')
    fireEvent.click(
      // BY NAME. The emails table below carries a menu per row, and the
      // header's is the one labelled with the campaign.
      screen.getByRole('button', { name: 'More actions for Spring sale' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit campaign' }))
    await settle()
  }

  const field = (label: string) =>
    screen.getByLabelText(label) as HTMLInputElement

  it('is reached from the page’s own overflow, never from the table', async () => {
    await mount('camp-1')
    fireEvent.click(
      // BY NAME. The emails table below carries a menu per row, and the
      // header's is the one labelled with the campaign.
      screen.getByRole('button', { name: 'More actions for Spring sale' }),
    )
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual(['Edit campaign', 'Delete campaign'])
  })

  it('opens on the campaign as stored', async () => {
    await openEditor()
    expect(field('Name').value).toBe('Spring sale')
    // UTC, matching the writer: reading a UTC-midnight date back in local
    // time shows the previous day to everyone west of Greenwich, which is a
    // campaign changing its own start date by being opened.
    expect(field('Starts').value).toBe('2026-03-01')
    expect(field('Ends').value).toBe('2026-03-31')
  })

  it('saves the container with the client SDK, as the create does', async () => {
    await openEditor()
    fireEvent.change(field('Name'), { target: { value: 'Spring clearance' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }))
    await settle()

    expect(writes).toHaveLength(1)
    const [path, value] = writes[0]
    // The CONTAINER collection. The send collection is untouched, which is
    // what leaves every delivered `cid` resolving.
    expect(path).toBe('hosts/host-1/emailCampaigns/camp-1')
    expect(value.name).toBe('Spring clearance')
  })

  it('writes a cleared date as null, which is the absence the model spells', async () => {
    await openEditor()
    fireEvent.change(field('Ends'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }))
    await settle()

    expect(writes[0][1].endAtMs).toBeNull()
    expect(writes[0][1].startAtMs).toBe(Date.UTC(2026, 2, 1))
  })

  it('REMOVES a cleared topic rather than storing a null one', async () => {
    // The model has no null topic and the composer is handed it as
    // `string | undefined`; a stored null would reach the picker as a value.
    await openEditor()
    fireEvent.click(screen.getByRole('button', { name: 'Save campaign' }))
    await settle()

    expect(writes[0][1].topicId).toEqual({ __delete: true })
  })

  it('refuses a window that ends before it starts', async () => {
    // Refused in the form rather than stored: no window state describes a
    // campaign that ends before it starts, so it would draw as "Ended" from
    // the day it was made.
    await openEditor()
    fireEvent.change(field('Ends'), { target: { value: '2026-01-01' } })

    expect(
      screen.getByRole('button', { name: 'Save campaign' }),
    ).toHaveProperty('disabled', true)
    expect(writes).toHaveLength(0)
  })

  it('refuses a campaign with no name', async () => {
    await openEditor()
    fireEvent.change(field('Name'), { target: { value: '  ' } })
    expect(
      screen.getByRole('button', { name: 'Save campaign' }),
    ).toHaveProperty('disabled', true)
  })

  /*
   * The topic catalog is 200 documents filling one picker inside a drawer
   * nobody has opened. A reader who came for the campaign's numbers must not
   * pay for it — the same rule the composer below already follows.
   */
  it('does not read the topic catalog until the drawer opens', async () => {
    await mount('camp-1')
    expect(topicsEnabled.length).toBeGreaterThan(0)
    expect(topicsEnabled.some((enabled) => enabled)).toBe(false)

    fireEvent.click(
      // BY NAME. The emails table below carries a menu per row, and the
      // header's is the one labelled with the campaign.
      screen.getByRole('button', { name: 'More actions for Spring sale' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit campaign' }))
    await settle()
    expect(topicsEnabled.some((enabled) => enabled)).toBe(true)
  })
})

/*==========================================
 * DELETING A CAMPAIGN FROM ITS OWN PAGE.
 *
 * What survives a delete is `campaign-manage.spec.ts`, against the route that
 * does it. What belongs here is the half the page owns: that it asks first,
 * says what is KEPT and what is not stopped, posts rather than writing, and
 * leaves the page it has just removed.
 *=========================================*/
describe('deleting a campaign', () => {
  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const pressDelete = async () => {
    fireEvent.click(
      // BY NAME. The emails table below carries a menu per row, and the
      // header's is the one labelled with the campaign.
      screen.getByRole('button', { name: 'More actions for Spring sale' }),
    )
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete campaign' }))
    await settle()
  }

  it('names what is KEPT before it asks', async () => {
    await mount('camp-1')
    await pressDelete()

    const options = mockConfirm.mock.calls[0][0] as Record<string, any>
    expect(String(options.description)).toMatch(/2 emails in it are kept/i)
    expect(String(options.description)).toMatch(/unsubscribe links/i)
  })

  it('says a scheduled email still goes out', async () => {
    // Deleting a campaign groups nothing; it does not cancel anything.
    sends = [
      {
        $id: 'due-friday',
        subject: 'Due Friday',
        status: 'scheduled',
        sendAtMs: Date.UTC(2026, 5, 5),
      },
    ]
    await mount('camp-1')
    await pressDelete()

    expect(String(mockConfirm.mock.calls[0][0]?.description)).toMatch(
      /still going out or still due/i,
    )
  })

  it('posts, rather than writing the container away from the client', async () => {
    await mount('camp-1')
    await pressDelete()

    expect(writes).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect(posted[0][0]).toBe('/api/campaigns/manage')
    expect(posted[0][1]).toMatchObject({
      hostId: 'host-1',
      action: 'deleteCampaign',
      campaignId: 'camp-1',
    })
  })

  it('returns to the campaigns list once it is gone', async () => {
    await mount('camp-1')
    await pressDelete()
    expect(pushed).toContain('/acme/hosts/store/marketing/campaigns')
  })

  it('posts NOTHING when the operator cancels', async () => {
    confirmAccepts = false
    await mount('camp-1')
    await pressDelete()

    expect(mockConfirm).toHaveBeenCalled()
    expect(posted).toHaveLength(0)
    expect(pushed).not.toContain('/acme/hosts/store/marketing/campaigns')
  })

  it('stays put and says nothing was removed when the route refuses', async () => {
    postAnswer = { ok: false, body: { error: 'Unknown campaign' } }
    await mount('camp-1')
    await pressDelete()

    expect(pushed).not.toContain('/acme/hosts/store/marketing/campaigns')
  })
})

/*==========================================
 * A CAMPAIGN'S EMAILS TABLE SAYS WHAT EACH ONE IS DOING.
 *
 * An email delivering an audience larger than one batch is stored as
 * `scheduled` between runs, so a cell branching on the status read
 * "Scheduled" about a send that had already delivered five hundred messages.
 *=========================================*/
describe('the state of each email in the campaign', () => {
  const stateCells = () =>
    Array.from(document.querySelectorAll('tbody tr')).map((row) =>
      String(row.querySelectorAll('td')[1]?.textContent ?? ''),
    )

  it('says a mid-flight send is SENDING, with the count', async () => {
    sends = [
      {
        $id: 'big',
        subject: 'Big one',
        status: 'scheduled',
        stats: { sent: 500, audienceSize: 3000 },
        resume: { remaining: 2500, batch: 1, nextAtMs: Date.now() + 60_000 },
      },
    ]
    await mount('camp-1')
    expect(stateCells()[0]).toBe('Sending — reached 500 of 3,000')
  })

  it('still says Scheduled, with the time, for one that has sent nothing', async () => {
    // THE CONTROL, and the one case where a due date answers the question.
    sends = [
      {
        $id: 'later',
        subject: 'Due Friday',
        status: 'scheduled',
        sendAtMs: Date.UTC(2026, 5, 5),
      },
    ]
    await mount('camp-1')
    expect(stateCells()[0]).toMatch(/^Scheduled · /)
  })

  it('orders a draft by when it was created, not last', async () => {
    sends = [
      {
        $id: 'sent-1',
        subject: 'Went out',
        status: 'sent',
        sentAt: { seconds: Date.UTC(2026, 2, 1) / 1000 },
      },
      {
        $id: 'draft-1',
        subject: 'Half-written',
        status: 'draft',
        createdAtMs: Date.UTC(2026, 6, 1),
      },
    ]
    await mount('camp-1')
    const subjects = Array.from(document.querySelectorAll('tbody tr')).map(
      (row) => String(row.querySelector('a')?.textContent ?? ''),
    )
    expect(subjects).toEqual(['Half-written', 'Went out'])
  })
})

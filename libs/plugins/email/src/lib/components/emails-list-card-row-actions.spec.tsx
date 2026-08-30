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
 * 6. DISCARD removes a draft and nothing else. It is the one entry that
 *    WRITES, and the only email it may ever remove is one that has reached
 *    nobody — a sent message's report is evidence, and its id is inside the
 *    HMAC of every unsubscribe link it delivered.
 * 7. The ROW ORDER, which belongs here rather than in a file of its own for
 *    one reason: the fixture above already holds the three kinds of record
 *    whose ordering is in question — a draft with only a creation date, a
 *    send with a `sentAt`, and one written before either stamp — and a second
 *    copy of this harness would be a second thing to keep in step.
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
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

jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  // The card reports a failed create through a snackbar. The console mounts
  // this provider at its root and no test tree has it, so without the mock
  // the hook answers null and the card cannot render at all.
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  // Nobody signed in. The card's create action posts through
  // `useCampaignSendApi`, which reads the user to mint a token; no test here
  // creates, so the hook only has to exist.
  useUser: () => ({ data: null }),
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
  // Resolves, or REJECTS — `confirm` rejects on cancel (AGL-950), and a
  // handler gated on the resolved value alone would discard on both paths.
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

/** Whether the operator agrees, moved between cases. */
let confirmAccepts = true
const mockConfirm = jest.fn((_options?: Record<string, unknown>) =>
  confirmAccepts ? Promise.resolve(undefined) : Promise.reject(new Error('no')),
)

/** Every POST the card made: [url, parsed body]. */
let posted: Array<[string, Record<string, any>]> = []
/** What the next POST answers with. */
let postAnswer = { ok: true, body: {} as Record<string, unknown> }

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
  confirmAccepts = true
  posted = []
  postAnswer = { ok: true, body: {} }
  global.fetch = (async (url: string, init: any) => {
    posted.push([String(url), JSON.parse(String(init?.body ?? '{}'))])
    return {
      ok: postAnswer.ok,
      json: async () => postAnswer.body,
    }
  }) as unknown as typeof fetch
  emailDocs = [
    {
      // Never sent to anybody, which is the only email discard may remove.
      $id: 'msg-draft',
      subject: 'Half-written',
      status: 'draft',
      createdAtMs: Date.UTC(2026, 7, 25),
    },
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
  it('offers the report, the campaign, the template and discard', async () => {
    await mountCard()
    openMenuFor('Spring sale')
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent),
    ).toEqual([
      'Open report',
      'Open its campaign',
      'Open its template',
      'Discard draft',
    ])
  })

  it('all three are anchors carrying real hrefs', async () => {
    await mountCard()
    openMenuFor('Spring sale')
    const hrefs = screen
      .getAllByRole('menuitem')
      .slice(0, 3)
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

/*==========================================
 * DISCARD, AND WHAT IT REFUSES.
 *
 * The menu's refusal is not the rule — the route decides, inside the
 * transaction that deletes — but it is the rule a merchant READS, and an
 * entry that offers to remove a sent email is a promise this product must
 * never make.
 *=========================================*/
describe('discarding a draft from the row', () => {
  const discardItem = () =>
    screen
      .getAllByRole('menuitem')
      .find((item) => item.textContent === 'Discard draft') as HTMLElement

  const settle = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  /**
   * The refusal a merchant actually reads.
   *
   * `disabledReason` is a `Tooltip` around the item, not a `title` attribute
   * — a disabled item takes no pointer events, so the reason lives on a
   * wrapper — and a tooltip renders nothing until it is entered. Asserting on
   * the item's own attributes would therefore pass for a reason that never
   * appears on screen.
   */
  const refusalFor = async (subject: string) => {
    openMenuFor(subject)
    const item = discardItem()
    fireEvent.mouseOver(item.parentElement as HTMLElement)
    await waitFor(() => expect(screen.getAllByRole('tooltip').length).toBe(1))
    return String(screen.getByRole('tooltip').textContent)
  }

  it('is offered on a draft', async () => {
    await mountCard()
    openMenuFor('Half-written')
    expect(discardItem().getAttribute('aria-disabled')).toBeNull()
  })

  it('is refused on a SENT message, with the reason on the item', async () => {
    await mountCard()
    expect(await refusalFor('Spring sale')).toMatch(/has been sent/i)
    expect(discardItem().getAttribute('aria-disabled')).toBe('true')
  })

  it('names cancelling as the next step for a SCHEDULED email', async () => {
    // Not the same refusal as a sent one: cancelling keeps the record and
    // takes it off the clock, and a merchant told only "you cannot" is left
    // with an email they wanted rid of and no next step.
    emailDocs = [
      {
        $id: 'msg-later',
        subject: 'Due Friday',
        status: 'scheduled',
        sendAtMs: 2_000_000_000_000,
      },
    ]
    await mountCard()
    expect(await refusalFor('Due Friday')).toMatch(/cancel the send first/i)
  })

  it('asks first, and posts to the manage route once agreed', async () => {
    await mountCard()
    openMenuFor('Half-written')
    fireEvent.click(discardItem())
    await settle()

    expect(mockConfirm).toHaveBeenCalled()
    expect(posted).toHaveLength(1)
    expect(posted[0][0]).toBe('/api/campaigns/manage')
    expect(posted[0][1]).toMatchObject({
      hostId: 'host-1',
      action: 'discardEmail',
      campaignId: 'msg-draft',
    })
  })

  it('posts NOTHING when the operator cancels', async () => {
    confirmAccepts = false
    await mountCard()
    openMenuFor('Half-written')
    fireEvent.click(discardItem())
    await settle()

    expect(mockConfirm).toHaveBeenCalled()
    expect(posted).toHaveLength(0)
  })

  it('is not an anchor while refused', async () => {
    // A link whose destination is refused still navigates on a middle click,
    // which is the one route around the disabled state `pointer-events` misses.
    await mountCard()
    openMenuFor('Spring sale')
    expect(discardItem().tagName).not.toBe('A')
  })
})

/*==========================================
 * DRAFTS SORT BY WHEN THEY WERE CREATED.
 *
 * A draft carries neither `sentAt` nor `sendAtMs`, so ordering on the send
 * time alone gave every one of them the key 0 — the email a merchant is in
 * the middle of writing, at the very bottom of the list, behind whatever
 * paging it has.
 *=========================================*/
describe('the newest thing is at the top', () => {
  const subjects = () =>
    Array.from(document.querySelectorAll('tbody tr')).map((row) =>
      String(row.querySelector('a')?.textContent ?? ''),
    )

  it('puts a draft created after the last send ABOVE it', async () => {
    await mountCard()
    expect(subjects()).toEqual([
      'Half-written',
      'Spring sale',
      'Last week’s news',
    ])
  })

  it('does NOT re-date a sent message from its creation', async () => {
    /*
     * THE CONTROL, and the half that is easy to break while fixing the
     * other: an email drafted in March and sent in June belongs in June. A
     * fallback applied in the wrong order would sort this one by the day
     * somebody started writing it.
     */
    emailDocs = [
      {
        $id: 'msg-old-draft',
        subject: 'Started in March, sent in June',
        status: 'sent',
        createdAtMs: Date.UTC(2026, 2, 1),
        sentAt: { seconds: Date.UTC(2026, 5, 1) / 1000 },
      },
      {
        $id: 'msg-april',
        subject: 'Sent in April',
        status: 'sent',
        createdAtMs: Date.UTC(2026, 3, 1),
        sentAt: { seconds: Date.UTC(2026, 3, 2) / 1000 },
      },
    ]
    await mountCard()
    expect(subjects()).toEqual([
      'Started in March, sent in June',
      'Sent in April',
    ])
  })

  it('sorts a draft with no creation stamp last, as it always did', async () => {
    // The backfill has not run everywhere, and a record with no date of any
    // kind must not be dated from nothing.
    emailDocs = [
      { $id: 'msg-undated', subject: 'No dates at all', status: 'draft' },
      {
        $id: 'msg-sent',
        subject: 'Went out',
        status: 'sent',
        sentAt: { seconds: 1_700 },
      },
    ]
    await mountCard()
    expect(subjects()).toEqual(['Went out', 'No dates at all'])
  })
})

/*==========================================
 * A ROW SAYS WHAT THE EMAIL IS DOING.
 *
 * An audience larger than one batch goes out over several runs, and between
 * them the email is stored as `scheduled` — the state the processor claims to
 * resume it. A chip rendering the status said "Scheduled" about a send that
 * had already delivered five hundred messages, which tells a merchant nothing
 * went out when thousands did.
 *=========================================*/
describe('what the state chip says', () => {
  const chipFor = (subject: string) =>
    String(rowFor(subject).querySelectorAll('td')[1]?.textContent ?? '')

  it('says a mid-flight campaign is SENDING, with the count', async () => {
    emailDocs = [
      {
        $id: 'msg-big',
        subject: 'Big one',
        status: 'scheduled',
        stats: { sent: 500, audienceSize: 3000 },
        resume: { remaining: 2500, batch: 1, nextAtMs: 2_000_000_000_000 },
      },
    ]
    await mountCard()
    expect(chipFor('Big one')).toBe('Sending — reached 500 of 3,000')
    expect(chipFor('Big one')).not.toMatch(/scheduled/i)
  })

  it('still says Scheduled for one that has delivered nothing', async () => {
    // THE CONTROL: the pre-batching meaning of `scheduled` is the common one
    // and must survive the fix, or the lie has only moved.
    emailDocs = [
      {
        $id: 'msg-later',
        subject: 'Due Friday',
        status: 'scheduled',
        sendAtMs: 2_000_000_000_000,
      },
    ]
    await mountCard()
    expect(chipFor('Due Friday')).toBe('Scheduled')
  })

  it('says Draft for a draft rather than "Sent to 0"', async () => {
    await mountCard()
    expect(chipFor('Half-written')).toBe('Draft')
  })

  it('names the shortfall on a send that stopped part way', async () => {
    emailDocs = [
      {
        $id: 'msg-stopped',
        subject: 'Stopped short',
        status: 'canceled',
        stats: { sent: 1500, audienceSize: 3000 },
        resume: { remaining: 1500, batch: 3 },
      },
    ]
    await mountCard()
    expect(chipFor('Stopped short')).toMatch(/1,500 not addressed/)
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

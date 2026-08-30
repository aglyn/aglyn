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
 * `/emails/campaigns/{id}` addressed a single SEND for as long as it has
 * existed, and it is linkable by design — the console's own comment says a
 * merchant pastes it into a message about last week's send. Now that a
 * campaign is a container, the same path also addresses a container.
 *
 * The id is therefore answered by READING: a container renders the campaign,
 * and anything else falls through to the send's own report exactly as before.
 * That fallback is the whole migration story — no send document was rewritten
 * and no id reassigned, so every unsubscribe link already in an inbox (each
 * carrying `cid={sendId}` inside its signature) resolves untouched.
 *
 * The other thing this file holds down is the cost the campaign route was
 * split out to avoid: the composer opens listens of its own, and a reader who
 * came for numbers must not pay for one.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
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
jest.mock('./campaign-composer', () => ({
  __esModule: true,
  default: (props: any) => (
    <div>{`composer for ${props.emailCampaignId}`}</div>
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
  docStatus = 'success'
})

/** The value drawn beside one figure's label, in the shared figure block. */
const figure = (label: string): string =>
  screen.getByText(label).parentElement?.querySelector('h6')?.textContent ?? ''

const mount = async (campaignId: string) => {
  render(
    <CampaignDetailCard
      hostId="host-1"
      campaignId={campaignId}
      basePath="/acme/hosts/store/emails"
    />,
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('an id that names a campaign', () => {
  it('renders the campaign, its window and its lists', async () => {
    await mount('camp-1')

    expect(screen.getByText('Spring sale')).toBeTruthy()
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

  it('links each email to its own report', async () => {
    await mount('camp-1')

    fireEvent.click(screen.getAllByText('Report')[0])

    expect(pushed).toContain('/acme/hosts/store/emails/campaigns/send-2')
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
     * The URL guarantee. `/emails/campaigns/{sendId}` is what every report
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
    expect(document.body.textContent).toBe('')
  })
})

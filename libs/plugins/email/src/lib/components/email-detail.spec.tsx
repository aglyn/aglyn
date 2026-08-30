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
 * ONE MESSAGE'S PAGE.
 *
 * Three things are worth holding here and are held nowhere else: the preview
 * says it is the template as it stands NOW rather than a record of what went
 * out, every rate carries its denominator, and the page names where the
 * message went — the campaign, and the list as the SEND recorded it.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { CampaignStats } from '../model/campaign-report'

const mockDocs = new Map<string, unknown>()
const mockEnqueue = jest.fn()

jest.mock('firebase/firestore', () => ({
  __esModule: true,
  doc: (_db: unknown, ...segments: string[]) => ({
    __path: segments.join('/'),
  }),
}))

/*
 * The two app-shell contexts the page's "send to more recipients" control
 * needs. Both are providers the console mounts at its root and no test tree
 * has; without them the hooks answer `null` and the page cannot render at
 * all, which would turn every assertion in this file into a test of the
 * harness. `confirm` REJECTS by default — declining is the safe answer for a
 * control whose confirmed branch mails people — so no test here can send by
 * accident.
 */
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  __esModule: true,
  useSnackbar: () => ({ enqueueSnackbar: mockEnqueue }),
}))

jest.mock('@aglyn/shared-ui-jsx', () => ({
  ...jest.requireActual('@aglyn/shared-ui-jsx'),
  useConfirmationContext: () => ({ confirm: () => Promise.reject() }),
}))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  __esModule: true,
  useFirestore: () => ({ __firestore: true }),
  // Nobody signed in, so the recipients card never issues its request.
  useUser: () => ({ data: null }),
  useFirestoreDoc: (build: () => { __path?: string } | null) => {
    const path = build()?.__path ?? ''
    const data = mockDocs.get(path)
    return { data, status: data === undefined ? 'error' : 'success' }
  },
}))

/**
 * The composer, recorded rather than mounted.
 *
 * The email's page mounts it for a draft or a scheduled email, and the real
 * one opens four listens of its own against hooks no tree here provides. What
 * belongs in this file is WHETHER the page offers a composer for a given
 * state, not what the composer does once it has one.
 */
jest.mock('./campaign-composer', () => ({
  __esModule: true,
  default: (props: any) => {
    composerProps = props
    return <div>{'composer mounted'}</div>
  },
}))

/** The props the composer was mounted with, or null while it is not. */
let composerProps: Record<string, any> | null = null

const EMAIL_PATH = 'hosts/site1/campaigns/msg_1'
const LINKS_PATH = 'hosts/site1/campaigns/msg_1/reports/links'
const TEMPLATE_PATH = 'hosts/site1/screens/scr_1'
const TEMPLATE_VERSION_PATH = 'hosts/site1/screens/scr_1/versions/ver_1'

/** Rooted at `_@_`, the id the besigner really writes. */
const NODES = {
  '_@_': { componentId: 'emailSection', nodes: ['t1'] },
  t1: { componentId: 'emailText', props: { children: 'Spring is here' } },
}

/** 100 sent, 90 delivered — two different numbers to divide by. */
const STATS: CampaignStats = {
  recipients: 100,
  sent: 100,
  delivered: 90,
  opens: 60,
  uniqueOpens: 45,
  clicks: 12,
  uniqueClicks: 9,
  bounced: 10,
  complained: 3,
  unsubscribes: 6,
  clickTracked: true,
}

async function renderEmail(options?: {
  email?: Record<string, unknown> | null
  links?: unknown
}): Promise<void> {
  mockDocs.clear()
  composerProps = null
  if (options?.email !== null) {
    mockDocs.set(EMAIL_PATH, {
      subject: 'Spring sale',
      status: 'sent',
      audience: 'list',
      listId: 'list_1',
      listName: 'Newsletter',
      templateScreenId: 'scr_1',
      sentAt: { toMillis: () => 1_700_000_000_000 },
      stats: STATS,
      ...options?.email,
    })
  }
  if (options?.links) mockDocs.set(LINKS_PATH, options.links)
  mockDocs.set(TEMPLATE_PATH, {
    displayName: 'Spring promo',
    versionId: 'ver_1',
  })
  mockDocs.set(TEMPLATE_VERSION_PATH, { nodes: NODES })
  const { EmailDetail } = await import('./email-detail')
  render(
    (
      <EmailDetail
        hostId="site1"
        emailId="msg_1"
        basePath="/acme/hosts/site/emails"
      />
    ) as ReactNode as never,
  )
}

describe('a message previews its template, and says which template', () => {
  it('draws the send path’s own HTML in a fully sandboxed frame', async () => {
    await renderEmail()
    const frame = document.querySelector('iframe[title="Email preview"]')
    expect(frame?.getAttribute('sandbox')).toBe('')
    expect(frame?.getAttribute('srcdoc')).toContain('Spring is here')
  })

  it('says the preview is the template TODAY, not what was mailed', async () => {
    await renderEmail()
    // The mail is rendered per recipient at send time and not kept, so a
    // template edited since previews as it is now. A reader taking this for a
    // record of what went out is the failure this line exists to stop.
    expect(screen.getByText(/template as it stands today/i)).toBeTruthy()
  })

  it('draws the synthesized HTML for a message written as plain text', async () => {
    // A plain-text message is not previewless: the send path synthesizes an
    // HTML part for it, and that part is what the inbox received. Reporting
    // "nothing to draw" would describe the composer rather than the mail.
    await renderEmail({
      email: { templateScreenId: undefined, body: 'Hello from the composer.' },
    })
    const frame = document.querySelector(
      'iframe[title="Email preview"]',
    ) as HTMLIFrameElement | null
    expect(frame).toBeTruthy()
    expect(frame?.getAttribute('srcdoc')).toContain('Hello from the composer.')
  })

  it('has nothing to draw only when there is no body either', async () => {
    // The control. A frame drawn for an empty body would be an empty frame
    // presented as the mail, which is worse than saying so.
    await renderEmail({ email: { templateScreenId: undefined, body: '' } })
    expect(document.querySelector('iframe[title="Email preview"]')).toBeNull()
    expect(screen.getByText(/carries no body/i)).toBeTruthy()
  })
})

describe('a message names where it went', () => {
  it('links the campaign it belongs to', async () => {
    await renderEmail()
    const link = screen.getByText('Open the campaign').closest('a')
    expect(link?.getAttribute('href')).toBe(
      '/acme/hosts/site/emails/campaigns/msg_1',
    )
  })

  it('names the list as the SEND recorded it', async () => {
    await renderEmail()
    expect(screen.getByText('Newsletter')).toBeTruthy()
  })

  it('never prints a list id as if it were a list name', async () => {
    await renderEmail({ email: { listName: undefined } })
    expect(screen.queryByText('list_1')).toBeNull()
    expect(screen.getByText(/did not name/i)).toBeTruthy()
  })

  it('links the template it was built from', async () => {
    await renderEmail()
    const link = screen.getByText('Spring promo').closest('a')
    expect(link?.getAttribute('href')).toBe(
      '/acme/hosts/site/emails/templates/scr_1',
    )
  })
})

describe('a message report names its denominators on screen', () => {
  it('renders the open rate beside "45 of 90 delivered"', async () => {
    await renderEmail()
    expect(screen.getByText('Open rate')).toBeTruthy()
    expect(screen.getByText('45 of 90 delivered')).toBeTruthy()
  })

  it('takes the bounce rate over SENT, not over delivered', async () => {
    await renderEmail()
    expect(screen.getByText('10 of 100 sent')).toBeTruthy()
  })

  it('shows an unrecorded delivered count as a dash, never as zero', async () => {
    await renderEmail({ email: { stats: { sent: 100, opens: 4 } } })
    expect(screen.getByText('Delivered')).toBeTruthy()
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0)
  })

  it('gives each link its share over the clicks that table counted', async () => {
    await renderEmail({
      links: {
        links: {
          k1: { url: 'https://acme.test/spring', clicks: 8 },
          k2: { url: 'https://acme.test/sale', clicks: 2 },
        },
      },
    })
    expect(screen.getByText('https://acme.test/spring')).toBeTruthy()
    expect(screen.getByText('80.0% of 10 link clicks counted')).toBeTruthy()
  })

  it('distinguishes a message it cannot read from one with no engagement', async () => {
    await renderEmail({ email: null })
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy()
    expect(screen.queryByText('Open rate')).toBeNull()
  })
})

/**
 * SENDING AN EMAIL THAT HAS ALREADY GONE OUT TO MORE PEOPLE.
 *
 * The page's part of the feature is small, and the two halves that matter are
 * both refusals: it is offered only where it means something, and it counts
 * before it asks. Everything else — who is left, who is suppressed, whether
 * there is allowance and hourly room — belongs to the send path and is held
 * in `campaign-follow-up.spec.ts`.
 */
describe('an email that has been sent can reach more people', () => {
  it('offers the control on a sent email', async () => {
    await renderEmail()
    expect(screen.getByText('Send to more recipients')).toBeTruthy()
  })

  it('does NOT offer it on a scheduled email', async () => {
    // Nothing has gone out, so "more" names nobody. The route refuses it, and
    // being refused is a worse way to learn that than not being offered it.
    await renderEmail({
      email: { status: 'scheduled', sentAt: undefined, sendAtMs: 1 },
    })
    expect(screen.queryByText('Send to more recipients')).toBeNull()
  })

  it('does NOT offer it on a canceled email', async () => {
    await renderEmail({ email: { status: 'canceled' } })
    expect(screen.queryByText('Send to more recipients')).toBeNull()
  })

  it('counts before it asks, and asks before it sends', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sendable: 12, alreadyReached: 88 }),
    }))
    ;(globalThis as any).fetch = fetchMock
    await renderEmail()

    await act(async () => {
      fireEvent.click(screen.getByText('Send to more recipients'))
    })

    // Exactly ONE request, and it is the READ. The confirmation rejects in
    // this harness, so a second request would be a send nobody agreed to.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body))
    expect(body).toMatchObject({
      action: 'followUp',
      campaignId: 'msg_1',
      dryRun: true,
    })
  })

  it('says nothing was sent when the whole audience already has it', async () => {
    ;(globalThis as any).fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sendable: 0, alreadyReached: 100 }),
    }))
    await renderEmail()

    await act(async () => {
      fireEvent.click(screen.getByText('Send to more recipients'))
    })

    expect(mockEnqueue).toHaveBeenCalledWith(
      'Everyone in this audience already has this email',
      expect.anything(),
    )
  })

  it('says how many sends an email has had, so its figures are not read as one mailing', async () => {
    await renderEmail({
      email: {
        sendCount: 3,
        lastSentAt: { toMillis: () => 1_700_100_000_000 },
      },
    })
    expect(screen.getByText(/^3, most recently/)).toBeTruthy()
  })

  it('says nothing about sends for an email that has only had one', async () => {
    await renderEmail()
    expect(screen.queryByText(/most recently/)).toBeNull()
  })
})

/*==========================================
 * WHAT EACH STATE OFFERS.
 *
 * The page is the one place an email is edited, sent, scheduled or withdrawn,
 * so the set of controls it offers IS the model. Every assertion below is
 * about which acts are possible on an email in a given state — and, as often,
 * which are not: sending now and scheduling are meaningless on mail that is
 * already in inboxes, and offering them would let a merchant discover that
 * from a refusal rather than from the page.
 *=========================================*/

/** The kebab menu the header's secondary actions live in. */
const openOverflow = () => {
  fireEvent.click(screen.getByRole('button', { name: /More actions/i }))
}

/** The labels currently in that menu. */
const overflowLabels = (): (string | null)[] =>
  screen.getAllByRole('menuitem').map((item) => item.textContent)

describe('sending an email that has not gone out', () => {
  it('offers Send now on a scheduled email', async () => {
    await renderEmail({
      email: { status: 'scheduled', sentAt: undefined, sendAtMs: 1 },
    })
    expect(screen.getByText('Send now')).toBeTruthy()
  })

  it('offers Send now on a draft', async () => {
    await renderEmail({
      email: { status: 'draft', sentAt: undefined, stats: undefined },
    })
    expect(screen.getByText('Send now')).toBeTruthy()
  })

  it('does NOT offer Send now on a SENT email', async () => {
    /*
     * The whole point of the split. A sent email's mail is already delivered,
     * so "send now" would mean mailing the entire audience a second copy —
     * which is what "Send to more recipients" does safely, minus everyone
     * already reached.
     */
    await renderEmail()
    expect(screen.queryByText('Send now')).toBeNull()
    expect(screen.getByText('Send to more recipients')).toBeTruthy()
  })

  it('does NOT offer Send now on a canceled email', async () => {
    // Withdrawn on purpose. Sending it is the resurrect path this model does
    // not have.
    await renderEmail({ email: { status: 'canceled' } })
    expect(screen.queryByText('Send now')).toBeNull()
  })

  it('counts before it asks, and never sends on the count', async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sendable: 40 }),
    }))
    ;(globalThis as any).fetch = fetchMock
    await renderEmail({
      email: { status: 'scheduled', sentAt: undefined, sendAtMs: 1 },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Send now'))
    })

    // ONE request, and it is the dry run. The confirmation rejects in this
    // harness, so a second would be a send nobody agreed to.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body))
    expect(body).toMatchObject({
      action: 'sendNow',
      campaignId: 'msg_1',
      dryRun: true,
    })
  })

  it('never puts the copy in the send-now request', async () => {
    /*
     * `sendNow` addresses an existing send id, and the route reads the whole
     * message off the record for that reason — a request that could also
     * carry a subject would be a way to put arbitrary copy on somebody else's
     * send id and mail it under that id's unsubscribe scope.
     */
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ sendable: 40 }),
    }))
    ;(globalThis as any).fetch = fetchMock
    await renderEmail({
      email: { status: 'scheduled', sentAt: undefined, sendAtMs: 1 },
    })

    await act(async () => {
      fireEvent.click(screen.getByText('Send now'))
    })

    const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body))
    expect(body.subject).toBeUndefined()
    expect(body.body).toBeUndefined()
    expect(body.audience).toBeUndefined()
  })
})

describe('scheduling and withdrawing', () => {
  it('offers Reschedule and Cancel send on a scheduled email', async () => {
    await renderEmail({
      email: { status: 'scheduled', sentAt: undefined, sendAtMs: 1 },
    })
    openOverflow()
    expect(overflowLabels()).toContain('Reschedule')
    expect(overflowLabels()).toContain('Cancel send')
  })

  it('offers Schedule but NOT Cancel on a draft', async () => {
    // Nothing is on the clock yet, so there is no send to withdraw.
    await renderEmail({
      email: { status: 'draft', sentAt: undefined, stats: undefined },
    })
    openOverflow()
    expect(overflowLabels()).toContain('Schedule')
    expect(overflowLabels()).not.toContain('Cancel send')
  })

  it('offers NEITHER on a sent email', async () => {
    /*
     * Both describe mail that has not gone out. A schedule on delivered mail
     * would put the processor back on a record whose unsubscribe links are
     * already in inboxes.
     */
    await renderEmail()
    openOverflow()
    expect(overflowLabels()).not.toContain('Reschedule')
    expect(overflowLabels()).not.toContain('Schedule')
    expect(overflowLabels()).not.toContain('Cancel send')
  })

  it('offers neither on a canceled email', async () => {
    await renderEmail({ email: { status: 'canceled' } })
    openOverflow()
    expect(overflowLabels()).not.toContain('Reschedule')
    expect(overflowLabels()).not.toContain('Cancel send')
  })
})

describe('editing what a sent email says was delivered', () => {
  it('offers Edit details in every state', async () => {
    await renderEmail()
    openOverflow()
    expect(overflowLabels()).toContain('Edit details')
  })

  it('sends ONLY the display name when the name is saved', async () => {
    /*==========================================
     * THE ASSERTION THE WHOLE EDIT RESTS ON.
     *
     * A sent email's subject, body, audience and topic describe mail that is
     * already in inboxes. The edit must be incapable of restating any of
     * them, so what is checked is the REQUEST: `update` carries a name and
     * nothing else, whatever is on screen.
     *=========================================*/
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ campaignId: 'msg_1' }),
    }))
    ;(globalThis as any).fetch = fetchMock
    await renderEmail({ email: { displayName: 'Spring promo' } })

    openOverflow()
    await act(async () => {
      fireEvent.click(screen.getByText('Edit details'))
    })
    const input = document.querySelector(
      'input[value="Spring promo"]',
    ) as HTMLInputElement
    expect(input).toBeTruthy()
    await act(async () => {
      fireEvent.change(input, { target: { value: 'The discount one' } })
    })
    await act(async () => {
      fireEvent.click(screen.getByText('Save'))
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = JSON.parse(String((fetchMock.mock.calls[0] as any)[1].body))
    expect(body).toMatchObject({
      action: 'update',
      campaignId: 'msg_1',
      displayName: 'The discount one',
    })
    expect(body.subject).toBeUndefined()
    expect(body.body).toBeUndefined()
    expect(body.audience).toBeUndefined()
    expect(body.topicId).toBeUndefined()
    expect(body.templateScreenId).toBeUndefined()
  })

  it('never offers the composer on a sent email', async () => {
    /*
     * The copy of a delivered message is not editable from anywhere, and the
     * composer is the only thing on this page that could change it.
     */
    await renderEmail()
    expect(composerProps).toBeNull()
  })

  it('never offers the composer on a canceled email', async () => {
    await renderEmail({ email: { status: 'canceled' } })
    expect(composerProps).toBeNull()
  })

  it('DOES offer the composer on a draft, seeded from the record', async () => {
    await renderEmail({
      email: {
        status: 'draft',
        sentAt: undefined,
        stats: undefined,
        subject: 'Half written',
        body: 'So far',
      },
    })
    expect(composerProps).not.toBeNull()
    // The record's own id, so Save and Send land on THIS email rather than
    // minting a second one.
    expect(composerProps?.campaignId).toBe('msg_1')
    expect(composerProps?.initial?.subject).toBe('Half written')
  })
})

describe('an unsent email is not a send that reached nobody', () => {
  it('withholds the figures on a draft', async () => {
    /*
     * A draft carries no `stats` at all, so drawing the report would publish
     * a column of zeros and a delivery rate of 0% — the reading "this reached
     * nobody", which is a claim about a send that happened.
     */
    await renderEmail({
      email: { status: 'draft', sentAt: undefined, stats: undefined },
    })
    expect(screen.getByText(/has not been sent/i)).toBeTruthy()
    expect(screen.queryByText('Delivery rate')).toBeNull()
    expect(screen.queryByText('Readers who opened')).toBeNull()
  })

  it('withholds them on a scheduled email too', async () => {
    await renderEmail({
      email: {
        status: 'scheduled',
        sentAt: undefined,
        sendAtMs: 1,
        stats: undefined,
      },
    })
    expect(screen.queryByText('Delivery rate')).toBeNull()
  })

  it('DOES draw them for a sent email', async () => {
    // The control. A page that withheld the report from everything would pass
    // both assertions above having deleted the report.
    await renderEmail()
    expect(screen.getByText('Delivery rate')).toBeTruthy()
    expect(screen.getByText('Readers who opened')).toBeTruthy()
  })
})

describe('the preview sits below the recipients', () => {
  it('renders the preview frame AFTER the recipients card', async () => {
    /*
     * The figures are what a reader opens this page for and the frame is the
     * tallest thing on it, so above them it pushes every number below the
     * fold. Asserted by DOM ORDER rather than by both being present, which is
     * true whichever way round they are.
     */
    await renderEmail()
    const preview = document.querySelector('iframe[title="Email preview"]')
    const recipients = screen.getByText('Recipients')
    expect(preview).toBeTruthy()
    expect(
      recipients.compareDocumentPosition(preview as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('gives the preview card a heading rather than a hover tooltip', async () => {
    /*
     * `CardDisplay` has no `title` prop, so one spread through to the MUI
     * Card root and landed on the DOM as a `title` attribute — the card drew
     * with no heading at all, and a 640px frame flush against its edge.
     */
    await renderEmail()
    expect(screen.getByText('Preview')).toBeTruthy()
    expect(document.querySelector('[title="Preview"]')).toBeNull()
  })
})

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
 * WHAT A MERCHANT IS TOLD BEFORE THEY PRESS SEND.
 *
 * Two defects, both reproduced by hand against the live console first:
 *
 *  1. **The recipient count was never once rendered.** The composer asks for
 *     it on mount, carrying no copy — and the send route required a subject
 *     and a body of every action but `cancel`, so every preview of a
 *     plain-text campaign was answered `400 Missing subject or body`. The
 *     line under the Subject field showed that error and never recovered,
 *     because the request was not re-issued as the copy was typed.
 *     `campaign-composer.spec.ts` in plugins-marketing owns the server half;
 *     this file owns that the composer asks a question the server can answer,
 *     and renders the answer.
 *  2. **The confirm dialog stated a rule instead of a number.** `"…" goes to
 *     every list subscriber who hasn't unsubscribed` is true of a send to
 *     forty people and of a send to four thousand, and the code that would
 *     have said which was only reachable through the count defect 1 broke.
 *
 * The fetch double below is the REAL route's contract, guard included, so a
 * request this composer could not get answered fails here.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.setTimeout(30_000)

const FIRESTORE = {}

/** Every `/api/campaigns/send` body this render posted, in order. */
let posted: Array<Record<string, any>> = []
/** The audience the double reports. */
let audienceAnswer: Record<string, unknown> = {
  sendable: 3,
  suppressed: 1,
  audienceSize: 5,
  audienceTruncated: false,
  consented: 3,
  grandfathered: 0,
  consentWithheld: 2,
}

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({
    data: { uid: 'uid-test', getIdToken: async () => 'token' },
  }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
  useOrgPlan: () => ({ org: { $id: 'org-1', plan: 'scale' }, ready: true }),
  useHostOrgId: () => 'org-1',
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useHostResourceApi: () => jest.fn().mockResolvedValue({ id: 'new' }),
  useHostVersionApi: () => jest.fn().mockResolvedValue({ id: 'v1' }),
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name = String(built?.path ?? '').split('/').pop() ?? ''
    return {
      data:
        name === 'lists'
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
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useParams: () => ({}),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({ enqueueSnackbar: jest.fn() }),
}))

/** The options the confirm dialog was opened with, most recent last. */
let confirmations: Array<Record<string, any>> = []
let confirmAnswer = true
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({
    confirm: (options: Record<string, any>) => {
      confirmations.push(options)
      return confirmAnswer ? Promise.resolve(undefined) : Promise.reject()
    },
  }),
}))

jest.mock('./use-org-email-topics', () => ({
  useOrgEmailTopics: () => ({
    topics: [
      { id: 'marketing', name: 'Promotions and offers' },
      { id: 'sales', name: 'Sales outreach' },
    ],
  }),
}))

import CampaignComposer from './campaign-composer'

/**
 * The send route, as it actually answers.
 *
 * The guard is copied deliberately rather than stubbed away: it is the line
 * that produced defect 1, and a double that answered every request would let
 * a composer that asks an unanswerable question pass here.
 */
const routeAnswer = (body: Record<string, any>) => {
  const action = String(body.action ?? 'send')
  const mails =
    action !== 'cancel' && action !== 'preview' && action !== 'renderPreview'
  if (mails && !body.templateScreenId && (!body.subject || !body.body)) {
    return { status: 400, payload: { error: 'Missing subject or body' } }
  }
  if (action === 'preview') return { status: 200, payload: audienceAnswer }
  if (action === 'renderPreview') {
    return {
      status: 200,
      payload: {
        subject: String(body.subject ?? ''),
        html: `<!DOCTYPE html><html><body><p>${body.body ?? ''}</p></body></html>`,
        text: String(body.body ?? ''),
      },
    }
  }
  return { status: 200, payload: { sent: 3, recipients: 3, campaignId: 'c1' } }
}

beforeEach(() => {
  posted = []
  confirmations = []
  confirmAnswer = true
  audienceAnswer = {
    sendable: 3,
    suppressed: 1,
    audienceSize: 5,
    audienceTruncated: false,
    consented: 3,
    grandfathered: 0,
    consentWithheld: 2,
  }
  ;(global as any).fetch = jest.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body)
    posted.push(body)
    const { status, payload } = routeAnswer(body)
    return {
      ok: status < 400,
      status,
      json: async () => payload,
    } as any
  })
})

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

const mount = async (props: Record<string, any> = {}) => {
  render(<CampaignComposer hostId="host-1" {...props} />)
  // Past the count debounce.
  await settle(500)
}

const previews = () => posted.filter((body) => body.action === 'preview')
const renders = () => posted.filter((body) => body.action === 'renderPreview')

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  })
}

describe('the recipient count under the composer', () => {
  it('asks for the count carrying NO subject and NO body', async () => {
    await mount()

    expect(previews()).toHaveLength(1)
    expect(previews()[0].subject).toBeUndefined()
    expect(previews()[0].body).toBeUndefined()
    // The request the guard used to refuse. Answered, so the readout has
    // something to render.
    expect((global as any).fetch).toHaveBeenCalled()
  })

  it('renders the audience size beside the send size', async () => {
    await mount()

    await waitFor(() =>
      expect(screen.getByText(/Recipients 3 of 5 in this audience/)).toBeTruthy(),
    )
  })

  it('renders the consent split', async () => {
    await mount()

    await waitFor(() =>
      expect(
        screen.getByText(/3 with a recorded consent basis/),
      ).toBeTruthy(),
    )
    expect(
      screen.getByText(/2 withheld — no consent on record, never mailed/),
    ).toBeTruthy()
  })

  it('recounts when the AUDIENCE changes', async () => {
    await mount()
    expect(previews()).toHaveLength(1)

    fireEvent.mouseDown(screen.getByLabelText('Audience'))
    fireEvent.click(await screen.findByText('List: Newsletter'))
    await settle(500)

    expect(previews()).toHaveLength(2)
    expect(previews()[1]).toMatchObject({ audience: 'list', listId: 'list-1' })
  })

  it('does NOT recount the audience while the copy is typed', async () => {
    /*
     * The cost property. Resolving an audience reads up to five thousand
     * documents, and the answer does not depend on a single character of the
     * copy — so a count re-issued per keystroke would page a merchant's whole
     * contact list to re-report a number that had not moved.
     */
    await mount()
    expect(previews()).toHaveLength(1)

    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    await settle(800)

    expect(previews()).toHaveLength(1)
  })

  it('says the audience is a floor when the resolution was truncated', async () => {
    audienceAnswer = { ...audienceAnswer, audienceSize: 9000, audienceTruncated: true }
    await mount()

    await waitFor(() =>
      expect(screen.getByText(/of 9,000\+ in this audience/)).toBeTruthy(),
    )
  })
})

describe('the confirm dialog for an irreversible bulk send', () => {
  const compose = async () => {
    await mount()
    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    await settle(0)
  }

  it('states how many people it is about to mail', async () => {
    await compose()

    fireEvent.click(screen.getByText('Send campaign'))
    await waitFor(() => expect(confirmations).toHaveLength(1))

    expect(confirmations[0].description).toContain('goes to 3 leads of 5')
  })

  it('states the consent split, and what is not counted', async () => {
    await compose()

    fireEvent.click(screen.getByText('Send campaign'))
    await waitFor(() => expect(confirmations).toHaveLength(1))

    expect(confirmations[0].description).toContain(
      '2 withheld — no marketing consent on record',
    )
    expect(confirmations[0].description).toContain(
      '1 unsubscribed or suppressed',
    )
  })

  it('says ONE lead, not 1 leads', async () => {
    audienceAnswer = { ...audienceAnswer, sendable: 1, audienceSize: 1, suppressed: 0, consentWithheld: 0 }
    await compose()

    fireEvent.click(screen.getByText('Send campaign'))
    await waitFor(() => expect(confirmations).toHaveLength(1))

    expect(confirmations[0].description).toContain('goes to 1 lead.')
  })

  it('ADMITS when the count could not be read rather than implying everyone', async () => {
    /*
     * The failure this dialog must not paper over. A send whose size is
     * unknown is not a send to "everyone" — it is a send whose size is
     * unknown, and a dialog that says the first is asserting something
     * nobody measured.
     */
    audienceAnswer = {}
    ;(global as any).fetch = jest.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body)
      posted.push(body)
      if (body.action === 'preview') {
        return {
          ok: false,
          status: 403,
          json: async () => ({ error: 'Monthly campaign email limit reached' }),
        } as any
      }
      const { status, payload } = routeAnswer(body)
      return { ok: status < 400, status, json: async () => payload } as any
    })
    await compose()

    fireEvent.click(screen.getByText('Send campaign'))
    await waitFor(() => expect(confirmations).toHaveLength(1))

    expect(confirmations[0].description).toContain(
      'The recipient count could not be read',
    )
    expect(confirmations[0].description).toContain(
      'Monthly campaign email limit reached',
    )
  })

  it('sends nothing when the dialog is dismissed', async () => {
    confirmAnswer = false
    await compose()

    fireEvent.click(screen.getByText('Send campaign'))
    await settle(50)

    expect(posted.filter((body) => !body.action)).toHaveLength(0)
  })
})

describe('the rendered preview', () => {
  it('renders nothing until it is asked for', async () => {
    await mount()
    await settle(800)

    expect(renders()).toHaveLength(0)
  })

  it('shows the email in an iframe that can do NOTHING', async () => {
    await mount()
    type('Message', 'Ends Sunday')
    fireEvent.click(screen.getByText('Preview email'))
    await settle(800)

    const frame = await screen.findByTitle('Email preview')
    // `sandbox=""` withholds every capability: the document is tenant-authored
    // and is being rendered inside the console's own origin.
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('Ends Sunday')
  })

  it('re-renders as the copy changes', async () => {
    await mount()
    fireEvent.click(screen.getByText('Preview email'))
    await settle(800)
    expect(renders()).toHaveLength(1)

    type('Subject', 'Spring sale')
    await settle(800)

    expect(renders()).toHaveLength(2)
    expect(renders()[1].subject).toBe('Spring sale')
  })

  it('resolves no audience to render', async () => {
    await mount()
    const before = previews().length
    fireEvent.click(screen.getByText('Preview email'))
    await settle(800)

    expect(previews()).toHaveLength(before)
  })
})

describe('the sender fields', () => {
  it('sends the from-name, reply-to and preheader it collected', async () => {
    await mount()
    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    type('From name', 'Acme Studio')
    type('Reply-to', 'hello@acme.example')
    type('Preheader', 'Half price until Sunday')
    await settle(0)

    fireEvent.click(screen.getByText('Send campaign'))
    await waitFor(() =>
      expect(posted.some((body) => !body.action)).toBe(true),
    )

    const send = posted.find((body) => !body.action) as Record<string, any>
    expect(send.fromName).toBe('Acme Studio')
    expect(send.replyTo).toBe('hello@acme.example')
    expect(send.preheader).toBe('Half price until Sunday')
  })

  it('carries the campaign the send belongs to', async () => {
    await mount({ emailCampaignId: 'camp-1' })
    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    await settle(0)

    fireEvent.click(screen.getByText('Send campaign'))
    await waitFor(() => expect(posted.some((body) => !body.action)).toBe(true))

    expect(
      (posted.find((body) => !body.action) as any).emailCampaignId,
    ).toBe('camp-1')
  })

  it('opens on the campaign’s own list rather than on Leads', async () => {
    // A send composed inside a campaign aimed at a list is a send to that
    // list; defaulting to Leads inside one is a wrong audience away from a
    // wrong send.
    await mount({ campaignListIds: ['list-1'] })

    expect(previews()[0]).toMatchObject({
      audience: 'list',
      listId: 'list-1',
    })
  })
})

describe('the stream this email belongs to', () => {
  it('carries the topic on the COUNT as well as the send', async () => {
    /*
     * The easy one to miss, and the one that makes the count wrong rather than
     * merely incomplete: `filterTopicSendable` removes the people who have
     * left this stream, so a preview taken without the topic reports a reach
     * the send will not deliver.
     */
    await mount({ campaignTopicId: 'sales' })

    expect(previews()[0].topicId).toBe('sales')
  })

  it('records the topic on the send', async () => {
    // Without it the send records `marketing`, and a recipient who left the
    // sales stream is mailed a sales campaign anyway.
    await mount({ campaignTopicId: 'sales' })
    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    await settle(0)

    fireEvent.click(screen.getByText('Send campaign'))
    await waitFor(() => expect(posted.some((body) => !body.action)).toBe(true))

    expect((posted.find((body) => !body.action) as any).topicId).toBe('sales')
  })

  it('settles on the org default before it counts, and counts ONCE', async () => {
    /*
     * The picker settles the field against the org's catalog rather than
     * leaving it blank while the server has already decided. That settle
     * happens inside the count's debounce window, so the composer asks for
     * one count — under the topic it will actually send with — rather than
     * one under no topic followed by a correction.
     */
    await mount()

    expect(previews()).toHaveLength(1)
    expect(previews()[0].topicId).toBe('marketing')
  })
})

describe('the merge tags', () => {
  it('offers the three the send path actually resolves', async () => {
    await mount()

    expect(screen.getByText('{{firstName|there}}')).toBeTruthy()
    expect(screen.getByText('{{name}}')).toBeTruthy()
    expect(screen.getByText('{{email}}')).toBeTruthy()
  })

  it('inserts one into the message', async () => {
    await mount()
    type('Message', 'Hello ')
    fireEvent.click(screen.getByText('{{firstName|there}}'))

    expect(
      (screen.getByLabelText('Message', { exact: false }) as HTMLInputElement)
        .value,
    ).toBe('Hello {{firstName|there}}')
  })
})

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
 * HOW THIS EMAIL IS WRITTEN — and the message that used to vanish.
 *
 * The form showed an "Email design" select and a "Message" box at once and
 * named neither as the one that wins. It was the design: `renderCampaignEmail`
 * read the typed body only when no template was given, and both gates in front
 * of it — the composer's `!templateScreenId && !body.trim()` and the route's
 * `!templateScreenId && (!subject || !body)` — passed on EITHER input. So a
 * merchant who chose a design and also wrote a message sent the design, and
 * the message was resolved for merge tags and thrown away in silence.
 *
 * The mode is what closes it here, at the client end: only the chosen half is
 * on screen, and only that half's field is submitted. The route double below
 * carries the server's own refusal of a request naming both, so a composer
 * that submitted both would be answered `400` and fail these tests rather than
 * quietly having one of its two inputs discarded.
 *
 * TWO modes and not three. A saved TEMPLATE is a besigner email screen — the
 * same `kind: 'email'` document this picker lists, `createEmailScreen` writes
 * and `/emails/templates/{id}` reports on — so "designed in the besigner" and
 * "a saved template" name one thing.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

jest.setTimeout(30_000)

const FIRESTORE = {}

/** Every `/api/campaigns/send` body this render posted, in order. */
let posted: Array<Record<string, any>> = []

/** The screen and version creates a one-off design mints, capturable. */
// Typed to ACCEPT an argument, because the assertions below read the payload
// the composer passes. A zero-arity mock infers `calls` as `[][]`, so
// `calls[0][0]` is a tuple index that does not exist and the spec config
// fails to compile while jest itself runs it happily.
const mockCreateResource = jest.fn(async (_input?: unknown) => ({ id: 'new' }))
const mockCreateVersion = jest.fn(async () => ({ id: 'v1' }))

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({
    data: { uid: 'uid-test', getIdToken: async () => 'token' },
  }),
  useOrgDataScope: () => ({ scope: ['orgs', 'org-1'], orgId: 'org-1' }),
  useOrgPlan: () => ({ org: { $id: 'org-1', plan: 'scale' }, ready: true }),
  useHostOrgId: () => 'org-1',
  useConsoleHostRoute: () => ({ base: null, orgSlug: null, subdomain: null }),
  useHostResourceApi: () => mockCreateResource,
  useHostVersionApi: () => mockCreateVersion,
  useFirestoreDoc: () => ({ data: undefined, status: 'success' }),
  useFirestoreCollection: (build: () => any) => {
    const built = build()
    const name =
      String(built?.path ?? '')
        .split('/')
        .pop() ?? ''
    return {
      data:
        name === 'screens'
          ? [
              {
                $id: 'scr_1',
                kind: 'email',
                displayName: 'Spring promo',
                versionId: 'ver_1',
              },
            ]
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
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: () => Promise.resolve(undefined) }),
}))
jest.mock('./use-org-email-topics', () => ({
  useOrgEmailTopics: () => ({
    topics: [{ id: 'marketing', name: 'Promotions and offers' }],
  }),
}))

import CampaignComposer from './campaign-composer'

/**
 * The send route, as it actually answers — the both-sources refusal included.
 *
 * Copied rather than stubbed away, exactly as the sibling composer spec copies
 * the subject/body guard: it is the line that turns a silent discard into a
 * refusal, and a double that answered everything would let a composer
 * submitting both halves pass here.
 */
const routeAnswer = (body: Record<string, any>) => {
  const action = String(body.action ?? 'send')
  const carriesComposedCopy =
    action === 'send' ||
    action === 'schedule' ||
    action === 'draft' ||
    action === 'test' ||
    action === 'renderPreview'
  if (carriesComposedCopy && body.templateScreenId && body.body) {
    return {
      status: 400,
      payload: { error: 'This email is built from a design' },
    }
  }
  // The mirror refusal: a plain-text email's text part IS its body, so a
  // second string claiming to be one is the same two-sources problem.
  if (carriesComposedCopy && !body.templateScreenId && body.plainText) {
    return {
      status: 400,
      payload: { error: 'A plain-text email has no separate text version' },
    }
  }
  const mails =
    action !== 'cancel' && action !== 'preview' && action !== 'renderPreview'
  if (mails && !body.templateScreenId && (!body.subject || !body.body)) {
    return { status: 400, payload: { error: 'Missing subject or body' } }
  }
  if (action === 'preview') {
    return {
      status: 200,
      payload: {
        sendable: 3,
        suppressed: 0,
        audienceSize: 3,
        consented: 3,
        grandfathered: 0,
        consentWithheld: 0,
      },
    }
  }
  if (action === 'renderPreview') {
    /*
     * The route renders whichever half the request names, and reports the
     * message text WITHOUT the footer beside the text part that has one —
     * which is what an authored plain-text version is filled from.
     */
    const messageText = body.templateScreenId
      ? String(body.plainText || 'Generated from the design')
      : String(body.body ?? '')
    return {
      status: 200,
      payload: {
        subject: String(body.subject ?? ''),
        html: `<!DOCTYPE html><html><body><p>${body.body ?? 'designed'}</p></body></html>`,
        messageText,
        text: `${messageText}\n\n—\nChoose which emails you get, or unsubscribe: https://acme.example/opt-out`,
      },
    }
  }
  return { status: 200, payload: { sent: 3, recipients: 3, campaignId: 'c1' } }
}

beforeEach(() => {
  posted = []
  ;(global as any).fetch = jest.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body)
    posted.push(body)
    const { status, payload } = routeAnswer(body)
    return { ok: status < 400, status, json: async () => payload } as any
  })
})

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

const mount = async (props: Record<string, any> = {}) => {
  render(<CampaignComposer hostId="host-1" {...props} />)
  await settle(500)
}

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  })
}

/** Pick an option out of one of the composer's MUI selects. */
const choose = async (label: string, option: string) => {
  fireEvent.mouseDown(screen.getByLabelText(label))
  fireEvent.click(await screen.findByText(option))
  await settle(0)
}

const asDesigned = () =>
  choose('How this email is written', 'Designed in the besigner')
const asText = () =>
  choose('How this email is written', 'Written here as plain text')

/** The send request, once one has been made. */
const sendRequest = () =>
  posted.find((body) => !body.action) as Record<string, any> | undefined

const pressSend = async () => {
  fireEvent.click(screen.getByText('Send campaign'))
  await waitFor(() => expect(sendRequest()).toBeTruthy())
}

describe('the choice itself', () => {
  it('offers exactly two ways to write an email, and names them', async () => {
    await mount()

    fireEvent.mouseDown(screen.getByLabelText('How this email is written'))
    expect(await screen.findByText('Designed in the besigner')).toBeTruthy()
    // `getAllBy`: the chosen option is also rendered as the select's own
    // value, so the plain-text entry is legitimately on screen twice.
    expect(
      screen.getAllByText('Written here as plain text').length,
    ).toBeGreaterThan(0)
    /*
     * A saved template is a besigner email screen, so a third entry would be a
     * distinction nothing in the data model has. The picker below lists those
     * same screens under "Email design".
     */
    expect(screen.queryByText(/saved template/i)).toBeNull()
  })

  it('shows only the half the mode owns', async () => {
    await mount()
    // Text is where a new email opens: it carries no template, and the mode is
    // read from that same field the send path reads.
    expect(screen.getByLabelText('Message', { exact: false })).toBeTruthy()
    expect(screen.queryByLabelText('Email design')).toBeNull()

    await asDesigned()

    expect(screen.getByLabelText('Email design')).toBeTruthy()
    expect(screen.queryByLabelText('Message', { exact: false })).toBeNull()
    // The merge-tag chips go with the message box — they insert into it.
    expect(screen.queryByText('{{firstName|there}}')).toBeNull()
  })

  it('reopens a designed draft designed', async () => {
    // Seeded through the same resolver the send path reads, so a saved email
    // cannot be shown as one thing and mailed as another.
    await mount({ initial: { templateScreenId: 'scr_1', subject: 'Saved' } })

    expect(screen.getByLabelText('Email design')).toBeTruthy()
    expect(screen.queryByLabelText('Message', { exact: false })).toBeNull()
  })
})

describe('each mode sends what it says', () => {
  it('plain text sends the typed body, and no design', async () => {
    await mount()
    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    await settle(0)
    await pressSend()

    expect(sendRequest()?.body).toBe('Ends Sunday')
    expect(sendRequest()?.templateScreenId).toBeUndefined()
  })

  it('a design sends the design, and no body', async () => {
    await mount()
    type('Subject', 'Spring sale')
    await asDesigned()
    await choose('Email design', 'Spring promo')
    await pressSend()

    expect(sendRequest()?.templateScreenId).toBe('scr_1')
    expect(sendRequest()?.body).toBe('')
  })
})

describe('the message that used to vanish', () => {
  /*==========================================
   * THE DEFECT, reproduced as the merchant produced it: choose a design, and
   * also write a message.
   *
   * What made it silent is that BOTH gates accepted either input, so the
   * request went out carrying two sources and the renderer picked one. The
   * assertion is therefore about the REQUEST rather than about a warning: the
   * composer submits the field its mode owns, so there is never a second
   * source for anything downstream to discard.
   *
   * The route double refuses a request naming both. A composer that regained
   * the old behavior would be answered `400` here and make no send at all.
   *=========================================*/
  const composeBoth = async (props: Record<string, any> = {}) => {
    await mount(props)
    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    await settle(0)
    await asDesigned()
    await choose('Email design', 'Spring promo')
  }

  it('never submits a typed body beside a design', async () => {
    await composeBoth()
    await pressSend()

    expect(sendRequest()?.templateScreenId).toBe('scr_1')
    expect(sendRequest()?.body).toBe('')
    // The refusal never fired, because the composer never asked for both.
    expect(posted.some((body) => body.templateScreenId && body.body)).toBe(
      false,
    )
  })

  it('never submits both on a saved draft either', async () => {
    // Save draft is offered only where there is a record to save INTO.
    await composeBoth({ campaignId: 'msg_1' })
    fireEvent.click(screen.getByText('Save draft'))
    await waitFor(() =>
      expect(posted.some((body) => body.action === 'draft')).toBe(true),
    )

    const draft = posted.find((body) => body.action === 'draft') as any
    expect(draft.templateScreenId).toBe('scr_1')
    expect(draft.body).toBe('')
  }, 30_000)

  it('never renders a preview of both at once', async () => {
    await composeBoth()
    fireEvent.click(screen.getByText('Preview email'))
    await settle(900)

    const render = posted.find((body) => body.action === 'renderPreview') as any
    expect(render.templateScreenId).toBe('scr_1')
    expect(render.body).toBe('')
  })

  it('keeps the typing, so switching back loses nothing', async () => {
    /*==========================================
     * THE CONTROL.
     *
     * Every assertion above passes just as well against a composer that had
     * simply stopped submitting bodies. This is the pair that does not: the
     * SAME two fields are filled — a typed message and a chosen design — and
     * the only thing that changes is the mode, which has to produce the other
     * request.
     *
     * A composer that ignored the choice and always took one path fails here,
     * and so does one that cleared the field it was not using.
     *=========================================*/
    await composeBoth()
    await asText()

    // The message survived the round trip through the other mode.
    expect(
      (screen.getByLabelText('Message', { exact: false }) as HTMLInputElement)
        .value,
    ).toBe('Ends Sunday')

    await pressSend()

    expect(sendRequest()?.body).toBe('Ends Sunday')
    expect(sendRequest()?.templateScreenId).toBeUndefined()
  })
})

describe('the plain-text half a designed email goes out with', () => {
  const design = async (props: Record<string, any> = {}) => {
    await mount(props)
    type('Subject', 'Spring sale')
    await settle(0)
    if (!props.initial?.templateScreenId) {
      await asDesigned()
      await choose('Email design', 'Spring promo')
    }
  }

  it('is generated by default, and submits no override', async () => {
    await design()
    await pressSend()

    expect(sendRequest()?.templateScreenId).toBe('scr_1')
    // Absent, not empty: presence is what makes a stored value an override.
    expect(sendRequest()?.plainText).toBeUndefined()
  })

  it('offers writing one, and starts from what it replaces', async () => {
    await design()
    await choose('Plain-text version', 'Written here')
    await settle(50)

    const written = screen.getByLabelText('The plain-text message', {
      exact: false,
    }) as HTMLInputElement
    // Filled from the design's own text rather than left empty — an override
    // that starts blank is "write this email a second time".
    expect(written.value).toBe('Generated from the design')
  })

  it('sends the authored part, and the design version it was written against', async () => {
    await design()
    await choose('Plain-text version', 'Written here')
    await settle(50)
    type('The plain-text message', 'Sale ends Sunday: acme.example/sale')
    await settle(0)
    await pressSend()

    expect(sendRequest()?.plainText).toBe('Sale ends Sunday: acme.example/sale')
  })

  it('never carries an override on a plain-text email', async () => {
    // The route refuses one, so a composer that leaked it would make no send.
    await design()
    await choose('Plain-text version', 'Written here')
    await settle(50)
    type('The plain-text message', 'Mine')
    await asText()
    type('Message', 'Ends Sunday')
    await settle(0)
    await pressSend()

    expect(sendRequest()?.plainText).toBeUndefined()
    expect(sendRequest()?.body).toBe('Ends Sunday')
  })

  it('SAYS when the design has moved on since the part was written', async () => {
    /*
     * The staleness notice, and the reason it is a notice rather than a
     * rewrite: nothing overwrites the author's words when the canvas is
     * edited. What is left over is a text half that no longer describes the
     * design — invisible unless something says so, which is the same shape as
     * the discard this whole surface was fixed for.
     *
     * `ver_0` is what the stored part was written against; the design in the
     * picker is at `ver_1`.
     */
    await design({
      initial: {
        templateScreenId: 'scr_1',
        subject: 'Saved',
        plainText: 'Written a while ago',
        plainTextVersionId: 'ver_0',
      },
    })

    expect(screen.getByText(/design has been edited since/i)).toBeTruthy()
  })

  it('says nothing when the part still describes the design', async () => {
    // The control for the notice: same shape, current version, no warning.
    await design({
      initial: {
        templateScreenId: 'scr_1',
        subject: 'Saved',
        plainText: 'Written against this very design',
        plainTextVersionId: 'ver_1',
      },
    })

    expect(screen.queryByText(/design has been edited since/i)).toBeNull()
  })

  it('shows the typed message a designed email would otherwise strand', async () => {
    /*
     * The defect, made visible. The message is no longer submitted, so nothing
     * downstream can drop it — and rather than disappearing from the screen
     * too, it is offered the one job it could honestly do.
     */
    await mount()
    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    await settle(0)
    await asDesigned()
    await choose('Email design', 'Spring promo')

    expect(screen.getByText(/also carries a typed message/i)).toBeTruthy()

    fireEvent.click(screen.getByText('Use it as the plain-text version'))
    await settle(0)
    await pressSend()

    // Adopted into the half it belongs to, and NOT sent as a second message.
    expect(sendRequest()?.plainText).toBe('Ends Sunday')
    expect(sendRequest()?.body).toBe('')
  })

  it('shows the author the text part, not only the HTML', async () => {
    await design()
    fireEvent.click(screen.getByText('Preview email'))
    await settle(900)

    expect(
      await screen.findByText('Plain-text version, as it will send'),
    ).toBeTruthy()
    // Footer included: the opt-out is a bare address in a text part, and that
    // is the half a text-only reader receives.
    expect(
      screen.getByText(/Choose which emails you get, or unsubscribe:/),
    ).toBeTruthy()
  })
})

describe('what the mode needs before it can send', () => {
  it('refuses a design mode with no design chosen', async () => {
    await mount()
    type('Subject', 'Spring sale')
    type('Message', 'Ends Sunday')
    await settle(0)
    await asDesigned()

    // The typed body is still held, and it is NOT what makes this sendable:
    // the mode is design, and no design has been picked.
    expect(
      (screen.getByText('Send campaign').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('refuses a text mode with nothing written', async () => {
    await mount({ initial: { templateScreenId: 'scr_1', subject: 'Saved' } })
    await asText()

    expect(
      (screen.getByText('Send campaign').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})

describe('a one-off email gets a design of its own, not a "template"', () => {
  beforeEach(() => {
    mockCreateResource.mockClear()
    mockCreateVersion.mockClear()
  })

  it('names the created design after the email it belongs to', async () => {
    await mount({ campaignId: 'msg_1', displayName: 'August newsletter' })
    await asDesigned()

    fireEvent.click(screen.getByText('Design this email'))

    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    const created = mockCreateResource.mock.calls[0][0] as any
    expect(created.data.kind).toBe('email')
    // The name is the only thing that tells one design from another in the
    // picker; a list of identical "Untitled email" rows tells nobody
    // anything.
    expect(created.data.displayName).toBe('August newsletter')
  })

  it('falls back to the subject when the email carries no display name', async () => {
    await mount({ campaignId: 'msg_1' })
    type('Subject', 'Spring clearance')
    await asDesigned()

    fireEvent.click(screen.getByText('Design this email'))

    await waitFor(() => expect(mockCreateResource).toHaveBeenCalledTimes(1))
    expect((mockCreateResource.mock.calls[0][0] as any).data.displayName).toBe(
      'Spring clearance',
    )
  })

  it('records the created design on the record before leaving for the editor', async () => {
    await mount({ campaignId: 'msg_1', displayName: 'August newsletter' })
    await asDesigned()

    fireEvent.click(screen.getByText('Design this email'))

    // Without this write the design would exist while the record still
    // pointed at nothing, and the author would have to come back and find
    // their own screen in the picker.
    await waitFor(() =>
      expect(posted.some((body) => body.action === 'draft')).toBe(true),
    )
    const draft = posted.find((body) => body.action === 'draft') as any
    const created = mockCreateResource.mock.calls[0][0] as any
    expect(draft.templateScreenId).toBe(created.id)
    expect(draft.campaignId).toBe('msg_1')
  })
})

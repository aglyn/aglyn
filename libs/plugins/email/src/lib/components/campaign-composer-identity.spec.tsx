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
 * AN UNVERIFIED IDENTITY IS REFUSED BEFORE THE SEND, NOT AFTER IT.
 *
 * The send path already answers `409` for a domain whose DNS is unfinished,
 * and it always will — that boundary is proved in `campaign-send.spec.ts` and
 * nothing here can weaken it. What this file owns is the difference between
 * being told and finding out: the same refusal, arriving while there is still
 * something to do about it.
 *
 * The mechanism is that the identity rides the DRY RUN. `preview` resolves
 * the identity on exactly the terms a send does, so the composer learns the
 * answer before any copy exists — which is the only moment at which "publish
 * these records first" is advice rather than an apology.
 *
 * Every assertion about the disabled button is paired with one about what was
 * POSTED. A disabled button is a courtesy; the property worth holding is that
 * no send request is issued, and only the second assertion can see that.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'

jest.setTimeout(30_000)

const FIRESTORE = {}

/** Every `/api/campaigns/send` body this render posted, in order. */
let posted: Array<Record<string, any>> = []
/** How the double answers `preview`, staged per case. */
let previewAnswer: { status: number; payload: Record<string, unknown> } = {
  status: 200,
  payload: {},
}
/** What the sending-identity route offers this site. */
let identityOptions: Array<Record<string, unknown>> = []

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
  useFirestoreCollection: () => ({
    data: [],
    status: 'success',
    fromCache: false,
  }),
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
  useOrgEmailTopics: () => ({ topics: [{ id: 'marketing', name: 'Promotions' }] }),
}))

import CampaignComposer from './campaign-composer'

const HEALTHY_PREVIEW = {
  sendable: 3,
  suppressed: 0,
  audienceSize: 3,
  audienceTruncated: false,
  consented: 3,
  grandfathered: 0,
  consentWithheld: 0,
  identity: 'Sending as news@acme.com on your verified domain acme.com.',
  identitySource: 'custom',
}

/**
 * The 409 the send path actually throws for an unfinished domain, message
 * included.
 *
 * Copied from `resolveSendingIdentity` rather than invented, because the
 * assertion below is that the composer SHOWS this sentence — a double with
 * placeholder prose would prove the composer renders something, which is not
 * the property that matters. The sentence names the domain and the record.
 */
const REFUSAL = {
  status: 409,
  payload: {
    error:
      'We checked the DNS for acme.com and the required records are not ' +
      'published yet, so this send was refused rather than sent from a ' +
      'different address. Publish the records shown on the sending domain ' +
      'card, then verify. Missing: TXT:send.acme.com.',
  },
}

beforeEach(() => {
  posted = []
  previewAnswer = { status: 200, payload: HEALTHY_PREVIEW }
  identityOptions = []
  ;(global as any).fetch = jest.fn(async (url: string, init: any) => {
    if (String(url).includes('sending-identity')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          orgId: 'org-1',
          selected: 'acme.com',
          localPart: 'news',
          identity: HEALTHY_PREVIEW.identity,
          identitySource: 'custom',
          refusal: null,
          options: identityOptions,
          domains: [],
          canManage: true,
          entitled: true,
        }),
      } as any
    }
    const body = JSON.parse(init.body)
    posted.push(body)
    if (body.action === 'preview') {
      return {
        ok: previewAnswer.status < 400,
        status: previewAnswer.status,
        json: async () => previewAnswer.payload,
      } as any
    }
    if (body.action === 'renderPreview') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ subject: '', html: '<p></p>', text: '' }),
      } as any
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ sent: 3, recipients: 3, campaignId: 'c1' }),
    } as any
  })
})

const settle = async (ms: number) => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
}

const mount = async () => {
  render(<CampaignComposer hostId="host-1" />)
  // Past the count debounce, so the dry run has answered.
  await settle(500)
}

/** Types enough copy that only the identity can be holding Send back. */
const writeTheEmail = async () => {
  fireEvent.change(screen.getByLabelText(/^Subject/i), {
    target: { value: 'Spring sale' },
  })
  fireEvent.change(screen.getByLabelText(/^Message/i), {
    target: { value: 'The sale is on.' },
  })
  await settle(500)
}

const sendButton = () =>
  screen.getByText('Send campaign').closest('button') as HTMLButtonElement

describe('a refused identity stops the send at the composer', () => {
  beforeEach(() => {
    previewAnswer = REFUSAL
  })

  it('shows the refusal, naming the domain and the missing record', async () => {
    await mount()

    expect(screen.getByText('This email cannot be sent yet')).toBeTruthy()
    /*
     * `getAllByText`: the audience caption also surfaces the refusal, because
     * a 409 is the answer the count request got and the caption reports what
     * it was told. Both places saying it is right; asserting on exactly one
     * would be asserting on the layout.
     */
    expect(screen.getAllByText(/acme\.com/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/TXT:send\.acme\.com/).length).toBeGreaterThan(0)
  })

  it('disables Send even once the email is fully written', async () => {
    await mount()
    await writeTheEmail()

    // Nothing else is missing. A button still disabled here is disabled for
    // the identity and for no other reason.
    expect(sendButton().disabled).toBe(true)
  })

  it('POSTS NO SEND when the button is pressed anyway', async () => {
    await mount()
    await writeTheEmail()

    await act(async () => {
      fireEvent.click(sendButton())
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    // The assertion that actually means "refused before the send". A disabled
    // attribute can be wrong or worked around; an absent request cannot.
    expect(posted.filter((body) => body.action === 'send')).toHaveLength(0)
    expect(posted.some((body) => !body.action)).toBe(false)
  })

  it('says the draft is safe, because a refusal that reads as data loss is not one', async () => {
    await mount()

    expect(screen.getByText(/nothing about this draft is lost/i)).toBeTruthy()
  })
})

describe('a healthy identity is named, and does not block anything', () => {
  it('shows which address the campaign leaves on', async () => {
    /*
     * The other half of the pair. Without it, every assertion above would
     * pass against a composer that blocked and warned unconditionally — which
     * would be a worse product than the one that said nothing.
     */
    await mount()

    expect(screen.getByText(HEALTHY_PREVIEW.identity)).toBeTruthy()
    expect(screen.queryByText('This email cannot be sent yet')).toBeNull()
  })

  it('leaves Send enabled once the email is written', async () => {
    await mount()
    await writeTheEmail()

    expect(sendButton().disabled).toBe(false)
  })
})

describe('the From-address picker appears only when there is a choice', () => {
  it('is absent for a site with one identity', async () => {
    identityOptions = [
      { value: 'platform', from: 'noreply@aglyn.com', selectable: true, status: 'platform' },
    ]

    await mount()

    // A select with one option is a control that reads as a decision somebody
    // forgot to take.
    expect(screen.queryByLabelText('From address')).toBeNull()
  })

  it('is offered when the site has a verified domain as well', async () => {
    identityOptions = [
      { value: 'platform', from: 'noreply@aglyn.com', selectable: true, status: 'platform' },
      { value: 'acme.com', from: 'news@acme.com', selectable: true, status: 'verified' },
    ]

    await mount()

    expect(screen.getByLabelText('From address')).toBeTruthy()
  })

  it('re-asks the dry run when the identity changes', async () => {
    /*
     * The mechanism behind every refusal assertion above.
     *
     * A picker that changed a local value without re-previewing would show a
     * green readout for an identity nobody had checked — and the first time
     * anybody found out would be the 409 the whole surface exists to move
     * earlier. So the choice has to reach the dry run, and this is the only
     * case in the file that makes it move.
     */
    identityOptions = [
      { value: 'platform', from: 'noreply@aglyn.com', selectable: true, status: 'platform' },
      { value: 'acme.com', from: 'news@acme.com', selectable: true, status: 'verified' },
    ]
    await mount()
    posted.length = 0

    // A MUI `TextField select` is a listbox, not a native `<select>`: the
    // menu opens on `mousedown` and the choice is a click on the option.
    fireEvent.mouseDown(screen.getByLabelText('From address'))
    fireEvent.click(await screen.findByText('noreply@aglyn.com'))
    await settle(500)

    const previews = posted.filter((body) => body.action === 'preview')
    expect(previews.length).toBeGreaterThan(0)
    expect(previews[previews.length - 1].sendingIdentity).toBe('platform')
  })

  it('carries no identity while the site default is chosen', async () => {
    // The control. The send path reads an absent field as "use the site's
    // standing selection", so sending `''` or the domain name would be a
    // different statement — and one the route would have to reduce away.
    identityOptions = [
      { value: 'platform', from: 'noreply@aglyn.com', selectable: true, status: 'platform' },
      { value: 'acme.com', from: 'news@acme.com', selectable: true, status: 'verified' },
    ]
    await mount()

    const previews = posted.filter((body) => body.action === 'preview')
    expect(previews[previews.length - 1].sendingIdentity).toBeUndefined()
  })

  it('does not offer a domain whose DNS is unfinished', async () => {
    identityOptions = [
      { value: 'platform', from: 'noreply@aglyn.com', selectable: true, status: 'platform' },
      {
        value: 'acme.com',
        from: 'news@acme.com',
        selectable: false,
        status: 'records-issued',
      },
    ]

    await mount()

    // One selectable option, so no picker — and specifically no way to choose
    // the identity that would 409. Refusing at the point of choice is cheaper
    // than refusing at the point of send.
    expect(screen.queryByLabelText('From address')).toBeNull()
  })
})

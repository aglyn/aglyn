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
 * THE COMPOSER'S REQUESTS, WATCHED AT THE WIRE.
 *
 * Every action this surface takes waits on an ID token before it builds a
 * request, so the token is the one step whose failure produces no request to
 * inspect, no response to branch on, and nothing for a `!response.ok` arm to
 * report. A composer that scheduled a campaign and issued nothing at all —
 * no send, no audience count, no sending identity — is what that step looks
 * like from the outside when it is unbounded and unreported.
 *
 * These assertions are made against `global.fetch`, never against the API
 * hook: a double standing in for `use-campaign-send-api` could answer every
 * caller correctly while the composer put nothing on the wire, which is
 * precisely the defect. The token the account mints is asserted to arrive in
 * the `Authorization` header of the recorded request, so a request that was
 * never really authorized cannot pass either.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { ID_TOKEN_TIMEOUT_MS } from '@aglyn/shared-util-http/authorized-token'

jest.setTimeout(30_000)

const FIRESTORE = {}

/** How the signed-in account answers `getIdToken()` for the test at hand. */
type TokenBehavior = 'mints' | 'never-settles' | 'rejects' | 'mints-nothing'
let tokenBehavior: TokenBehavior = 'mints'
/** What a working `getIdToken()` hands back. */
let tokenValue = 'token-abc'

const mockGetIdToken = jest.fn((): Promise<string> => {
  switch (tokenBehavior) {
    case 'never-settles':
      // A refresh whose network call is never answered. Firebase's own call
      // carries no deadline, so this promise is pending for the life of the
      // page.
      return new Promise<string>(() => undefined)
    case 'rejects':
      return Promise.reject(new Error('auth/network-request-failed'))
    case 'mints-nothing':
      return Promise.resolve('')
    default:
      return Promise.resolve(tokenValue)
  }
})

jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => FIRESTORE,
  useUser: () => ({ data: { uid: 'uid-test', getIdToken: mockGetIdToken } }),
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

/** Everything the composer put in front of the merchant. */
let notices: Array<{ message: string; variant?: string }> = []
jest.mock('@aglyn/shared-ui-snackstack', () => ({
  useSnackbar: () => ({
    enqueueSnackbar: (message: any, options: any) => {
      notices.push({ message: String(message), variant: options?.variant })
    },
  }),
}))

/** The options the confirm dialog was opened with, most recent last. */
let confirmations: Array<Record<string, any>> = []
jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({
    confirm: (options: Record<string, any>) => {
      confirmations.push(options)
      return Promise.resolve(undefined)
    },
  }),
}))

jest.mock('./use-org-email-topics', () => ({
  useOrgEmailTopics: () => ({
    topics: [{ id: 'marketing', name: 'Promotions and offers' }],
  }),
}))

import CampaignComposer from './campaign-composer'

/** One request as it actually left, headers included. */
interface WireCall {
  url: string
  method: string
  authorization: string | undefined
  body: Record<string, any>
}

let wire: WireCall[] = []

beforeEach(() => {
  jest.useFakeTimers()
  wire = []
  notices = []
  confirmations = []
  tokenBehavior = 'mints'
  tokenValue = 'token-abc'
  mockGetIdToken.mockClear()
  ;(global as any).fetch = jest.fn(async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : {}
    wire.push({
      url: String(url),
      method: String(init?.method ?? 'GET'),
      authorization: init?.headers?.Authorization,
      body,
    })
    if (body.action === 'preview') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sendable: 3,
          suppressed: 0,
          audienceSize: 3,
          audienceTruncated: false,
          consented: 3,
          grandfathered: 0,
          consentWithheld: 0,
          identity: 'Acme <hello@acme.example>',
          identitySource: 'custom',
        }),
      } as any
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ sent: 3, recipients: 3, campaignId: 'c1' }),
    } as any
  })
})

afterEach(() => {
  jest.useRealTimers()
})

/** Let queued timers fire and their promise chains drain. */
const advance = async (ms: number) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms)
  })
}

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label, { exact: false }), {
    target: { value },
  })
}

/** A `datetime-local` value a few hours from now, in the local zone. */
const futureLocalDateTime = (): string => {
  const at = new Date(Date.now() + 4 * 60 * 60 * 1000)
  const pad = (part: number) => String(part).padStart(2, '0')
  return (
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `T${pad(at.getHours())}:${pad(at.getMinutes())}`
  )
}

/** Mount, write the email, and put a future time in `Send at`. */
const composeScheduled = async () => {
  render(<CampaignComposer hostId="host-1" />)
  await advance(500)
  type('Subject', 'Spring sale')
  type('Message', 'Ends Sunday')
  type('Send at', futureLocalDateTime())
  await advance(0)
}

const sends = () =>
  wire.filter(
    (call) =>
      call.url === '/api/campaigns/send' &&
      call.body.action !== 'preview' &&
      call.body.action !== 'renderPreview',
  )
const previews = () =>
  wire.filter((call) => call.body.action === 'preview')

describe('scheduling a campaign', () => {
  it('issues an authorized POST carrying the schedule and its time', async () => {
    await composeScheduled()

    fireEvent.click(screen.getByText('Schedule campaign'))
    await advance(50)

    expect(sends()).toHaveLength(1)
    const send = sends()[0]
    expect(send.url).toBe('/api/campaigns/send')
    expect(send.method).toBe('POST')
    expect(send.authorization).toBe('Bearer token-abc')
    expect(send.body.action).toBe('schedule')
    expect(send.body.sendAtMs).toBeGreaterThan(Date.now())
    expect(send.body.subject).toBe('Spring sale')
    expect(send.body.body).toBe('Ends Sunday')
  })

  it('carries whatever token the account actually minted', async () => {
    /*
     * The anti-vacuity control. A double that answered the composer without
     * a request, or a request assembled without ever asking the account for
     * a token, cannot put this value on the wire — the header has to follow
     * the account, not a constant somebody wrote into a stub.
     */
    tokenValue = 'token-from-this-account-only'
    await composeScheduled()

    fireEvent.click(screen.getByText('Schedule campaign'))
    await advance(50)

    expect(mockGetIdToken).toHaveBeenCalled()
    expect(sends()[0].authorization).toBe(
      'Bearer token-from-this-account-only',
    )
  })

  it('tells the merchant when the sign-in never confirms, and frees the button', async () => {
    /*
     * THE DEFECT THIS FILE EXISTS FOR.
     *
     * The token is awaited in front of the request, so a refresh that is
     * never answered means the click produces no request, no response and no
     * failure — the dialog closes and the composer goes quiet forever with
     * the button latched on `busy`. Nothing about a silent surface tells the
     * merchant their campaign was not scheduled.
     */
    tokenBehavior = 'never-settles'
    await composeScheduled()

    fireEvent.click(screen.getByText('Schedule campaign'))
    await advance(ID_TOKEN_TIMEOUT_MS + 100)

    expect(sends()).toHaveLength(0)
    expect(notices.map((one) => one.message).join(' | ')).toMatch(
      /sign-in could not be confirmed/i,
    )
    expect(notices.some((one) => one.variant === 'error')).toBe(true)
    // Latched on `busy`, the button reads "Working…" and refuses every
    // further click, so a merchant cannot even retry.
    expect(screen.getByText('Schedule campaign')).toBeTruthy()
  })

  it('never posts a send without an Authorization header', async () => {
    /*
     * A token that comes back empty is not permission to send anonymously.
     * The route would refuse it, and the merchant would be told the send
     * failed when what actually happened is that they are not signed in.
     */
    tokenBehavior = 'mints-nothing'
    await composeScheduled()

    fireEvent.click(screen.getByText('Schedule campaign'))
    await advance(50)

    expect(wire.filter((call) => !call.authorization)).toHaveLength(0)
    expect(sends()).toHaveLength(0)
    expect(notices.map((one) => one.message).join(' | ')).toMatch(
      /signed out/i,
    )
  })

  it('names the reason rather than reporting a generic failure', async () => {
    tokenBehavior = 'rejects'
    await composeScheduled()

    fireEvent.click(screen.getByText('Schedule campaign'))
    await advance(50)

    expect(notices.map((one) => one.message)).not.toContain(
      'An error has occurred',
    )
    expect(notices.map((one) => one.message).join(' | ')).toMatch(
      /nothing was sent/i,
    )
  })
})

describe('the recipient count', () => {
  it('issues an authorized POST of its own', async () => {
    render(<CampaignComposer hostId="host-1" />)
    await advance(500)

    expect(previews()).toHaveLength(1)
    expect(previews()[0].url).toBe('/api/campaigns/send')
    expect(previews()[0].authorization).toBe('Bearer token-abc')
  })

  it('stops counting and says why when it cannot be authorized', async () => {
    /*
     * "Counting recipients…" is what this line reads before the first
     * answer. A count that failed before it was ever issued has to replace
     * that sentence, or the composer claims to still be working on something
     * it has stopped doing — and the confirm dialog then admits it cannot
     * read the count while saying nothing about why.
     */
    tokenBehavior = 'rejects'
    render(<CampaignComposer hostId="host-1" />)
    await advance(500)

    expect(screen.queryByText('Counting recipients…')).toBeNull()
    expect(
      screen.getByText(/sign-in could not be confirmed/i),
    ).toBeTruthy()
  })

  it('carries the reason into the confirm dialog', async () => {
    tokenBehavior = 'rejects'
    await composeScheduled()

    fireEvent.click(screen.getByText('Schedule campaign'))
    await advance(50)

    expect(confirmations).toHaveLength(1)
    expect(confirmations[0].description).toContain(
      'The recipient count could not be read',
    )
    expect(confirmations[0].description).toMatch(
      /sign-in could not be confirmed/i,
    )
  })
})

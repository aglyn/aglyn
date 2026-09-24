/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where the route's Request and
 * Response helpers are unavailable.
 *
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
 * `/api/auth/marketing-consent` (AGL-3185), driven in-process.
 *
 * The properties a plausible implementation gets wrong silently: the uid
 * comes from the verified token and nowhere else; the wording version the
 * record carries is THIS deploy's constant, and a client that rendered a
 * different one is refused rather than recorded under the new words; a
 * support session acting as the customer cannot decide for them; and the
 * prompt's "not now" is a dismissal, never a decision.
 *
 * AGL-3305 adds two: an email door is never a console request's to name, and
 * only a VERIFIED address may reopen the list a Yes stands for — the answer
 * is recorded either way.
 */

import { PLATFORM_MARKETING_CONSENT_TEXT_VERSION } from '@aglyn/aglyn/app-utils/platform-marketing-consent'

let mockRecorded: Array<Record<string, unknown>> = []
let mockSnoozed: string[] = []
let mockReadArgs: string[] = []
let mockState: Record<string, unknown> = {}
let mockRecordThrows = false
let mockReadThrows = false
let mockReachArgs: Array<Record<string, unknown>> = []
let mockHold: Record<string, unknown> | null = null
let mockDeclared = 0

// The app's generated manifest names every plugin; what matters here is that
// a verified Yes has the declarations run before the list is reopened.
jest.mock('../constants/plugins.declarations.server.generated', () => ({
  registerPluginServerDeclarations: async () => {
    mockDeclared += 1
  },
}))
const mockDecodedToken: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async (token: string) => {
          // What firebase-admin throws for a token that does not verify.
          if (token !== 'good-token') {
            throw Object.assign(
              new Error('Firebase ID token has invalid signature.'),
              { code: 'auth/argument-error' },
            )
          }
          return mockDecodedToken
        },
      }),
    }),
  },
  isImpersonationSession: (decoded: Record<string, unknown>) =>
    typeof decoded['impersonatedBy'] === 'string',
  // The real rule, one line: a token's own claim.
  isEmailVerified: (decoded: Record<string, unknown>) => decoded['email_verified'] === true,
  readPlatformMarketingReach: async (input: Record<string, unknown>) => {
    mockReachArgs.push(input)
    return { status: 'read', marker: 'reach' }
  },
  platformMarketingHold: (reach: Record<string, unknown>) =>
    reach['marker'] === 'reach' ? mockHold : 'not-the-reach',
  readPlatformMarketingConsentForUser: async (uid: string) => {
    mockReadArgs.push(uid)
    if (mockReadThrows) throw new Error('firestore unavailable')
    return mockState
  },
  recordPlatformMarketingConsent: async (input: Record<string, unknown>) => {
    mockRecorded.push(input)
    if (mockRecordThrows) throw new Error('firestore unavailable')
    return input['decision'] === 'granted'
      ? {
          atMs: 1_700_000_000_000,
          contact: { status: 'recorded' },
          stream: { status: input['mailboxVerified'] ? 'rejoined' : 'unverified' },
        }
      : { atMs: 1_700_000_000_000, contact: { status: 'recorded' } }
  },
  snoozePlatformMarketingPrompt: async (uid: string) => {
    mockSnoozed.push(uid)
    return { atMs: 1_700_000_000_000 }
  },
}))

const route = require('../app/api/auth/marketing-consent/route') as {
  GET: (request: Request) => Promise<Response>
  POST: (request: Request) => Promise<Response>
}

const URL_UNDER_TEST = 'https://console.example.com/api/auth/marketing-consent'

function post(body: unknown, token = 'good-token') {
  return route.POST(
    new Request(URL_UNDER_TEST, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  )
}

function get(url = URL_UNDER_TEST, token = 'good-token') {
  return route.GET(
    new Request(url, { headers: { authorization: `Bearer ${token}` } }),
  )
}

const NOTHING = {
  decision: null,
  atMs: null,
  textVersion: null,
  sourceKind: null,
  promptDismissedAtMs: null,
}

beforeEach(() => {
  mockRecorded = []
  mockSnoozed = []
  mockReadArgs = []
  mockState = { ...NOTHING }
  mockRecordThrows = false
  mockReadThrows = false
  mockReachArgs = []
  mockHold = null
  mockDeclared = 0
  for (const key of Object.keys(mockDecodedToken)) delete mockDecodedToken[key]
  Object.assign(mockDecodedToken, {
    uid: 'caller-uid',
    email: 'caller@example.com',
    name: 'Caller Example',
    email_verified: false,
  })
})

describe('AGL-3185 · POST records the caller’s own decision', () => {
  it('stamps the deploy’s wording version and the token’s identity on a grant', async () => {
    const response = await post({
      decision: 'granted',
      source: 'console-signup',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      decision: 'granted',
      atMs: 1_700_000_000_000,
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      contact: 'recorded',
      stream: 'unverified',
    })
    expect(mockRecorded).toEqual([
      {
        uid: 'caller-uid',
        email: 'caller@example.com',
        name: 'Caller Example',
        decision: 'granted',
        source: 'console-signup',
        textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
        mailboxVerified: false,
      },
    ])
  })

  it('records a refusal from the preferences and from the prompt', async () => {
    for (const source of ['console-preferences', 'console-prompt']) {
      const response = await post({
        decision: 'declined',
        source,
        textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      })
      expect(response.status).toBe(200)
    }
    expect(mockRecorded.map((call) => [call.decision, call.source])).toEqual([
      ['declined', 'console-preferences'],
      ['declined', 'console-prompt'],
    ])
  })

  it('does not gate on a verified address — the sign-up door calls it seconds after creation', async () => {
    mockDecodedToken.email_verified = false
    const response = await post({
      decision: 'granted',
      source: 'console-signup',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    expect(response.status).toBe(200)
  })

  it('treats the prompt’s "not now" as a dismissal, never a decision', async () => {
    const response = await post({ decision: 'dismissed', source: 'console-prompt' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      ok: true,
      decision: 'dismissed',
      atMs: 1_700_000_000_000,
    })
    expect(mockSnoozed).toEqual(['caller-uid'])
    expect(mockRecorded).toHaveLength(0)
  })

  it('refuses a client that names a wording version it was not shown', async () => {
    const response = await post({
      decision: 'granted',
      source: 'console-signup',
      textVersion: '1999-01-01',
    })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'The consent wording changed — please review it again.',
      reason: 'version-mismatch',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    expect(mockRecorded).toHaveLength(0)
  })

  it.each([
    ['an unknown source', { decision: 'granted', source: 'website', textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION }],
    // AGL-3305: the email doors are recorded by the marketing site's own
    // pages, from a signed link. A console click is not a click in a mailbox.
    ['an email door', { decision: 'declined', source: 'email-unsubscribe', textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION }],
    ['a resubscribe claimed from the console', { decision: 'granted', source: 'email-resubscribe', textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION }],
    ['an unknown decision', { decision: 'maybe', source: 'console-prompt', textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION }],
    ['a dismissal from a door that is not the prompt', { decision: 'dismissed', source: 'console-preferences' }],
    ['a refusal claiming the sign-up form', { decision: 'declined', source: 'console-signup', textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION }],
    ['a decision with no wording version', { decision: 'granted', source: 'console-prompt' }],
    ['no body at all', undefined],
  ])('refuses %s with a 400 and records nothing', async (_label, body) => {
    const response = await post(body)
    expect(response.status).toBe(400)
    expect(mockRecorded).toHaveLength(0)
    expect(mockSnoozed).toHaveLength(0)
  })

  it('refuses a support session acting as the customer', async () => {
    mockDecodedToken.impersonatedBy = 'staff-uid'
    const response = await post({
      decision: 'granted',
      source: 'console-preferences',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    expect(response.status).toBe(403)
    expect((await response.json()).reason).toBe('impersonation')
    expect(mockRecorded).toHaveLength(0)
  })

  it('refuses without a bearer token, and with an unverifiable one', async () => {
    const anonymous = await route.POST(
      new Request(URL_UNDER_TEST, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision: 'granted', source: 'console-prompt' }),
      }),
    )
    expect(anonymous.status).toBe(401)
    const forged = await post(
      { decision: 'granted', source: 'console-prompt', textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION },
      'forged',
    )
    expect(forged.status).toBe(401)
    expect(mockRecorded).toHaveLength(0)
  })

  it('answers 500, not success, when the record could not be written', async () => {
    mockRecordThrows = true
    const response = await post({
      decision: 'granted',
      source: 'console-prompt',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBeTruthy()
  })
})

describe('AGL-3185 · GET answers for the caller, and decides the prompt', () => {
  it('reads the TOKEN’s uid and ignores a uid on the query string', async () => {
    await get(`${URL_UNDER_TEST}?uid=someone-else`)
    expect(mockReadArgs).toEqual(['caller-uid'])
  })

  it('says the prompt is due when nothing has been recorded', async () => {
    const payload = await (await get()).json()
    expect(payload).toEqual({
      ...NOTHING,
      promptDue: true,
      currentTextVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
  })

  it('never asks again after a refusal', async () => {
    mockState = {
      ...NOTHING,
      decision: 'declined',
      atMs: 1_600_000_000_000,
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
      sourceKind: 'console-prompt',
    }
    const payload = await (await get()).json()
    expect(payload.decision).toBe('declined')
    expect(payload.promptDue).toBe(false)
  })

  it('stays quiet inside the snooze after a dismissal', async () => {
    mockState = { ...NOTHING, promptDismissedAtMs: Date.now() - 1000 }
    expect((await (await get()).json()).promptDue).toBe(false)
  })

  it('refuses without a bearer token', async () => {
    const anonymous = await route.GET(new Request(URL_UNDER_TEST))
    expect(anonymous.status).toBe(401)
    expect(mockReadArgs).toHaveLength(0)
  })

  it('does not answer "not decided" when the record could not be read', async () => {
    // A 200 with `promptDue: true` would prompt somebody who already
    // answered — an unread record reported as an empty one.
    mockReadThrows = true
    const response = await get()
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBeTruthy()
  })
})

describe('AGL-3305 · a Yes reopens the list only for a verified address', () => {
  it('hands the token’s verification to the writer, and reports what the list did', async () => {
    mockDecodedToken.email_verified = true
    const response = await post({
      decision: 'granted',
      source: 'console-preferences',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    expect(response.status).toBe(200)
    expect((await response.json()).stream).toBe('rejoined')
    expect(mockRecorded[0]).toMatchObject({ mailboxVerified: true })
    // The slot the reopen goes through is filled by the plugins' declarations,
    // run here for a process whose boot did not.
    expect(mockDeclared).toBe(1)
  })

  it('records an unverified Yes but reopens nothing', async () => {
    const response = await post({
      decision: 'granted',
      source: 'console-preferences',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    expect(response.status).toBe(200)
    expect((await response.json()).stream).toBe('unverified')
    expect(mockRecorded[0]).toMatchObject({ decision: 'granted', mailboxVerified: false })
    expect(mockDeclared).toBe(0)
  })

  it('says nothing about a list on a No', async () => {
    const response = await post({
      decision: 'declined',
      source: 'console-preferences',
      textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    })
    expect((await response.json()).stream).toBeNull()
  })
})

describe('AGL-3305 · GET ?detail=hold says what keeps a Yes from arriving', () => {
  const GRANTED = {
    ...NOTHING,
    decision: 'granted',
    atMs: 1_600_000_000_000,
    textVersion: PLATFORM_MARKETING_CONSENT_TEXT_VERSION,
    sourceKind: 'console-signup',
  }

  it('reads nothing of the operator’s for the prompt’s plain read', async () => {
    mockState = GRANTED
    const payload = await (await get()).json()
    expect(payload).not.toHaveProperty('hold')
    expect(mockReachArgs).toHaveLength(0)
  })

  it('reads the reach for the token’s own address and answers its hold', async () => {
    mockState = GRANTED
    mockHold = { kind: 'unsubscribed' }
    mockDecodedToken.email_verified = true
    const payload = await (await get(`${URL_UNDER_TEST}?detail=hold&email=other@example.com`)).json()
    expect(payload.hold).toEqual({ kind: 'unsubscribed' })
    expect(payload.mailboxVerified).toBe(true)
    expect(mockReachArgs).toEqual([{ email: 'caller@example.com' }])
  })

  it('reads no reach for a No — the No is the reason', async () => {
    mockState = { ...GRANTED, decision: 'declined' }
    const payload = await (await get(`${URL_UNDER_TEST}?detail=hold`)).json()
    expect(payload.hold).toBeNull()
    expect(payload.mailboxVerified).toBe(false)
    expect(mockReachArgs).toHaveLength(0)
  })
})

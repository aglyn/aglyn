/**
 * @jest-environment node
 */
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
 * The host of an account address's confirmation link (AGL-2983).
 *
 * The link carries a bearer secret that `confirm` redeems for whoever holds
 * it, and it was built on the request's `Origin` header — so a signed-in
 * caller could have the platform email anybody a genuine confirmation whose
 * button pointed at the caller's own host. The origin now comes from server
 * configuration, as a password reset's does. Both directions are pinned:
 * a forged Origin lands on the console, and an allowlisted one is honored,
 * so the fix cannot pass by ignoring the header altogether.
 */

export {}

const mockSent: Array<Record<string, any>> = []

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => true,
  sendEmail: async (options: Record<string, any>) => {
    mockSent.push(options)
    return { sent: true, id: 'em_1' }
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'u-1', email: 'me@example.com', email_verified: true }),
      }),
    }),
  },
  addAccountEmail: async (_uid: string, address: string) => ({
    ok: true,
    refusal: null,
    message: null,
    address,
    secret: 'tokenid.secret',
  }),
  confirmAccountEmail: async () => ({ ok: false, refusal: 'token-invalid', message: 'x' }),
  consumeRateLimit: async () => ({ allowed: true }),
  issueVerificationToken: async () => 'tokenid.secret',
  listAccountEmails: async () => [],
  meterPlatformEmail: async () => undefined,
  removeAccountEmail: async () => ({ ok: true }),
  setPrimaryAccountEmail: async () => ({ ok: true }),
}))

/** What the confirmation's template renders; null unless a test says. */
const mockRender = jest.fn(
  async (
    _key: string,
    _merge?: Record<string, string>,
  ): Promise<Record<string, string> | null> => null,
)

jest.mock('../../_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: (key: string, merge?: Record<string, string>) =>
    mockRender(key, merge),
}))

import { POST } from './route'

const add = (origin: string) =>
  POST(
    new Request('https://app.aglyn.com/api/account/emails', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
        origin,
      },
      body: JSON.stringify({ action: 'add', address: 'someone@example.com' }),
    }),
  )

const linkInLastMail = () =>
  String(mockSent[mockSent.length - 1]?.['text'] ?? '')
    .split('\n')
    .find((line) => line.includes('confirmEmail=')) ?? ''

beforeEach(() => {
  mockSent.length = 0
  mockRender.mockReset()
  mockRender.mockResolvedValue(null)
  delete process.env['NEXT_PUBLIC_CONSOLE_URL']
  delete process.env['AUTH_ACTION_ALLOWED_ORIGINS']
})

describe('POST /api/account/emails — the confirmation link’s host (AGL-2983)', () => {
  it('builds the link on the console, not on a host the caller sent', async () => {
    const response = await add('https://attacker.example')
    expect(response.status).toBe(200)
    expect(linkInLastMail()).toBe('https://app.aglyn.com/manage/user?confirmEmail=tokenid.secret')
  })

  it('still honors an allowlisted origin, such as a preview that tests itself', async () => {
    process.env['AUTH_ACTION_ALLOWED_ORIGINS'] = 'https://preview.aglyn.example'
    await add('https://preview.aglyn.example')
    expect(linkInLastMail()).toBe('https://preview.aglyn.example/manage/user?confirmEmail=tokenid.secret')
  })
})

/**
 * Which copy confirms an ADDED address (AGL-3322).
 *
 * Its own template, not the sign-up confirmation's: that one's copy is all
 * about creating an account, and this mail goes to an address someone is
 * adding to an account that already exists. What the template renders — a
 * staff design, or the built-in copy in the platform's header and footer — is
 * what goes out; the route's own copy is the last resort behind it.
 */
describe('POST /api/account/emails — the confirmation’s copy (AGL-3322)', () => {
  const lastMail = () => mockSent[mockSent.length - 1] ?? {}

  it('renders its own template, with the link as its token', async () => {
    await add('https://app.aglyn.com')
    expect(mockRender).toHaveBeenCalledTimes(1)
    expect(mockRender).toHaveBeenCalledWith('email-address-confirmation', {
      confirmUrl: 'https://app.aglyn.com/manage/user?confirmEmail=tokenid.secret',
    })
  })

  it('sends what the template renders', async () => {
    mockRender.mockResolvedValue({
      subject: 'Rendered subject',
      html: '<p>Rendered body</p>',
      text: 'Rendered body',
      source: 'default',
    })
    await add('https://app.aglyn.com')
    expect(lastMail()['subject']).toBe('Rendered subject')
    expect(lastMail()['text']).toBe('Rendered body')
    expect(lastMail()['html']).toBe('<p>Rendered body</p>')
  })

  it('falls back to its own copy when nothing renders', async () => {
    await add('https://app.aglyn.com')
    expect(lastMail()['subject']).toBe('Confirm your email address')
    expect(lastMail()['text']).toContain('If you did not ask to add this address')
    expect(lastMail()['html']).toBeUndefined()
  })
})

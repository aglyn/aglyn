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
 * WHICH IDENTITY ONE SITE SENDS AS — the per-host half.
 *
 * Two properties, and they pull in opposite directions, which is why they are
 * two gates rather than one:
 *
 *  1. **Anyone who may compose has to be able to READ it.** The composer
 *     names the address a campaign will leave on and refuses on it; behind an
 *     org-admin gate, an editor would meet an empty box where the answer
 *     goes and a Send button with no explanation attached.
 *  2. **Only an org admin may WRITE it.** A site `admin` is not necessarily
 *     an org member at all — a site-scoped collaborator carries a host role
 *     and no org standing — so a host-role gate would let a collaborator on
 *     one client's site move that site's mail onto another client's verified
 *     domain.
 *
 * And one more, asserted last: a selection is only accepted for a domain that
 * is actually verified. The send would refuse an unfinished one anyway, but a
 * site left pointing at it is a site whose every campaign fails until somebody
 * notices — and the person who could have prevented that was standing here.
 */

const mockState: {
  hostRole: string
  canManage: boolean
  entitled: boolean
  domains: Array<Record<string, unknown>>
  written: Record<string, unknown> | null
} = {
  hostRole: 'admin',
  canManage: true,
  entitled: true,
  domains: [],
  written: null,
}

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
  checkEntitlement: () => mockState.entitled,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    const raw = await request.text().catch(() => '')
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: raw ? JSON.parse(raw) : {},
      headers: Object.fromEntries(request.headers.entries()),
    }
  },
}))

/** What the host document holds, before anything this route writes. */
let mockHostDoc: Record<string, unknown> = {}

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: async () => ({ uid: 'uid-1', email_verified: true }),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: true,
              data: () => mockHostDoc,
              get: (field: string) =>
                field === 'memberRoles'
                  ? { 'uid-1': mockState.hostRole }
                  : mockHostDoc[field],
            }),
            set: async (value: Record<string, unknown>) => {
              mockState.written = value
            },
          }),
        }),
      }),
    }),
    firestore: { FieldValue: { delete: () => '__delete__' } },
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'unverified' }, { status: 403 }),
  isImpersonationSession: () => false,
  lockdownRefusal: async () => null,
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'agency' } }),
  listSendingDomains: async () => mockState.domains,
  /*
   * The site's own provisioned domain. Built through the REAL naming
   * function, so "clearing the selection returns the site to its own domain"
   * is a statement about the name the product would actually issue rather
   * than about a literal written here.
   */
  ensureHostSendingDomain: async (options: Record<string, any>) => {
    const email = jest.requireActual('@aglyn/shared-util-email')
    const domain = email.platformSendingDomainFor(
      String(mockHostDoc['sendingLabel'] ?? options?.subdomain ?? ''),
    )
    return { domain: domain || null, label: null, created: false, error: null }
  },
  memberHasOrgPermission: async () => mockState.canManage,
  resolveOrgMembership: async () => ({ member: { role: 'admin' } }),
  /*
   * The REAL decision. The route's whole job on the read is to report what a
   * send would resolve to, so stubbing this would make the readout a report
   * of the stub — and the composer trusts this answer enough to disable Send
   * on it.
   */
  resolveHostSendingIdentity: async (options: Record<string, any>) => {
    const email = jest.requireActual('@aglyn/shared-util-email')
    const domain = String(options?.selectedDomain ?? '')
    const record = mockState.domains.find((one) => one['domain'] === domain)
    return email.resolveSendingIdentity({
      selection: domain
        ? {
            domain,
            status: (record?.['status'] as string) ?? 'failed',
            localPart: String(options?.selectedLocalPart ?? 'hello'),
            missing: (record?.['lastMissing'] as string[]) ?? [],
          }
        : null,
      platformFrom: process.env.USAGE_EMAIL_FROM || null,
    })
  },
}))

import { GET, POST } from '../app/api/email/sending-identity/route'

const AUTH = { authorization: 'Bearer token' }
const URL_BASE = 'https://app.aglyn.com/api/email/sending-identity'

const read = () =>
  GET(new Request(`${URL_BASE}?hostId=host-1`, { headers: AUTH }))

const write = (body: Record<string, unknown>) =>
  POST(
    new Request(URL_BASE, {
      method: 'POST',
      headers: { ...AUTH, 'content-type': 'application/json' },
      body: JSON.stringify({ hostId: 'host-1', ...body }),
    }),
  )

let previousFrom: string | undefined
beforeAll(() => {
  previousFrom = process.env['USAGE_EMAIL_FROM']
  process.env['USAGE_EMAIL_FROM'] = 'noreply@aglyn.com'
})
afterAll(() => {
  if (previousFrom === undefined) delete process.env['USAGE_EMAIL_FROM']
  else process.env['USAGE_EMAIL_FROM'] = previousFrom
})

beforeEach(() => {
  mockState.hostRole = 'admin'
  mockState.canManage = true
  mockState.entitled = true
  mockState.written = null
  mockState.domains = [
    { domain: 'acme.com', status: 'verified' },
    { domain: 'beta.com', status: 'records-issued', lastMissing: ['TXT:send.beta.com'] },
  ]
  mockHostDoc = { sendingDomain: 'acme.com', sendingLocalPart: 'news' }
})

describe('reading is open to anyone who may compose', () => {
  it('answers an editor', async () => {
    mockState.hostRole = 'editor'

    const response = await read()

    expect(response.status).toBe(200)
  })

  it('answers an editor who is not an org admin', async () => {
    // The case the two gates exist for. An editor cannot change the identity
    // and must still be told what it is, because the composer refuses on it.
    mockState.hostRole = 'editor'
    mockState.canManage = false

    const body = await (await read()).json()

    expect(body.identity).toContain('news@acme.com')
    expect(body.canManage).toBe(false)
  })

  it('refuses somebody with no role on the site', async () => {
    mockState.hostRole = 'viewer'

    expect((await read()).status).toBe(403)
  })
})

describe('the read reports what a SEND would resolve, not a second opinion', () => {
  it('names the verified address', async () => {
    const body = await (await read()).json()

    expect(body.identity).toContain('news@acme.com')
    expect(body.identitySource).toBe('custom')
    expect(body.refusal).toBeNull()
  })

  it('carries the refusal when the selected domain is unfinished', async () => {
    mockHostDoc = { sendingDomain: 'beta.com', sendingLocalPart: 'news' }

    const body = await (await read()).json()

    // The composer disables Send on exactly this, so it has to be here and it
    // has to name the domain.
    expect(body.refusal?.code).toBe('domain-unverified')
    expect(body.refusal?.message).toContain('beta.com')
  })

  it('offers only the SITE’s own domain, never the org’s other verified names', async () => {
    /*
     * The cross-client boundary, at the surface that could leak it.
     *
     * `acme.com` and `beta.com` are both this org's. A composer offered every
     * verified name in the org would let an editor of one client's site put
     * another client's domain in the `From:` line — cross-site reach arriving
     * through the sender rather than through the audience.
     */
    mockState.domains = [
      { domain: 'acme.com', status: 'verified' },
      { domain: 'other-client.com', status: 'verified' },
    ]

    const body = await (await read()).json()
    const offered = body.options.map((one: any) => one.value)

    expect(offered).toContain('acme.com')
    expect(offered).not.toContain('other-client.com')
    // And the shared Aglyn address is not among them. It used to head this
    // list; a site sending there charges its list's complaint rate against
    // the domain the platform's own billing mail depends on.
    expect(offered).not.toContain('platform')
    for (const value of offered) {
      expect(String(value)).not.toContain('aglyn.com')
    }
  })

  it('marks an unfinished domain as offered-but-not-selectable', async () => {
    mockHostDoc = { sendingDomain: 'beta.com', sendingLocalPart: 'news' }

    const body = await (await read()).json()
    const beta = body.options.find((one: any) => one.value === 'beta.com')

    // Shown, so the composer can say what the site is pointed at — and not
    // selectable, so nobody can choose the identity that would 409.
    expect(beta.selectable).toBe(false)
  })
})

describe('writing needs the org admin role', () => {
  it('refuses a site admin who is not an org admin', async () => {
    mockState.canManage = false

    const response = await write({ domain: 'acme.com' })

    expect(response.status).toBe(403)
    // The refusal is total: nothing was written on the way to answering.
    expect(mockState.written).toBeNull()
  })

  it('accepts an org admin', async () => {
    const response = await write({ domain: 'acme.com', localPart: 'hello' })

    expect(response.status).toBe(200)
    expect(mockState.written).toMatchObject({
      sendingDomain: 'acme.com',
      sendingLocalPart: 'hello',
    })
  })

  it('refuses a plan without white-label', async () => {
    mockState.entitled = false

    expect((await write({ domain: 'acme.com' })).status).toBe(403)
    expect(mockState.written).toBeNull()
  })
})

describe('a selection is only accepted for a verified domain', () => {
  it('refuses a domain whose DNS is unfinished, and says which', async () => {
    const response = await write({ domain: 'beta.com' })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toContain('beta.com')
    expect(mockState.written).toBeNull()
  })

  it('refuses a domain this workspace never claimed', async () => {
    const response = await write({ domain: 'somebody-else.com' })

    expect(response.status).toBe(404)
    expect(mockState.written).toBeNull()
  })

  /**
   * Clearing the selection returns the site to ITS OWN domain, never to the
   * shared Aglyn one and never to nothing at all.
   *
   * It used to delete both keys, which meant "send as Aglyn". That is the
   * coupling this feature exists to break. Deleting them NOW would be worse
   * still: a site with no sending domain refuses every message, so an admin
   * choosing "stop using our own domain" would silently switch their receipts
   * off.
   *
   * `sendingLocalPart` is still deleted — the mailbox reverts to the default
   * while the domain becomes the site's provisioned one.
   */
  it('returns the site to its own provisioned domain, not to aglyn.com', async () => {
    mockHostDoc = { subdomain: 'acme', sendingLabel: 'acme' }

    const response = await write({ domain: 'platform' })

    expect(response.status).toBe(200)
    expect(mockState.written.sendingDomain).toBe('acme.mail.aglyn.app')
    expect(mockState.written.sendingDomain).not.toContain('aglyn.com')
    expect(mockState.written.sendingLocalPart).toBe('__delete__')
  })
})

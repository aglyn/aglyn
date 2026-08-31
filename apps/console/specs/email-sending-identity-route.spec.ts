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
  /**
   * The owning org's PLAN, not a pre-answered entitlement.
   *
   * `checkEntitlement` is left unmocked below so the gate resolves against the
   * real plan table. A mock returning a boolean proves only that the route
   * reads something, and would pass identically whichever flag it named.
   */
  plan: string
  domains: Array<Record<string, unknown>>
  written: Record<string, unknown> | null
} = {
  hostRole: 'admin',
  canManage: true,
  plan: 'pro',
  domains: [],
  written: null,
}

jest.mock('@aglyn/aglyn/server', () => ({
  ...jest.requireActual('@aglyn/aglyn/server'),
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
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: mockState.plan } }),
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
  mockState.plan = 'pro'
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

  /**
   * THE LADDER, READ FROM BEHAVIOR — the per-site half of the same gate the
   * org's domain list applies, resolved from the real plan table on both
   * sides so a gate moved to another flag fails one of them.
   */
  it.each(['pro', 'business', 'agency', 'enterprise'])(
    'lets a %s org point a site at a domain it owns',
    async (plan) => {
      mockState.plan = plan

      expect((await write({ domain: 'acme.com' })).status).toBe(200)
      expect(mockState.written).toMatchObject({ sendingDomain: 'acme.com' })
    },
  )

  it.each(['free', 'starter'])('refuses a %s org, and writes nothing', async (plan) => {
    mockState.plan = plan

    const response = await write({ domain: 'acme.com' })
    const { error } = await response.json()

    expect(response.status).toBe(403)
    expect(error).toMatch(/Pro plan/i)
    // The refusal covers the CUSTOM domain only. A site below the tier keeps
    // the address Aglyn issues it, so the message must not read as mail
    // stopping.
    expect(error).toMatch(/keeps sending/i)
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
   * The MAILBOX is left where its owner put it. Which mailbox a site sends as
   * and which domain it sends on are set from different controls and answer
   * different questions, so moving the domain must not also rename the
   * address — that was one control silently taking two decisions.
   */
  it('returns the site to its own provisioned domain, not to aglyn.com', async () => {
    mockHostDoc = { subdomain: 'acme', sendingLabel: 'acme' }

    const response = await write({ domain: 'platform' })

    expect(response.status).toBe(200)
    expect(mockState.written.sendingDomain).toBe('acme.mail.aglyn.app')
    expect(mockState.written.sendingDomain).not.toContain('aglyn.com')
    expect(mockState.written.sendingLocalPart).toBeUndefined()
  })

  it('keeps a chosen mailbox when the domain moves back to the issued one', async () => {
    mockHostDoc = {
      subdomain: 'acme',
      sendingLabel: 'acme',
      sendingLocalPart: 'jamie',
    }

    const response = await write({ domain: 'platform' })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ localPart: 'jamie' })
    expect(mockState.written.sendingLocalPart).toBeUndefined()
  })
})

/**
 * THE MAILBOX A SITE SENDS AS.
 *
 * The domain is never a merchant's to choose — DMARC on the sending apex is
 * published `adkim=s`, so the `From:` domain must be the domain whose DKIM key
 * signed the message. The part in front of the `@` is, and it reaches an SMTP
 * envelope and a header, so what it is refused for is the load-bearing half of
 * this block.
 */
describe('choosing the mailbox this site sends as', () => {
  it('refuses a mailbox name rather than silently answering hello', async () => {
    mockHostDoc = { subdomain: 'acme', sendingLabel: 'acme' }

    const response = await write({ localPart: 'sales team!' })

    expect(response.status).toBe(400)
    const payload = await response.json()
    expect(payload.error).toContain('letters, numbers')
    expect(mockState.written).toBeNull()
  })

  it('refuses a mailbox name carrying a second header', async () => {
    mockHostDoc = { subdomain: 'acme', sendingLabel: 'acme' }

    const response = await write({
      localPart: `sales${String.fromCharCode(10)}Bcc: attacker@evil.test`,
    })

    expect(response.status).toBe(400)
    expect(mockState.written).toBeNull()
  })

  it('refuses an operational mailbox', async () => {
    mockHostDoc = { subdomain: 'acme', sendingLabel: 'acme' }

    const response = await write({ localPart: 'postmaster' })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('reserved')
    expect(mockState.written).toBeNull()
  })

  /**
   * A body with no `domain` key is not a decision about the domain.
   *
   * An empty one has always meant "move this site back to the address Aglyn
   * issues it", and the drawer that edits the sender must not be able to say
   * that by accident: a site sending as its own verified `acme.com` would
   * have its selection reset the first time somebody renamed the mailbox.
   */
  it('does not touch the domain when the body names none', async () => {
    mockHostDoc = {
      subdomain: 'acme',
      sendingLabel: 'acme',
      sendingDomain: 'acme.com',
    }

    const response = await write({ localPart: 'jamie', fromName: 'Jamie' })

    expect(response.status).toBe(200)
    expect(mockState.written.sendingDomain).toBeUndefined()
    expect(mockState.written.sendingLocalPart).toBe('jamie')
    expect(mockState.written.sendingFromName).toBe('Jamie')
  })

  /**
   * The pooled address has ONE fixed mailbox, shared by every site on it.
   *
   * `resolveSendingIdentity` builds its shared arm from the operator's own
   * address and never reads the site's `localPart`, so storing one for a
   * pooled site would store a setting with no effect — and put a merchant's
   * own department name on a domain they plainly do not own.
   */
  it('refuses a mailbox for a site with no domain of its own', async () => {
    mockHostDoc = { subdomain: 'acme' }

    const response = await write({ localPart: 'sales' })

    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('shared Aglyn address')
    expect(mockState.written).toBeNull()
  })

  /**
   * The half of "send as a person" that does not depend on owning a name.
   *
   * A display name and a reply address are honored on the pooled address
   * exactly as they are on a site's own domain, so refusing the whole save
   * over the one field a pooled site cannot set would withhold the free half
   * of a capability over the paid half.
   */
  it('accepts a sender name and reply address on the pooled address', async () => {
    mockHostDoc = { subdomain: 'acme' }

    const response = await write({
      fromName: 'Jamie at Acme',
      replyTo: 'jamie@acme-corp.com',
    })

    expect(response.status).toBe(200)
    expect(mockState.written.sendingFromName).toBe('Jamie at Acme')
    expect(mockState.written.sendingReplyTo).toBe('jamie@acme-corp.com')
  })

  it('refuses a reply address that is not an address', async () => {
    mockHostDoc = { subdomain: 'acme', sendingLabel: 'acme' }

    const response = await write({ replyTo: 'jamie at acme dot com' })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('full email address')
    expect(mockState.written).toBeNull()
  })

  /**
   * Clearing an optional field unsets it rather than storing an empty string.
   *
   * A stored `''` reads as a value on every surface that tests for presence,
   * which is the shape that makes an absent setting render as a real one.
   */
  it('unsets a cleared sender name instead of storing it empty', async () => {
    mockHostDoc = {
      subdomain: 'acme',
      sendingLabel: 'acme',
      sendingFromName: 'Jamie',
    }

    const response = await write({ fromName: '' })

    expect(response.status).toBe(200)
    expect(mockState.written.sendingFromName).toBe('__delete__')
  })
})

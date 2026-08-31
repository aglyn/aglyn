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
  /** Every call that reached the claim, so "nothing claims by itself" is testable. */
  claims: Array<Record<string, unknown>>
} = {
  hostRole: 'admin',
  canManage: true,
  plan: 'pro',
  domains: [],
  written: null,
  claims: [],
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
/**
 * `hosts/{hostId}/senders`, keyed by document id.
 *
 * A real subcollection rather than a pre-answered array, because the route's
 * whole no-backfill design turns on the difference between EMPTY and holding
 * rows: an empty one means the site's single sender is the three fields on the
 * host document, and the first write has to materialize it there rather than
 * inventing a new one.
 */
let mockSenders: Record<string, Record<string, unknown>> = {}

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
              /*
               * MERGED as well as recorded. The assertions read `written`,
               * which is the last patch and is what they are about — but the
               * route reads the host document back through the same snapshot
               * within one request, and a double that dropped the write would
               * let a projection pass while never becoming the site's state.
               */
              mockHostDoc = { ...mockHostDoc, ...value }
            },
            collection: () => ({
              doc: (id: string) => ({
                id,
                get: async () => ({
                  exists: mockSenders[id] !== undefined,
                  id,
                  data: () => mockSenders[id],
                  get: (field: string) => mockSenders[id]?.[field],
                }),
                set: async (value: Record<string, unknown>) => {
                  mockSenders[id] = { ...(mockSenders[id] ?? {}), ...value }
                },
                delete: async () => {
                  delete mockSenders[id]
                },
              }),
              // `limit` HONORS its argument: a double that returned everything
              // could not fail the way the real query does.
              limit: (max: number) => ({
                get: async () => {
                  const ids = Object.keys(mockSenders).sort().slice(0, max)
                  return {
                    docs: ids.map((id) => ({
                      id,
                      data: () => mockSenders[id],
                      get: (field: string) => mockSenders[id]?.[field],
                    })),
                  }
                },
              }),
            }),
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
   * Whether the org's PLAN carries a dedicated subdomain, which is what
   * decides whether the read offers one. Resolved from the real ladder against
   * `mockState.plan`, so the offer appears for the tiers that carry it and for
   * no others without a second list of plan names in this file.
   */
  orgHoldsDedicatedSendingDomain: async () => {
    const aglyn = jest.requireActual(
      '@aglyn/aglyn/app-utils/dedicated-sending-domain',
    )
    return aglyn.planHoldsDedicatedSendingDomain(mockState.plan)
  },
  /*
   * The claim, recorded rather than performed, and named through the REAL
   * naming function so what the route answers with is the name the product
   * would actually issue rather than a literal written here.
   *
   * It records that it was CALLED, which is what the automatic-provisioning
   * assertions read: the guarantee those protect is that nothing but the
   * request action reaches this.
   */
  requestHostSendingDomain: async (options: Record<string, any>) => {
    mockState.claims.push(options)
    const aglyn = jest.requireActual(
      '@aglyn/aglyn/app-utils/dedicated-sending-domain',
    )
    if (!aglyn.planHoldsDedicatedSendingDomain(mockState.plan)) {
      return {
        domain: null,
        label: null,
        created: false,
        error: 'plan-no-dedicated-domain',
      }
    }
    const email = jest.requireActual('@aglyn/shared-util-email')
    const domain = email.platformSendingDomainFor(
      email.mailLabelCandidate(String(options?.subdomain ?? ''), 1),
    )
    return {
      domain: domain || null,
      label: null,
      created: Boolean(domain),
      error: domain ? null : 'no-label',
    }
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
import { DEDICATED_SENDING_DOMAIN_MIN_PLAN } from '@aglyn/aglyn/app-utils/dedicated-sending-domain'
import { PLAN_LABELS } from '@aglyn/aglyn'

/**
 * The tier the refusal should name, DERIVED the way the route derives it.
 *
 * Asserting the literal "Pro" would be the same defect the route was changed
 * to avoid: pricing copy pinned in a place that keeps rendering after the gate
 * beneath it moves. This reads the same table the gate does, so a re-cut of
 * the dedicated floor moves the expectation with it — and a route that stopped
 * naming a tier at all still fails.
 */
const DEDICATED_PLAN_LABEL = PLAN_LABELS[DEDICATED_SENDING_DOMAIN_MIN_PLAN]

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
  mockState.claims = []
  mockState.domains = [
    { domain: 'acme.com', status: 'verified' },
    { domain: 'beta.com', status: 'records-issued', lastMissing: ['TXT:send.beta.com'] },
  ]
  mockHostDoc = { sendingDomain: 'acme.com', sendingLocalPart: 'news' }
  mockSenders = {}
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
   * Clearing the selection returns the site to the domain it was ISSUED,
   * never to the shared Aglyn one.
   *
   * It used to delete both keys, which meant "send as `aglyn.com`". That is
   * the coupling this feature exists to break.
   *
   * The MAILBOX is left where its owner put it. Which mailbox a site sends as
   * and which domain it sends on are set from different controls and answer
   * different questions, so moving the domain must not also rename the
   * address — that was one control silently taking two decisions.
   */
  it('returns the site to its own issued domain, not to aglyn.com', async () => {
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

  /**
   * A SITE THAT WAS NEVER ISSUED ONE CLEARS TO THE POOL, AND CLAIMS NOTHING.
   *
   * Clearing is somebody stepping back from a choice. Answering it by spending
   * a provider domain slot and three zone records would make "stop using our
   * own domain" the cheapest route to the ceiling — reached through a control
   * whose label promises the opposite of acquiring something.
   *
   * It is safe to clear to nothing now because a site with no sending domain
   * sends its transactional mail pooled rather than refusing everything, which
   * is the property that used to make this branch claim defensively.
   */
  it('clears to the pool for a site with no issued domain, and claims none', async () => {
    mockHostDoc = { subdomain: 'acme' }

    const response = await write({ domain: 'platform' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockState.written.sendingDomain).toBe('__delete__')
    expect(mockState.claims).toEqual([])
    /*
     * AND IT SAYS WHAT WAS LOST.
     *
     * Clearing to the pool stops campaigns, because marketing does not leave
     * on a shared address. That is a real demotion and the merchant chose it;
     * what it must not be is silent, which is the whole reason this branch is
     * allowed to clear instead of quietly claiming a domain to avoid the
     * conversation.
     */
    expect(body.pooled).toBe(true)
    expect(body.warning).toMatch(/campaigns are blocked/i)
    expect(body.warning).toMatch(/receipts/i)
  })

  /**
   * A mailbox cannot ride along to the pool. A shared member's address is
   * where every site on it gets its bounces back, so it is not one site's to
   * name — and a body that clears the domain and renames the mailbox in one
   * call reaches this branch rather than the mailbox-only one.
   */
  it('refuses a mailbox chosen on the way to the pool', async () => {
    mockHostDoc = { subdomain: 'acme' }

    const response = await write({ domain: 'platform', localPart: 'sales' })

    expect(response.status).toBe(409)
    expect(mockState.written).toBeNull()
    expect(mockState.claims).toEqual([])
  })
})

/*==========================================
  The dedicated subdomain is asked for, never issued
==========================================*/

/**
 * THE ONLY PATH THAT SPENDS A PROVIDER DOMAIN SLOT.
 *
 * A platform subdomain costs a slot in the provider's account-wide allowance,
 * three records in Aglyn's own zone and a permanent place in the
 * re-verification sweep — where a domain the merchant owns costs the zone
 * nothing and the pool costs nothing per site at all. It used to be claimed at
 * site creation, at the billing webhook's upgrade transition, and by a sweep;
 * it is now claimed here and nowhere else.
 */
describe('a dedicated sending domain is requested, not issued', () => {
  it('claims one for an entitled site and points the site at it', async () => {
    mockHostDoc = { subdomain: 'acme' }

    const response = await write({ action: 'request-dedicated' })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.selected).toBe('acme.mail.aglyn.app')
    expect(body.from).toBe('hello@acme.mail.aglyn.app')
    expect(mockState.claims).toHaveLength(1)
    expect(mockState.claims[0]).toMatchObject({ requestedBy: 'merchant' })
    // Pointed at it immediately, before any DNS exists. Safe because an
    // unverified PLATFORM domain resolves to the pool for transactional mail,
    // so the site keeps sending throughout.
    expect(mockState.written.sendingDomain).toBe('acme.mail.aglyn.app')
    // And the mailbox is not reset by acquiring a domain. Which mailbox a
    // site sends as and which domain it sends on are different decisions.
    expect(mockState.written.sendingLocalPart).toBeUndefined()
  })

  /**
   * A mailbox named in the same body IS applied, unlike on the way to the
   * pool: the refusal there is about a shared member's address not being one
   * site's to name, and this site now has a domain of its own.
   */
  it('applies a mailbox chosen in the same request', async () => {
    mockHostDoc = { subdomain: 'acme' }

    const response = await write({
      action: 'request-dedicated',
      localPart: 'sales',
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.from).toBe('sales@acme.mail.aglyn.app')
    expect(mockState.written.sendingLocalPart).toBe('sales')
  })

  /**
   * The plan refusal is named apart from every other failure, because it is
   * the only one the reader can act on — and it says what happens meanwhile,
   * because a merchant reading "not on your plan" about their mail needs to
   * know their receipts are still going out.
   */
  it.each(['free', 'starter'])('refuses a %s org, and says mail continues', async (plan) => {
    mockState.plan = plan
    mockHostDoc = { subdomain: 'acme' }

    const response = await write({ action: 'request-dedicated' })
    const { error } = await response.json()

    expect(response.status).toBe(403)
    expect(error).toContain(DEDICATED_PLAN_LABEL)
    // And it says the mail is still going out, because a merchant reading
    // "not on your plan" about their email needs to know their receipts are
    // not what was refused.
    expect(error).toMatch(/receipts and account email/i)
    expect(mockState.written).toBeNull()
  })

  /** Writing this key is an org-admin action, exactly like choosing one. */
  it('refuses a site admin who is not an org admin', async () => {
    mockState.canManage = false
    mockHostDoc = { subdomain: 'acme' }

    expect((await write({ action: 'request-dedicated' })).status).toBe(403)
    expect(mockState.claims).toEqual([])
  })

  /**
   * THE CONTROL FOR AN AUTOMATIC CLAIM.
   *
   * Every other write this route accepts must reach the claim ZERO times. If
   * provisioning is ever hung off one of them again — the way it was hung off
   * creation, the upgrade webhook and the sweep — this is the assertion that
   * fails, and it fails without anybody having to think of the specific
   * caller.
   */
  it('claims nothing on any other write', async () => {
    mockHostDoc = { subdomain: 'acme', sendingLabel: 'acme' }

    await write({ domain: 'acme.com', localPart: 'hello' })
    await write({ domain: 'platform' })
    await write({ domain: 'beta.com' })
    await write({ domain: 'somebody-else.com' })

    expect(mockState.claims).toEqual([])
  })

  /**
   * The read OFFERS it, which is what stops the option being invisible. A
   * merchant meeting the marketing refusal is told to come to this card; an
   * entitled site with no domain has to find something here to act on.
   */
  it('offers one on the read for an entitled site that has none', async () => {
    mockHostDoc = { subdomain: 'acme' }

    const body = await (await read()).json()

    expect(body.dedicated.available).toBe(true)
    expect(body.dedicated.proposed).toBe('acme.mail.aglyn.app')
    // `platformDomain` is the one place that says whether the site HAS one,
    // and it says no. A second key carrying the same fact is how a card comes
    // to offer a domain to a site that already holds it.
    expect(body.platformDomain).toBe('')
    // Offering is not claiming.
    expect(mockState.claims).toEqual([])
  })

  it.each(['free', 'starter'])('offers nothing to a %s org', async (plan) => {
    mockState.plan = plan
    mockHostDoc = { subdomain: 'acme' }

    const body = await (await read()).json()

    expect(body.dedicated.available).toBe(false)
  })

  it('stops offering once the site has one', async () => {
    mockHostDoc = { subdomain: 'acme', sendingLabel: 'acme' }

    const body = await (await read()).json()

    expect(body.dedicated.available).toBe(false)
    expect(body.platformDomain).toBe('acme.mail.aglyn.app')
  })
})

/**
 * SEVERAL SENDERS, AND THE ONE AN EMAIL LEAVES ON WHEN IT NAMES NONE.
 *
 * The whole of this block turns on one property: `hosts/{hostId}` already
 * carries `sendingLocalPart`, `sendingFromName` and `sendingReplyTo`, and
 * `resolveHostSendingIdentity` reads the first of them on every tenant send.
 * Those fields are the DEFAULT SENDER'S PROJECTION rather than something the
 * list replaces, which is what lets this ship with no backfill — and what a
 * regression here would break is not a new feature but every site that already
 * sends as something other than `hello@`.
 */
describe('the senders a site holds', () => {
  it('reports the site\u2019s existing sender as one row, with the address it leaves on', async () => {
    // No subcollection at all, which is every site before anybody opens the
    // list. The row is SYNTHESIZED from the host fields rather than reported
    // as an absence, because such a site does have a sender — the one it has
    // always had.
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      sendingFromName: 'Acme',
    }

    const body = await (await read()).json()

    expect(body.senders).toHaveLength(1)
    expect(body.senders[0]).toMatchObject({
      localPart: 'news',
      fromName: 'Acme',
      isDefault: true,
      from: 'news@acme.com',
    })
  })

  it('lists the stored senders once there are any, marking the default', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      defaultSenderId: 'default',
    }
    mockSenders = {
      default: { localPart: 'news' },
      'sender-jamie': { localPart: 'jamie', fromName: 'Jamie Lee' },
    }

    const body = await (await read()).json()
    const rows = Object.fromEntries(
      body.senders.map((one: any) => [one.id, one]),
    )

    expect(body.senders).toHaveLength(2)
    expect(rows['default'].isDefault).toBe(true)
    // Every row carries the WHOLE address, so no surface assembles one and
    // the two cannot disagree the first time either half moves.
    expect(rows['sender-jamie']).toMatchObject({
      isDefault: false,
      from: 'jamie@acme.com',
    })
  })

  /**
   * THE FIRST WRITE MATERIALIZES WHAT THE SITE ALREADY SENT AS.
   *
   * The failure this prevents is the one that would have needed a migration:
   * a site sending as `test@` gains a second sender, the list starts from
   * nothing, and the site quietly reverts to `hello@` — an address its owner
   * never chose, on the domain their recipients already know.
   */
  it('keeps the site\u2019s existing sender when a second one is added', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'test',
      sendingFromName: 'Test Name',
    }

    const response = await write({
      action: 'createSender',
      localPart: 'jamie',
      fromName: 'Jamie Lee',
    })

    expect(response.status).toBe(200)
    const rows = Object.values(mockSenders)
    expect(rows).toHaveLength(2)
    expect(rows).toContainEqual(
      expect.objectContaining({ localPart: 'test', fromName: 'Test Name' }),
    )
    expect(rows).toContainEqual(
      expect.objectContaining({ localPart: 'jamie', fromName: 'Jamie Lee' }),
    )
    // And the projection the SEND path reads is untouched: adding a sender is
    // not a decision about which one is the default.
    expect(mockHostDoc['sendingLocalPart']).toBe('test')
  })

  it('refuses a second sender on the shared pooled address', async () => {
    mockHostDoc = { subdomain: 'acme' }

    const response = await write({
      action: 'createSender',
      localPart: 'jamie',
    })

    expect(response.status).toBe(409)
    expect((await response.json()).error).toContain('shared Aglyn address')
    expect(mockSenders).toEqual({})
  })

  it('refuses a reserved role mailbox on the list as well as on the site', async () => {
    const response = await write({
      action: 'createSender',
      localPart: 'postmaster',
    })

    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('reserved')
  })

  it('refuses a second sender on a mailbox this site already sends as', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      defaultSenderId: 'default',
    }
    mockSenders = { default: { localPart: 'news' } }

    const response = await write({ action: 'createSender', localPart: 'news' })

    expect(response.status).toBe(409)
    expect(Object.keys(mockSenders)).toHaveLength(1)
  })

  it('writes the projection when the DEFAULT sender changes', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      defaultSenderId: 'default',
    }
    mockSenders = { default: { localPart: 'news' } }

    const response = await write({
      action: 'updateSender',
      senderId: 'default',
      localPart: 'jamie',
      fromName: 'Jamie Lee',
    })

    expect(response.status).toBe(200)
    // Both halves. The row is what the list renders; `sendingLocalPart` is
    // what the send path actually reads, and a change that wrote only one of
    // them is a site whose settings screen disagrees with its mail.
    expect(mockSenders['default']).toMatchObject({
      localPart: 'jamie',
      fromName: 'Jamie Lee',
    })
    expect(mockState.written).toMatchObject({
      sendingLocalPart: 'jamie',
      sendingFromName: 'Jamie Lee',
    })
  })

  /**
   * The CONTROL for the projection: editing a sender that is not the default
   * must not move the address every unnamed send leaves on.
   */
  it('leaves the projection alone when a non-default sender changes', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      defaultSenderId: 'default',
    }
    mockSenders = {
      default: { localPart: 'news' },
      'sender-jamie': { localPart: 'jamie' },
    }

    const response = await write({
      action: 'updateSender',
      senderId: 'sender-jamie',
      localPart: 'jaime',
    })

    expect(response.status).toBe(200)
    expect(mockSenders['sender-jamie']).toMatchObject({ localPart: 'jaime' })
    expect(mockHostDoc['sendingLocalPart']).toBe('news')
  })

  it('re-projects when another sender is made the default', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      defaultSenderId: 'default',
    }
    mockSenders = {
      default: { localPart: 'news' },
      'sender-jamie': { localPart: 'jamie', fromName: 'Jamie Lee' },
    }

    const response = await write({
      action: 'makeDefaultSender',
      senderId: 'sender-jamie',
    })

    expect(response.status).toBe(200)
    expect(mockState.written).toMatchObject({
      defaultSenderId: 'sender-jamie',
      sendingLocalPart: 'jamie',
      sendingFromName: 'Jamie Lee',
    })
  })

  /**
   * A `senderId` this site does not hold is REFUSED, never defaulted.
   *
   * The same class as the mailbox validation that used to answer `hello` to a
   * name it could not parse: answering a choice somebody made with a different
   * one they did not is how a merchant is told their mail goes out as an
   * address it does not.
   */
  it('refuses a sender this site does not hold rather than defaulting', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      defaultSenderId: 'default',
    }
    mockSenders = { default: { localPart: 'news' } }

    const response = await write({
      action: 'updateSender',
      senderId: 'somebody-elses-sender',
      localPart: 'jamie',
    })

    expect(response.status).toBe(404)
    expect(mockSenders['default']).toMatchObject({ localPart: 'news' })
    expect(mockHostDoc['sendingLocalPart']).toBe('news')
  })

  it('refuses to remove the default, and names the way out', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      defaultSenderId: 'default',
    }
    mockSenders = {
      default: { localPart: 'news' },
      'sender-jamie': { localPart: 'jamie' },
    }

    const response = await write({
      action: 'deleteSender',
      senderId: 'default',
    })

    expect(response.status).toBe(409)
    expect((await response.json()).error).toMatch(/default/i)
    expect(mockSenders['default']).toBeTruthy()
  })

  it('removes a sender that is not the default', async () => {
    mockHostDoc = {
      sendingDomain: 'acme.com',
      sendingLocalPart: 'news',
      defaultSenderId: 'default',
    }
    mockSenders = {
      default: { localPart: 'news' },
      'sender-jamie': { localPart: 'jamie' },
    }

    const response = await write({
      action: 'deleteSender',
      senderId: 'sender-jamie',
    })

    expect(response.status).toBe(200)
    expect(Object.keys(mockSenders)).toEqual(['default'])
  })

  /**
   * The list answers to the same gate as the mailbox it is made of.
   *
   * A site `admin` may be a site-scoped collaborator with no org standing, and
   * naming the addresses this site's mail leaves on is exactly the decision
   * `org.settings` covers.
   */
  it('refuses a sender write from somebody without the org admin role', async () => {
    mockState.canManage = false

    const response = await write({
      action: 'createSender',
      localPart: 'jamie',
    })

    expect(response.status).toBe(403)
    expect(mockSenders).toEqual({})
  })

  it('reports the list to an editor, who is the one who picks from it', async () => {
    // The composer is admin-or-editor. A list behind the write gate would
    // leave a merchant with a From control that had nothing in it.
    mockState.hostRole = 'editor'
    mockState.canManage = false

    const body = await (await read()).json()

    expect(body.senders).toHaveLength(1)
    expect(body.canManage).toBe(false)
  })
})
